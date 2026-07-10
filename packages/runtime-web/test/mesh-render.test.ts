import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Container, Mesh, Sprite } from 'pixi.js';
import { parseDocument } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { buildPose, sampleMeshVertices, sampleSkeleton } from '@marionette/runtime-core';
import { makeRegionTextureResolver, SkeletonView } from '../src';
import { bone, makeDocument, mesh, region, slot } from './rig';
import { makeSolidTexture } from './texture-fixtures';

// WP-2.11 renderer slice: SkeletonView renders MESH attachments. The solve itself is parity-locked by
// mesh-limb-rig.dod.test.ts (editor path vs playback path, exact equality); these tests prove the RENDER
// wiring on top of it: a mesh slot builds a Mesh display whose geometry position buffer holds exactly
// the runtime-core solve output, swaps flip between the sprite and the mesh display, color multiplies
// slot x mesh, textures bind through the same resolver regions use, and the scene stays structurally
// stable across frames (no display-object churn in steady state).

// The committed Phase 2 DoD rig: weighted, IK-driven, deform-wobbling (the real thing, not a synthetic
// quad), loaded exactly as a player loads a document.
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root not found above the test file');
    dir = parent;
  }
  return dir;
}

const RIG_PATH = join(
  repoRoot(),
  'packages',
  'conformance',
  'assets',
  'mesh-limb-rig',
  'mesh-limb-rig.rig.json',
);

function loadLimbRig(): SkeletonDocument {
  return parseDocument(JSON.parse(readFileSync(RIG_PATH, 'utf8')));
}

// A one-bone document whose slot shows an unweighted 64x64 quad mesh, the minimal structural case.
function meshDocument(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null, { x: 10, y: 20 })],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: mesh('body') } },
    name: 'mesh-rig',
  });
}

function attachmentsLayerOf(view: SkeletonView): Container {
  return view.root.children[0] as Container;
}

function meshChildrenOf(view: SkeletonView): Mesh[] {
  return attachmentsLayerOf(view).children.filter((child): child is Mesh => child instanceof Mesh);
}

function spriteChildrenOf(view: SkeletonView): Sprite[] {
  return attachmentsLayerOf(view).children.filter(
    (child): child is Sprite => child instanceof Sprite,
  );
}

