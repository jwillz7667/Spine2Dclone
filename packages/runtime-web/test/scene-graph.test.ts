import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { FormatValidationError } from '@marionette/format';
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
import type { SkeletonDocument } from '@marionette/format/types';
import { makeRegionTextureResolver, SkeletonView } from '../src';
import { bone, makeDocument, minimalDocument, region, slot } from './rig';
import { makeSolidTexture } from './texture-fixtures';

// Independently solve a document and read a bone world matrix, so assertions compare SkeletonView's
// scene against runtime-core's output rather than against itself.
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

// The two layers SkeletonView mounts under root: attachments first (drawn under), bones second.
function layers(view: SkeletonView): { attachments: Container; bones: Container } {
  return { attachments: view.root.children[0]!, bones: view.root.children[1]! };
}

function countDescendants(container: Container): number {
  let total = container.children.length;
  for (const child of container.children) total += countDescendants(child);
  return total;
}

function firstSprite(view: SkeletonView): Sprite {
  const child = layers(view).attachments.children[0];
  if (!(child instanceof Sprite)) throw new Error('expected an attachment sprite');
  return child;
}

// The four world-space corners of the first attachment sprite's rendered texture quad. A Pixi Sprite
// (anchor 0.5) draws its texture from (-w/2, -h/2) to (w/2, h/2) in local space; mapping those corners
// through the sprite's local matrix yields where the quad actually lands in world space. This is the
// real placement (what the user sees), independent of the texture's pixel size, so it is the right thing
// to compare across a placeholder vs a real texture.
function regionWorldQuad(view: SkeletonView): Array<readonly [number, number]> {
  const sprite = firstSprite(view);
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

describe('SkeletonView setup-pose scene graph', () => {
  it('builds exactly one bone graphic and one attachment sprite from the minimal rig', () => {
    const view = new SkeletonView();
    view.sync(minimalDocument());

    const { attachments, bones } = layers(view);
    expect(bones.children).toHaveLength(1);
    expect(attachments.children).toHaveLength(1);

    const scene = view.describe();
    expect(scene.bones).toHaveLength(1);
    expect(scene.attachments).toHaveLength(1);
    expect(scene.bones[0]!.name).toBe('root');
    expect(scene.attachments[0]!.slot).toBe('body');
    expect(scene.attachments[0]!.attachment).toBe('body');
  });

  it('places the attachment sprite at the solved world position (root at origin)', () => {
    const view = new SkeletonView();
    const document = minimalDocument();
    view.sync(document);

    const pose = solve(document);
    const [wx, wy] = transformPoint(boneWorld(pose, 'root'), 0, 0);
    const [sx, sy] = view.describe().attachments[0]!.worldPosition;
    expect(sx).toBeCloseTo(wx, 6);
    expect(sy).toBeCloseTo(wy, 6);
    expect(sx).toBeCloseTo(0, 6);
    expect(sy).toBeCloseTo(0, 6);
  });

  it('composes bone world, attachment offset, and size into the sprite local transform', () => {
    const document = makeDocument({
      bones: [bone('root', null, { x: 10, y: 20, rotation: 90 })],
      slots: [slot('body', 'root', 'body')],
      skin: { body: { body: region('body', { x: 5, y: 0, width: 40, height: 80 }) } },
    });

    const view = new SkeletonView();
    view.sync(document);

    // Independently recompute spriteWorld = boneWorld * attachmentLocal * scale(width, height).
    const pose = solve(document);
    const attachmentLocal = compose(5, 0, 0, 1, 1, 0, 0);
    const sized = multiply(attachmentLocal, [40, 0, 0, 80, 0, 0]);
    const spriteWorld = multiply(boneWorld(pose, 'root'), sized);

    // The attachment origin in world space is the bone world transform applied to the offset.
    const [wx, wy] = transformPoint(boneWorld(pose, 'root'), 5, 0);
    const [sx, sy] = view.describe().attachments[0]!.worldPosition;
    expect(sx).toBeCloseTo(wx, 6);
    expect(sy).toBeCloseTo(wy, 6);

    // End-to-end fidelity: the real Pixi sprite's local matrix reproduces spriteWorld.
    const child = layers(view).attachments.children[0]!;
    expect(child).toBeInstanceOf(Sprite);
    child.updateLocalTransform();
    const lt = child.localTransform;
    const actual: Mat2x3 = [lt.a, lt.b, lt.c, lt.d, lt.tx, lt.ty];
    for (let i = 0; i < 6; i += 1) {
      expect(actual[i]).toBeCloseTo(spriteWorld[i]!, 6);
    }
  });

  it('tints the sprite by the slot color times the attachment color, alpha multiplied', () => {
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('body', 'root', 'body', { color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } })],
      skin: { body: { body: region('body', { color: { r: 1, g: 0.5, b: 0.25, a: 0.8 } }) } },
    });

    const view = new SkeletonView();
    view.sync(document);

    // pack(0.5*1, 0.5*0.5, 0.5*0.25) = pack(0.5, 0.25, 0.125) -> 0x804020; alpha = 1 * 0.8.
    const render = view.describe().attachments[0]!;
    expect(render.tint).toBe(0x804020);
    expect(render.alpha).toBeCloseTo(0.8, 9);

    const child = layers(view).attachments.children[0]!;
    expect(child).toBeInstanceOf(Sprite);
    if (child instanceof Sprite) {
      expect(child.tint).toBe(0x804020);
      expect(child.alpha).toBeCloseTo(0.8, 9);
      expect(child.x).toBeCloseTo(render.transform.x, 9);
      expect(child.y).toBeCloseTo(render.transform.y, 9);
    }
  });

  it('renders attachment sprites in slot (draw) order', () => {
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('back', 'root', 'back'), slot('front', 'root', 'front')],
      skin: {
        back: { back: region('back') },
        front: { front: region('front') },
      },
    });

    const view = new SkeletonView();
    view.sync(document);

    const scene = view.describe();
    expect(scene.attachments.map((a) => a.slot)).toEqual(['back', 'front']);
    expect(layers(view).attachments.children).toHaveLength(2);
  });

  it('reuses display objects across a sync with the same structure', () => {
    const view = new SkeletonView();
    const document = minimalDocument();

    view.sync(document);
    const before = countDescendants(view.root);
    view.sync(document);
    const after = countDescendants(view.root);

    expect(after).toBe(before);
  });

  it('grows and shrinks the sprite pool on a structural change', () => {
    const view = new SkeletonView();

    view.sync(minimalDocument());
    expect(layers(view).attachments.children).toHaveLength(1);

    view.sync(
      makeDocument({
        bones: [bone('root', null)],
        slots: [slot('back', 'root', 'back'), slot('front', 'root', 'front')],
        skin: { back: { back: region('back') }, front: { front: region('front') } },
      }),
    );
    expect(layers(view).attachments.children).toHaveLength(2);

    view.sync(minimalDocument());
    expect(layers(view).attachments.children).toHaveLength(1);
  });

  it('clears to an empty scene, releasing every display object, and rebuilds on the next sync', () => {
    const view = new SkeletonView();
    view.sync(minimalDocument());

    view.clear();

    const { attachments, bones } = layers(view);
    expect(bones.children).toHaveLength(0);
    expect(attachments.children).toHaveLength(0);
    expect(view.describe().bones).toHaveLength(0);
    expect(view.describe().attachments).toHaveLength(0);

    // The view stays reusable: a later sync rebuilds the pools from scratch.
    view.sync(minimalDocument());
    expect(layers(view).bones.children).toHaveLength(1);
    expect(layers(view).attachments.children).toHaveLength(1);
  });

  it('binds the resolved region texture, falling back to Texture.WHITE when unresolved', () => {
    const document = minimalDocument(); // slot "body" shows region whose path is "body"
    const texture = makeSolidTexture(48, 16);

    const view = new SkeletonView();
    // No resolver yet: the placeholder (Texture.WHITE) is bound.
    view.sync(document);
    expect(firstSprite(view).texture).toBe(Texture.WHITE);

    // A resolver that knows "body": the real texture is bound after a re-sync (setTextureResolver
    // invalidates the cached scene, so the next sync rebuilds the binding).
    view.setTextureResolver(makeRegionTextureResolver(new Map([['body', texture]])));
    view.sync(document);
    expect(firstSprite(view).texture).toBe(texture);

    // A resolver that returns null for everything: fall back to the placeholder (partial atlas case).
    view.setTextureResolver(() => null);
    view.sync(document);
    expect(firstSprite(view).texture).toBe(Texture.WHITE);

    // Clearing the resolver also returns to the placeholder.
    view.setTextureResolver(makeRegionTextureResolver(new Map([['body', texture]])));
    view.sync(document);
    expect(firstSprite(view).texture).toBe(texture);
    view.setTextureResolver(null);
    view.sync(document);
    expect(firstSprite(view).texture).toBe(Texture.WHITE);
  });

  it('renders a real atlas texture at the byte-identical world placement as the placeholder', () => {
    // A full-affine placement (translated + rotated bone, offset + rotated region) so the invariant is
    // tested against more than a translation, and an authored region size (40x80) that differs from the
    // texture pixel size (64x32), which is exactly what the size normalization must reconcile.
    const document = makeDocument({
      bones: [bone('root', null, { x: 10, y: 20, rotation: 30 })],
      slots: [slot('body', 'root', 'body')],
      skin: {
        body: { body: region('body', { x: 5, y: -3, rotation: 15, width: 40, height: 80 }) },
      },
    });

    // Placeholder render: no resolver, so the sprite shows Texture.WHITE (1x1).
    const placeholderView = new SkeletonView();
    placeholderView.sync(document);
    const placeholderQuad = regionWorldQuad(placeholderView);
    const placeholderCenter = placeholderView.describe().attachments[0]!.worldPosition;

    // Real-texture render: 64x32, deliberately non-unit AND non-square so a wrong normalization (e.g. a
    // single uniform factor, or none) would visibly distort the quad.
    const texture = makeSolidTexture(64, 32);
    const texturedView = new SkeletonView();
    texturedView.setTextureResolver(makeRegionTextureResolver(new Map([['body', texture]])));
    texturedView.sync(document);
    const texturedQuad = regionWorldQuad(texturedView);
    const texturedCenter = texturedView.describe().attachments[0]!.worldPosition;

    // The two renders genuinely differ in the texture bound to the sprite (64x32 vs the 1x1 placeholder).
    expect(firstSprite(texturedView).texture).toBe(texture);
    expect([texture.width, texture.height]).toEqual([64, 32]);
    expect(firstSprite(placeholderView).texture).toBe(Texture.WHITE);
    expect([Texture.WHITE.width, Texture.WHITE.height]).toEqual([1, 1]);

    // INVARIANT (handoff 8.9): the texture only fills the quad, it must not move the attachment. The
    // center (the sprite-world translation that describe() exposes) is identical, and every corner of the
    // rendered quad is identical to 1e-9, even though one sprite carries a 64x32 texture and the other a
    // 1x1 placeholder. This proves the size normalization keeps a real texture exactly where the
    // placeholder was. (The sprite's decomposed SCALE necessarily differs by texW/texH, which is the
    // normalization doing its job; the placement, the world quad, is what must be invariant.)
    expect(texturedCenter[0]).toBeCloseTo(placeholderCenter[0], 9);
    expect(texturedCenter[1]).toBeCloseTo(placeholderCenter[1], 9);
    for (let i = 0; i < 4; i += 1) {
      expect(texturedQuad[i]![0]).toBeCloseTo(placeholderQuad[i]![0], 9);
      expect(texturedQuad[i]![1]).toBeCloseTo(placeholderQuad[i]![1], 9);
    }
  });

  it('treats the content hash as opaque by default but verifies it on request', () => {
    const wrongHash = '0'.repeat(64);
    const tampered = { ...minimalDocument(), hash: wrongHash };

    const view = new SkeletonView();
    // Default: runtimes do not verify the hash, so a mismatched-but-well-formed hash still renders.
    expect(() => view.sync(tampered)).not.toThrow();
    expect(view.describe().attachments).toHaveLength(1);

    // Opt back in: the same document now fails with HASH_MISMATCH.
    let thrown: unknown;
    try {
      view.sync(tampered, { verifyHash: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FormatValidationError);
    if (thrown instanceof FormatValidationError) {
      expect(thrown.report.errors.map((e) => e.code)).toContain('HASH_MISMATCH');
    }
  });

  it('rejects an invalid document before any solve and surfaces a typed error', () => {
    const view = new SkeletonView();

    let thrown: unknown;
    try {
      view.sync({ formatVersion: '0.1.0', name: 'broken' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FormatValidationError);
    if (thrown instanceof FormatValidationError) {
      expect(thrown.report.errors.length).toBeGreaterThan(0);
    }
    // No display objects were created: only the two empty layers exist.
    const { attachments, bones } = layers(view);
    expect(attachments.children).toHaveLength(0);
    expect(bones.children).toHaveLength(0);
    expect(view.describe().bones).toHaveLength(0);
    expect(view.describe().attachments).toHaveLength(0);
  });
});
