import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type { RegionAttachment } from '@marionette/format/types';
import {
  buildPose,
  compose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  multiply,
  resetToSetupPose,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { regionWorldCorners, renderFrame } from '@marionette/render-preview';
import { regionDocument, rotatedRegionScenario } from './scenarios';
import { decode, pixelAt } from './helpers';

// Independent reproduction of runtime-web's region-placement computeRegionSized (region-placement.ts),
// built from runtime-core math ONLY (no runtime-web import), so the parity assertion is not circular.
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

const UNIT_CORNERS: readonly (readonly [number, number])[] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

describe('region placement parity', () => {
  it('matches runtime-web region-placement world quad corners (runtime-core math)', () => {
    const document = parseDocument(
      regionDocument({
        boneRotation: 90,
        regionWidth: 60,
        regionHeight: 20,
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
    const boneWorld: Mat2x3 = [w[0]!, w[1]!, w[2]!, w[3]!, w[4]!, w[5]!];
    const region = document.skins[0]!.attachments['s']!['img'] as RegionAttachment;

    const sized = independentSized(region);
    const world = multiply(boneWorld, sized);
    const mine = regionWorldCorners(boneWorld, region);

    UNIT_CORNERS.forEach((corner, index) => {
      const [ex, ey] = transformPoint(world, corner[0], corner[1]);
      expect(mine[index]!.x).toBeCloseTo(ex, 10);
      expect(mine[index]!.y).toBeCloseTo(ey, 10);
    });
    // The driving bone is a plain root, so its world stride slot exists as expected.
    expect(pose.world.length).toBe(MAT2X3_STRIDE * document.bones.length);
  });

  // The wide (60x20) bar becomes VERTICAL under the 90-degree bone rotation. With the explicit fit rect
  // (scale 1, world origin at image center 32,32) the covered image band is columns 22..42, rows 2..62.
  it('rasterizes the rotated bar at the placement-predicted pixels', () => {
    const image = decode(renderFrame(rotatedRegionScenario()).png);

    // Inside the vertical bar (column 32 is within 22..42): opaque white.
    for (const [x, y] of [
      [32, 10],
      [32, 32],
      [32, 54],
    ] as const) {
      const p = pixelAt(image, x, y);
      expect(p).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    }

    // Outside the vertical bar (columns 10 and 54 are outside 22..42): transparent background.
    for (const [x, y] of [
      [10, 32],
      [54, 32],
    ] as const) {
      expect(pixelAt(image, x, y).a).toBe(0);
    }
  });
});
