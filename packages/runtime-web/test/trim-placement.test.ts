import { describe, expect, it } from 'vitest';
import { Sprite } from 'pixi.js';
import {
  buildPose,
  compose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  multiply,
  resetToSetupPose,
  transformPoint,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import type { AtlasRegion, RegionAttachment, SkeletonDocument } from '@marionette/format/types';
import { buildRegionTextures, makeRegionTextureResolver, SkeletonView } from '../src';
import { bone, makeDocument, region, slot } from './rig';
import { makeSolidTexture } from './texture-fixtures';

// PP-C1 / PP-C2: the trim/rotation placement runtime-web actually renders must equal the SHARED corner
// formula render-preview uses (regionWorldCorners), so a trimmed atlas renders where its untrimmed
// original would and a rotated region samples in-place. The expected corners are reproduced from
// runtime-core math ONLY (the same formula render-preview's regionWorldCorners and trim-parity.test use),
// so this checks the live PixiJS sprite quad against the contract, not against itself.

function solve(document: SkeletonDocument): Pose {
  const pose = buildPose(document);
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  return pose;
}

function boneWorld(pose: Pose, name: string): Mat2x3 {
  const base = pose.boneNames.indexOf(name) * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

// computeRegionSized reproduced from runtime-core: attachmentLocal * scale(width, height).
function sizedLocal(r: RegionAttachment): Mat2x3 {
  const attachmentLocal = compose(r.x, r.y, r.rotation, r.scaleX, r.scaleY, 0, 0);
  return multiply(attachmentLocal, [r.width, 0, 0, r.height, 0, 0]);
}

// The trimmed unit-quad corners (TL, TR, BR, BL) as a fraction of the original image, the same mapping
// render-preview's regionWorldCorners applies. Untrimmed reduces to +/-0.5.
function trimmedUnitCorners(a: AtlasRegion): Array<readonly [number, number]> {
  const left = -0.5 + a.offsetX / a.originalW;
  const right = -0.5 + (a.offsetX + a.w) / a.originalW;
  const top = -0.5 + a.offsetY / a.originalH;
  const bottom = -0.5 + (a.offsetY + a.h) / a.originalH;
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

function expectedCorners(
  pose: Pose,
  r: RegionAttachment,
  a: AtlasRegion,
): Array<readonly [number, number]> {
  const world = multiply(boneWorld(pose, 'root'), sizedLocal(r));
  return trimmedUnitCorners(a).map((c) => transformPoint(world, c[0], c[1]));
}

// The world-space corners of the FIRST attachment sprite's rendered texture quad (anchor 0.5): its local
// matrix mapped over (+/- texture.width/2, +/- texture.height/2). This is the placement the user sees.
function renderedQuad(view: SkeletonView): Array<readonly [number, number]> {
  const attachmentsLayer = view.root.children[0]!;
  const sprite = attachmentsLayer.children[0];
  if (!(sprite instanceof Sprite)) throw new Error('expected an attachment sprite');
  sprite.updateLocalTransform();
  const lt = sprite.localTransform;
  const m: Mat2x3 = [lt.a, lt.b, lt.c, lt.d, lt.tx, lt.ty];
  const hw = sprite.texture.width / 2;
  const hh = sprite.texture.height / 2;
  return [
    transformPoint(m, -hw, -hh),
    transformPoint(m, hw, -hh),
    transformPoint(m, hw, hh),
    transformPoint(m, -hw, hh),
  ];
}

interface Case {
  readonly name: string;
  readonly attachment: Partial<RegionAttachment>;
  readonly atlas: Partial<AtlasRegion>;
  readonly boneRotation: number;
  // Packed page-rectangle size the resolver texture must have (w x h, or swapped for a rotated region).
  readonly pageRect: { readonly w: number; readonly h: number };
}

const CASES: readonly Case[] = [
  {
    name: 'asymmetric trim, upright bone',
    attachment: { width: 40, height: 40 },
    atlas: { w: 20, h: 12, offsetX: 3, offsetY: 11, originalW: 40, originalH: 40 },
    boneRotation: 0,
    pageRect: { w: 20, h: 12 },
  },
  {
    name: 'trim with nonuniform attachment scale and non-square size',
    attachment: { width: 60, height: 20, scaleX: 1.5, scaleY: 0.75 },
    atlas: { w: 18, h: 7, offsetX: 5, offsetY: 1, originalW: 30, originalH: 10 },
    boneRotation: 0,
    pageRect: { w: 18, h: 7 },
  },
  {
    name: 'trim under a rotated bone',
    attachment: { width: 40, height: 40, rotation: 15 },
    atlas: { w: 16, h: 30, offsetX: 8, offsetY: 2, originalW: 40, originalH: 40 },
    boneRotation: 90,
    pageRect: { w: 16, h: 30 },
  },
  {
    name: 'trim composed with a rotated (rotate=2) region',
    attachment: { width: 40, height: 40 },
    atlas: { w: 18, h: 10, offsetX: 6, offsetY: 8, originalW: 30, originalH: 24, rotated: true },
    boneRotation: 0,
    // A rotated region's page footprint is (h x w).
    pageRect: { w: 10, h: 18 },
  },
];

describe('trimmed / rotated region placement (runtime-web sprite quad vs shared formula)', () => {
  for (const testCase of CASES) {
    it(`places ${testCase.name}`, () => {
      const document = makeDocument({
        bones: [bone('root', null, { rotation: testCase.boneRotation, length: 50 })],
        slots: [slot('s', 'root', 'img')],
        skin: { s: { img: region('img', testCase.attachment) } },
        atlasOverrides: { img: testCase.atlas },
      });

      const atlasRegion = document.atlas.pages[0]!.regions.find((r) => r.name === 'img')!;
      const regionAttachment = document.skins[0]!.attachments['s']!['img'] as RegionAttachment;

      // Real resolver, built through sliceRegion so the rotated frame/orig/rotate path is exercised too.
      const page = makeSolidTexture(128, 128);
      const resolver = makeRegionTextureResolver(
        buildRegionTextures(document.atlas, new Map([['atlas.png', page]])),
      );

      const view = new SkeletonView();
      view.setTextureResolver(resolver);
      view.sync(document);

      // The resolver texture reports the LOGICAL size the placement math expects (rotate=2 keeps it w x h).
      const attachmentsLayer = view.root.children[0]!;
      const sprite = attachmentsLayer.children[0] as Sprite;
      expect(sprite.texture.width).toBe(atlasRegion.w);
      expect(sprite.texture.height).toBe(atlasRegion.h);

      const pose = solve(document);
      const expected = expectedCorners(pose, regionAttachment, atlasRegion);
      const actual = renderedQuad(view);

      actual.forEach((corner, index) => {
        expect(corner[0]).toBeCloseTo(expected[index]![0], 6);
        expect(corner[1]).toBeCloseTo(expected[index]![1], 6);
      });

      view.destroy();
    });
  }

  it('leaves an untrimmed region on the full centered quad', () => {
    const document = makeDocument({
      bones: [bone('root', null, { length: 50 })],
      slots: [slot('s', 'root', 'img')],
      skin: { s: { img: region('img', { width: 64, height: 64 }) } },
    });
    const page = makeSolidTexture(128, 128);
    const resolver = makeRegionTextureResolver(
      buildRegionTextures(document.atlas, new Map([['atlas.png', page]])),
    );
    const view = new SkeletonView();
    view.setTextureResolver(resolver);
    view.sync(document);

    const pose = solve(document);
    const world = multiply(boneWorld(pose, 'root'), sizedLocal(document.skins[0]!.attachments['s']!['img'] as RegionAttachment));
    const expected = [
      transformPoint(world, -0.5, -0.5),
      transformPoint(world, 0.5, -0.5),
      transformPoint(world, 0.5, 0.5),
      transformPoint(world, -0.5, 0.5),
    ];
    const actual = renderedQuad(view);
    actual.forEach((corner, index) => {
      expect(corner[0]).toBeCloseTo(expected[index]![0], 6);
      expect(corner[1]).toBeCloseTo(expected[index]![1], 6);
    });
    view.destroy();
  });
});