describe('SkeletonView mesh rendering (WP-2.11 renderer slice)', () => {
  it('renders an unweighted mesh at setup pose: world vertices are the slot-bone transform of the locals', () => {
    const view = new SkeletonView();
    view.sync(meshDocument());

    const scene = view.describe();
    expect(scene.attachments).toHaveLength(0);
    expect(scene.meshes).toHaveLength(1);
    const rendered = scene.meshes[0]!;
    expect(rendered.slot).toBe('body');
    expect(rendered.attachment).toBe('body');
    expect(rendered.vertexCount).toBe(4);
    // The root bone translates (10, 20) with no rotation/scale, so world = local + (10, 20).
    expect(rendered.vertices).toEqual([-22, -12, 42, -12, 42, 52, -22, 52]);

    // The mesh display is visible; the pooled sprite for the slot is not.
    const meshes = meshChildrenOf(view);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.visible).toBe(true);
    expect(spriteChildrenOf(view).every((sprite) => !sprite.visible)).toBe(true);
  });

  it('renders the committed weighted + IK + deform rig with EXACTLY the parity-tested solve output', () => {
    const document = loadLimbRig();
    const view = new SkeletonView();
    const t = 0.35;
    view.syncAnimated(document, 'wave', t);

    const rendered = view.describe().meshes.find((m) => m.slot === 'limb');
    expect(rendered).toBeDefined();

    // Independent second call site: the same public solve symbols the WP-2.11 DoD parity test locks.
    const pose = buildPose(document);
    sampleSkeleton(document, 'wave', t, pose);
    const expected = new Float32Array(rendered!.vertexCount * 2);
    sampleMeshVertices(document, 'wave', t, pose, 'default', 'limb', 'limb', expected);
    expect(rendered!.vertices).toEqual(Array.from(expected));
  });

  it('actually moves the rendered mesh between two distinct in-cycle times (not vacuous)', () => {
    const document = loadLimbRig();
    const view = new SkeletonView();
    view.syncAnimated(document, 'wave', 0.1);
    const early = view.describe().meshes.find((m) => m.slot === 'limb')!.vertices;
    view.syncAnimated(document, 'wave', 0.35);
    const late = view.describe().meshes.find((m) => m.slot === 'limb')!.vertices;
    expect(late).not.toEqual(early);
  });

  it('swaps between the sprite and the mesh display through an attachment timeline', () => {
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('arm', 'root', 'flat')],
      skin: { arm: { flat: region('flat'), bendy: mesh('bendy') } },
      animations: {
        swap: {
          duration: 1,
          bones: {},
          slots: {
            arm: {
              attachment: [
                { time: 0, name: 'flat' },
                { time: 0.5, name: 'bendy' },
              ],
            },
          },
        },
      },
    });
    const view = new SkeletonView();
    const meshDisplay = (): Mesh => meshChildrenOf(view)[0]!;

    view.syncAnimated(document, 'swap', 0);
    expect(view.describe().attachments).toHaveLength(1);
    expect(view.describe().meshes).toHaveLength(0);
    expect(meshDisplay().visible).toBe(false);

    view.syncAnimated(document, 'swap', 0.75);
    expect(view.describe().attachments).toHaveLength(0);
    expect(view.describe().meshes).toHaveLength(1);
    expect(meshDisplay().visible).toBe(true);
    expect(spriteChildrenOf(view)[0]!.visible).toBe(false);

    // Swapping back hides the mesh display again (the O(1) swap-away path).
    view.syncAnimated(document, 'swap', 0);
    expect(meshDisplay().visible).toBe(false);
    expect(spriteChildrenOf(view)[0]!.visible).toBe(true);
  });

  it('keeps the scene structurally stable across frames: same display objects, no churn', () => {
    const document = loadLimbRig();
    const view = new SkeletonView();
    view.syncAnimated(document, 'wave', 0.1);
    const childrenBefore = [...attachmentsLayerOf(view).children];
    view.syncAnimated(document, 'wave', 0.35);
    view.syncAnimated(document, 'wave', 0.6);
    const childrenAfter = [...attachmentsLayerOf(view).children];
    expect(childrenAfter).toHaveLength(childrenBefore.length);
    childrenAfter.forEach((child, i) => expect(child).toBe(childrenBefore[i]));
  });

  it('binds the resolved region texture to the mesh and multiplies slot x mesh color', () => {
    const texture = makeSolidTexture(32, 16);
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('body', 'root', 'body', { color: { r: 0.5, g: 1, b: 0, a: 0.5 } })],
      skin: { body: { body: mesh('body') } },
    });
    const view = new SkeletonView();
    view.setTextureResolver(makeRegionTextureResolver(new Map([['body', texture]])));
    view.sync(document);

    const display = meshChildrenOf(view)[0]!;
    expect(display.texture).toBe(texture);
    const rendered = view.describe().meshes[0]!;
    expect(rendered.tint).toBe(0x80ff00);
    expect(rendered.alpha).toBe(0.5);

    // The geometry uvs are the authored mesh uvs (Pixi maps them through the texture's frame matrix).
    expect(Array.from(display.geometry.uvs)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('interleaves sprites and mesh displays in slot draw order', () => {
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('back', 'root', 'back'), slot('front', 'root', 'front')],
      skin: { back: { back: mesh('back') }, front: { front: region('front') } },
    });
    const view = new SkeletonView();
    view.sync(document);

    const layer = attachmentsLayerOf(view);
    const backMesh = meshChildrenOf(view)[0]!;
    const frontSprite = spriteChildrenOf(view)[1]!;
    expect(layer.getChildIndex(backMesh)).toBeLessThan(layer.getChildIndex(frontSprite));
    expect(view.describe().meshes[0]!.slot).toBe('back');
    expect(view.describe().attachments[0]!.slot).toBe('front');
  });

  it('clear() releases the mesh displays and a later sync rebuilds them', () => {
    const view = new SkeletonView();
    view.sync(meshDocument());
    expect(meshChildrenOf(view)).toHaveLength(1);

    view.clear();
    expect(attachmentsLayerOf(view).children).toHaveLength(0);
    expect(view.describe()).toEqual({ bones: [], attachments: [], meshes: [], clips: [] });

    view.sync(meshDocument());
    expect(meshChildrenOf(view)).toHaveLength(1);
    expect(view.describe().meshes).toHaveLength(1);
  });
});
