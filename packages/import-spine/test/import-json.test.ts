import { validateDocument, type SkeletonDocument } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import { importSpineJson, type SpineImportResult } from '../src';
import {
  constraintsFixture,
  minimalFixture,
  skinScopedFixture,
  warningsFixture,
  weightedMeshFixture,
} from './fixtures/spine-fixtures';

function expectOk(result: SpineImportResult): SkeletonDocument {
  if (!result.ok) {
    throw new Error(
      `import failed: ${result.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`,
    );
  }
  return result.document;
}

describe('importSpineJson positive round-trips', () => {
  const positives: Array<[string, unknown]> = [
    ['minimal skeleton', minimalFixture],
    ['weighted mesh with deform', weightedMeshFixture],
    ['ik/transform/path constraints', constraintsFixture],
    ['skin-scoped content', skinScopedFixture],
    ['unsupported-feature warnings', warningsFixture],
  ];

  it.each(positives)('imports %s to a document that passes validateDocument', (_label, input) => {
    const result = importSpineJson(input);

    const document = expectOk(result);
    expect(validateDocument(document).ok).toBe(true);
  });

  it('stamps the current format version and a valid content hash', () => {
    const document = expectOk(importSpineJson(minimalFixture));

    expect(document.formatVersion).toBe('0.6.0');
    expect(document.hash).toMatch(/^[0-9a-f]{64}$/);
    // Re-validating with hash verification (the default) proves the stamped hash is correct.
    expect(validateDocument(document, { verifyHash: true }).ok).toBe(true);
  });

  it('uses the provided name option, defaulting otherwise', () => {
    expect(expectOk(importSpineJson(minimalFixture)).name).toBe('imported-skeleton');
    expect(expectOk(importSpineJson(minimalFixture, { name: 'hero' })).name).toBe('hero');
  });
});

describe('coordinate and value conventions (identity mapping)', () => {
  it('carries bone transform fields through unchanged (no axis flip, no angle negation)', () => {
    const document = expectOk(importSpineJson(minimalFixture));

    const bone1 = document.bones.find((b) => b.name === 'bone1');
    expect(bone1).toMatchObject({ parent: 'root', x: 50, rotation: 30, scaleX: 1, scaleY: 1 });
  });

  it('parses an 8 digit RGBA color into [0,1] floats', () => {
    const document = expectOk(importSpineJson(skinScopedFixture));

    const body = document.slots.find((s) => s.name === 'body');
    expect(body?.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    // The setup dark color came from the 6 digit "333333" (alpha defaults to 1).
    expect(body?.darkColor).toEqual({ r: 0x33 / 255, g: 0x33 / 255, b: 0x33 / 255, a: 1 });
  });

  it('defaults a region attachment path to its attachment name', () => {
    const document = expectOk(importSpineJson(minimalFixture));

    const region = document.skins[0]?.attachments['slot1']?.['region1'];
    expect(region).toMatchObject({ type: 'region', path: 'region1' });
  });
});

describe('constraint mapping conventions', () => {
  it('maps bendPositive to a signed bend direction and splits per-axis mixes', () => {
    const document = expectOk(importSpineJson(constraintsFixture));

    const ik = document.ikConstraints[0];
    expect(ik).toMatchObject({ name: 'ik1', bend: -1, softness: 5, stretch: true, order: 0 });

    const tc = document.transformConstraints[0];
    // translateMix 0.5 drives both mixX and mixY; scaleMix 0.25 drives both scale mixes.
    expect(tc).toMatchObject({
      mixRotate: 1,
      mixX: 0.5,
      mixY: 0.5,
      mixScaleX: 0.25,
      mixScaleY: 0.25,
      mixShearY: 0,
      offsetRotation: 10,
      offsetX: 5,
    });
  });

  it('maps the path rotateMode "chain scale" to chainScale', () => {
    const document = expectOk(importSpineJson(constraintsFixture));

    expect(document.pathConstraints[0]).toMatchObject({
      rotateMode: 'chainScale',
      positionMode: 'percent',
      spacingMode: 'length',
      mixX: 1,
      mixY: 1,
    });
  });

  it('derives the weighted mesh bones manifest from the vertex stream', () => {
    const document = expectOk(importSpineJson(weightedMeshFixture));

    const mesh = document.skins[0]?.attachments['meshslot']?.['mesh1'];
    expect(mesh).toMatchObject({ type: 'mesh', bones: [0, 1] });
  });

  it('pads a deform key to the full 2 * V offsets array', () => {
    const document = expectOk(importSpineJson(weightedMeshFixture));

    const frames = document.animations['wobble']?.deform['default']?.['meshslot']?.['mesh1'];
    // V = 4 (uvs.length / 2), so offsets length is 8. The second key had offset 2 and deltas [3, -3].
    expect(frames?.[1]?.value.offsets).toEqual([0, 0, 3, -3, 0, 0, 0, 0]);
  });
});

describe('curve encodings', () => {
  it('converts linear, stepped, and bezier keyframe curves', () => {
    const document = expectOk(importSpineJson(minimalFixture));

    const rotate = document.animations['idle']?.bones['bone1']?.rotate;
    expect(rotate?.[0]?.curve).toBe('linear');
    expect(rotate?.[1]?.curve).toBe('stepped');
    expect(rotate?.[2]?.curve).toEqual({ type: 'bezier', cx1: 0.25, cy1: 0, cx2: 0.75, cy2: 1 });
  });
});

describe('unsupported-feature warnings (never a silent drop)', () => {
  it('surfaces every unrepresentable construct as a typed warning', () => {
    const result = importSpineJson(warningsFixture);

    const document = expectOk(result);
    const features = new Set(result.warnings.map((w) => w.feature));
    expect(features).toEqual(
      new Set([
        'physics-constraint',
        'physics-timeline',
        'draw-order-timeline',
        'sequence-attachment',
        'two-color-synthesized-dark',
        'event-audio-override',
        'atlas-synthesized',
      ]),
    );
    // The document still validates and drops nothing without a note: physics is empty, draw order empty.
    expect(document.physicsConstraints).toEqual([]);
    expect(document.animations['go']?.drawOrder).toEqual([]);
    expect(document.animations['go']?.physics).toEqual({});
  });

  it('synthesizes a black setup dark color for a two-color timeline without one', () => {
    const document = expectOk(importSpineJson(warningsFixture));

    const s1 = document.slots.find((s) => s.name === 's1');
    expect(s1?.darkColor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('synthesizes placeholder atlas regions for referenced paths', () => {
    const document = expectOk(importSpineJson(minimalFixture));

    expect(document.atlas.pages[0]?.regions.map((r) => r.name)).toEqual(['region1']);
  });
});
