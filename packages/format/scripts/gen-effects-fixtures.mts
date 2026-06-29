// Generates the effects-format golden corpus (phase-3-vfx-particles.md WP-3.0): one canonical valid
// `effects/minimal.fx.json`, one `effects/invalid/<CODE>.json` per semantic-reachable error code
// (each invalid by exactly ONE fault), plus a ProjectManifest fixture set. The corpus is committed;
// this script is its provenance, so a reviewer can see precisely which single field each fixture
// breaks. Run: pnpm --filter @marionette/format gen:effects-fixtures.
//
// The valid fixture carries a correct content hash (validates with zero warnings). The invalid
// fixtures carry an empty hash, which yields only an EFFECT_HASH_ABSENT warning (never a hash error),
// so each invalid document trips exactly its targeted fault.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEffectsContentHash } from '../src/effects/hash/hash';
import { validateEffectsDocument } from '../src/effects/validate';
import type { EffectsDocument } from '../src/effects/schema/document';
import { EFFECTS_FORMAT_VERSION } from '../src/version/constants';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
  'effects',
);
const invalidDir = join(fixturesDir, 'invalid');
const manifestDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
  'manifest',
);

// The minimal valid effects library: one emitter with one static region, a linear over-life curve
// for scale/color/alpha, plus a single bundle that references the effect by name. Authored with an
// empty hash; the real hash is computed and embedded below.
function minimalDraft(): EffectsDocument {
  return {
    effectsFormatVersion: EFFECTS_FORMAT_VERSION,
    name: 'minimal-effects',
    hash: '',
    atlas: {
      pages: [
        {
          file: 'vfx.png',
          width: 64,
          height: 64,
          regions: [
            {
              name: 'spark',
              x: 0,
              y: 0,
              w: 16,
              h: 16,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 16,
              originalH: 16,
            },
          ],
        },
      ],
    },
    effects: {
      sparkle: {
        name: 'sparkle',
        duration: 1,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'additive',
        layers: [
          {
            type: 'emitter',
            name: 'core',
            blendMode: 'additive',
            maxParticles: 64,
            spawn: { mode: 'rate', particlesPerSecond: 30 },
            shape: { kind: 'point' },
            lifetime: { min: 0.2, max: 0.5 },
            startSpeed: { min: 10, max: 40 },
            emissionAngle: { min: 0, max: 360 },
            startRotation: { min: 0, max: 0 },
            angularVelocity: { min: -90, max: 90 },
            startScale: { min: 0.5, max: 1 },
            gravity: { x: 0, y: 0 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: {
              stops: [
                { t: 0, value: 1, curve: 'linear' },
                { t: 1, value: 0, curve: 'linear' },
              ],
            },
            colorOverLife: {
              stops: [
                { t: 0, value: { r: 1, g: 1, b: 1 }, curve: 'linear' },
                { t: 1, value: { r: 1, g: 0.8, b: 0.2 }, curve: 'linear' },
              ],
            },
            alphaOverLife: {
              stops: [
                { t: 0, value: 1, curve: 'linear' },
                { t: 1, value: 0, curve: 'linear' },
              ],
            },
            texture: { kind: 'static', region: 'spark' },
            particleTrail: null,
          },
        ],
      },
    },
    bundles: {
      simple: {
        name: 'simple',
        items: [{ effect: 'sparkle', startOffset: 0, anchorRole: 'center', seedSalt: 0 }],
      },
    },
  };
}

function withHash(doc: EffectsDocument): EffectsDocument {
  return { ...doc, hash: computeEffectsContentHash({ ...doc, hash: '' }) };
}

// Deep clone helper for building invalid variants from the valid draft.
function clone<T>(value: T): T {
  return structuredClone(value);
}

// Build the invalid corpus: each entry mutates the minimal draft by exactly one fault, leaving the
// hash empty so only the targeted code fires.
function invalidCorpus(): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // EFFECT_SCHEMA_SHAPE: unknown top-level key (closed object).
  out['EFFECT_SCHEMA_SHAPE'] = { ...clone(minimalDraft()), unexpectedKey: true };

  // EFFECT_UNSUPPORTED_FORMAT_VERSION: a version other than the supported one.
  out['EFFECT_UNSUPPORTED_FORMAT_VERSION'] = {
    ...clone(minimalDraft()),
    effectsFormatVersion: '2.0.0',
  };

  // EFFECT_COLOR_RANGE: an over-life color channel outside [0, 1].
  {
    const d = clone(minimalDraft());
    const layer = d.effects['sparkle']!.layers[0]!;
    if (layer.type === 'emitter') {
      layer.colorOverLife.stops[0]!.value = { r: 1.5, g: 0, b: 0 };
    }
    out['EFFECT_COLOR_RANGE'] = d;
  }

  // EFFECT_NAME_KEY_MISMATCH: map key differs from the inner effect name.
  {
    const d = clone(minimalDraft());
    d.effects['sparkle']!.name = 'different';
    out['EFFECT_NAME_KEY_MISMATCH'] = d;
  }

  // EFFECT_NAME_DUPLICATE: two effects sharing the same inner name (distinct keys).
  {
    const d = clone(minimalDraft());
    const second = clone(d.effects['sparkle']!);
    d.effects['sparkle2'] = second; // inner name is still "sparkle"
    out['EFFECT_NAME_DUPLICATE'] = d;
  }

  // EFFECT_SIMULATION_DT: a non-positive fixed step.
  {
    const d = clone(minimalDraft());
    d.effects['sparkle']!.simulationDt = 0;
    out['EFFECT_SIMULATION_DT'] = d;
  }

  // EFFECT_RANGE_MIN_GT_MAX: a RangeF with min > max.
  {
    const d = clone(minimalDraft());
    const layer = d.effects['sparkle']!.layers[0]!;
    if (layer.type === 'emitter') layer.lifetime = { min: 0.5, max: 0.2 };
    out['EFFECT_RANGE_MIN_GT_MAX'] = d;
  }

  // EFFECT_BURST_TIME_ORDER: a bursts list whose atTime does not strictly increase.
  {
    const d = clone(minimalDraft());
    const layer = d.effects['sparkle']!.layers[0]!;
    if (layer.type === 'emitter') {
      layer.spawn = {
        mode: 'bursts',
        bursts: [
          { atTime: 0.2, count: 5 },
          { atTime: 0.2, count: 5 },
        ],
      };
    }
    out['EFFECT_BURST_TIME_ORDER'] = d;
  }

  // EFFECT_LIFECURVE_STOP_ORDER: a curve whose first stop t is not 0.
  {
    const d = clone(minimalDraft());
    const layer = d.effects['sparkle']!.layers[0]!;
    if (layer.type === 'emitter') {
      layer.scaleOverLife.stops[0]!.t = 0.1;
    }
    out['EFFECT_LIFECURVE_STOP_ORDER'] = d;
  }

  // EFFECT_REGION_MISSING: a texture region absent from the atlas.
  {
    const d = clone(minimalDraft());
    const layer = d.effects['sparkle']!.layers[0]!;
    if (layer.type === 'emitter') layer.texture = { kind: 'static', region: 'ghost' };
    out['EFFECT_REGION_MISSING'] = d;
  }

  // BUNDLE_NAME_KEY_MISMATCH: bundle map key differs from the inner bundle name.
  {
    const d = clone(minimalDraft());
    d.bundles['simple']!.name = 'other';
    out['BUNDLE_NAME_KEY_MISMATCH'] = d;
  }

  // BUNDLE_EFFECT_MISSING: a bundle item referencing an undefined effect.
  {
    const d = clone(minimalDraft());
    d.bundles['simple']!.items[0]!.effect = 'ghost';
    out['BUNDLE_EFFECT_MISSING'] = d;
  }

  // BUNDLE_ANCHOR_ROLE_EMPTY: a whitespace-only anchorRole (the .min(1) schema admits it).
  {
    const d = clone(minimalDraft());
    d.bundles['simple']!.items[0]!.anchorRole = '   ';
    out['BUNDLE_ANCHOR_ROLE_EMPTY'] = d;
  }

  // EFFECT_HASH_MISMATCH: a syntactically valid hash that does not match the content.
  {
    const d = clone(minimalDraft());
    d.hash = 'a'.repeat(64);
    out['EFFECT_HASH_MISMATCH'] = d;
  }

  return out;
}

