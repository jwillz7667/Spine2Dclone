import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type { RegionAttachment } from '@marionette/format/types';
import {
  buildPose,
  compose,
  computeWorldTransforms,
  multiply,
  resetToSetupPose,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { regionWorldCorners, type RegionTrim } from '@marionette/render-preview';
import { regionDocument } from './scenarios';

// PP-C1 shared placement parity: a trimmed region must render exactly where its untrimmed original would,
// identically in render-preview (regionWorldCorners) and runtime-web (a Sprite sized by attachment-sprites
// sizeForTexture). This reproduces runtime-web's sprite-matrix math from runtime-core ONLY (no runtime-web
// import; it depends on PixiJS), so the parity assertion is not circular, exactly like placement.test.ts.

// runtime-web computeRegionSized (region-placement.ts): attachmentLocal * scale(width, height).
function independentSized(region: RegionAttachment): Mat2x3 {
  const attachmentLocal = compose(
    region.x,
    region.y,
    region.rotation,
    region.scaleX,
    region.scaleY,
    0,
    0,
  );
  return multiply(attachmentLocal, [region.width, 0, 0, region.height, 0, 0]);
}

// runtime-web attachment-sprites.ts sizeForTexture(sized, texW, texH, trim): the trim-aware normalization
// post-multiplied onto the sized matrix. texW/texH are the packed region pixel size (the sprite's texture).
function independentSizedForSprite(
  region: RegionAttachment,
  texW: number,
  texH: number,
  trim: RegionTrim,
): Mat2x3 {
  const inner: Mat2x3 = [
    trim.w / (trim.originalW * texW),
    0,
    0,
    trim.h / (trim.originalH * texH),
    (trim.offsetX + trim.w / 2) / trim.originalW - 0.5,
    (trim.offsetY + trim.h / 2) / trim.originalH - 0.5,
  ];
  return multiply(independentSized(region), inner);
}

// The four sprite-local corners of an anchor-0.5, texW x texH sprite, in UNIT_QUAD order (TL, TR, BR, BL).
function spriteLocalCorners(texW: number, texH: number): readonly (readonly [number, number])[] {
  return [
    [-texW / 2, -texH / 2],
    [texW / 2, -texH / 2],
    [texW / 2, texH / 2],
    [-texW / 2, texH / 2],
  ];
}

// The setup-pose world matrix of the single root bone, rotated by `boneRotation` degrees.
function boneWorldAt(boneRotation: number): Mat2x3 {
  const document = parseDocument(
    regionDocument({
      boneRotation,
      regionWidth: 40,
      regionHeight: 40,
      regionColor: { r: 1, g: 1, b: 1, a: 1 },
      slotColor: { r: 1, g: 1, b: 1, a: 1 },
      blendMode: 'normal',
    }),
    { verifyHash: false },
  );
  const pose = buildPose(document);
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  const w = pose.world;
  return [w[0]!, w[1]!, w[2]!, w[3]!, w[4]!, w[5]!];
}

// Build a region attachment with explicit placement channels for the parity cases.
function regionAttachment(overrides: Partial<RegionAttachment>): RegionAttachment {
  return {
    type: 'region',
    path: 'img',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 40,
    height: 40,
    color: { r: 1, g: 1, b: 1, a: 1 },
    ...overrides,
  };
}

describe('trim placement parity (render-preview vs runtime-web sprite matrix)', () => {
  const cases: {
    name: string;
    region: RegionAttachment;
    trim: RegionTrim;
    boneRotation: number;
  }[] = [
    {
      name: 'asymmetric trim, upright bone',
      region: regionAttachment({ width: 40, height: 40 }),
      trim: { offsetX: 3, offsetY: 11, w: 20, h: 12, originalW: 40, originalH: 40 },
      boneRotation: 0,
    },
    {
      name: 'trim with nonuniform attachment scale and non-square size',
      region: regionAttachment({ width: 60, height: 20, scaleX: 1.5, scaleY: 0.75 }),
      trim: { offsetX: 5, offsetY: 1, w: 18, h: 7, originalW: 30, originalH: 10 },
      boneRotation: 0,
    },
    {
      name: 'trim under a rotated bone',
      region: regionAttachment({ width: 40, height: 40, rotation: 15 }),
      trim: { offsetX: 8, offsetY: 2, w: 16, h: 30, originalW: 40, originalH: 40 },
      boneRotation: 90,
    },
  ];

  for (const testCase of cases) {
    it(`matches for ${testCase.name}`, () => {
      const boneWorld = boneWorldAt(testCase.boneRotation);
      const { trim, region } = testCase;

      const preview = regionWorldCorners(boneWorld, region, trim);

      // runtime-web draws a Sprite whose texture is the PACKED region (texW x texH = trim.w x trim.h).
      const sizedForSprite = independentSizedForSprite(region, trim.w, trim.h, trim);
      const spriteWorld = multiply(boneWorld, sizedForSprite);
      const locals = spriteLocalCorners(trim.w, trim.h);

      locals.forEach((local, index) => {
        const [ex, ey] = transformPoint(spriteWorld, local[0], local[1]);
        expect(preview[index]!.x).toBeCloseTo(ex, 9);
        expect(preview[index]!.y).toBeCloseTo(ey, 9);
      });
    });
  }

  it('leaves an untrimmed region on the full centered quad (no drift)', () => {
    const boneWorld = boneWorldAt(0);
    const region = regionAttachment({ width: 40, height: 40 });

    const withoutTrim = regionWorldCorners(boneWorld, region);
    const untrimmed: RegionTrim = {
      offsetX: 0,
      offsetY: 0,
      w: 40,
      h: 40,
      originalW: 40,
      originalH: 40,
    };
    const withUntrimmed = regionWorldCorners(boneWorld, region, untrimmed);

    // Passing an explicitly-untrimmed trim must equal the no-trim path exactly (offset 0, packed==original).
    withoutTrim.forEach((corner, index) => {
      expect(withUntrimmed[index]!.x).toBe(corner.x);
      expect(withUntrimmed[index]!.y).toBe(corner.y);
    });
  });
});