function main(): void {
  rmSync(invalidDir, { recursive: true, force: true });
  mkdirSync(invalidDir, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });

  const valid = withHash(minimalDraft());
  const validReport = validateEffectsDocument(valid);
  if (!validReport.ok) {
    throw new Error(
      `minimal effects fixture is not valid: ${JSON.stringify(validReport.errors, null, 2)}`,
    );
  }
  writeFileSync(join(fixturesDir, 'minimal.fx.json'), `${JSON.stringify(valid, null, 2)}\n`);

  const corpus = invalidCorpus();
  for (const [code, doc] of Object.entries(corpus)) {
    writeFileSync(join(invalidDir, `${code}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }

  // ProjectManifest fixtures: a valid manifest (two members) and the two malformed cases the corpus
  // exercises via the resolver (a dangling member and a content-hash mismatch). The manifest itself
  // is the same shape in all three; the resolver supplied by the test decides PASS vs each fault.
  const manifest = {
    projectFormatVersion: '1.0.0',
    name: 'demo-project',
    members: [
      { path: 'demo.skel.json', kind: 'skeleton', hash: 'b'.repeat(64) },
      { path: 'demo.fx.json', kind: 'effects', hash: valid.hash },
    ],
  };
  writeFileSync(join(manifestDir, 'valid.project.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // PROJECT_SCHEMA_SHAPE: a member with a bad-length hash.
  const badShape = clone(manifest);
  badShape.members[0]!.hash = 'short';
  writeFileSync(
    join(manifestDir, 'PROJECT_SCHEMA_SHAPE.json'),
    `${JSON.stringify(badShape, null, 2)}\n`,
  );

  console.log('effects fixtures written.');
}

main();
