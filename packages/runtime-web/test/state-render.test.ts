import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  applyAnimationState,
  buildPose,
  makeAnimationState,
  sampleMeshVertices,
  setAnimation,
  skinMeshInto,
  updateAnimationState,
} from '@marionette/runtime-core';
import { SkeletonView } from '../src';
import { bone, makeDocument } from './rig';

// SkeletonView.syncState (ADR-0005 runtime-web mirror): solve a multi-track AnimationState through the
// same render-from-pose path the single-animation player uses. These tests prove (1) a single-track state
// renders IDENTICALLY to syncAnimated (the blended step 2 at one full-weight track is the sampler), (2) a
// second track actually reaches the rendered pose, and (3) the documented v1 mesh-DEFORM scoping: deform
// is taken from the track-0 current entry only, so an empty track 0 renders meshes as pure skin.

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

const SKIN_SCOPED_RIG_PATH = join(
  repoRoot(),
  'packages',
  'conformance',
  'src',
  'rigs',
  'rig-skin-scoped.json',
);

function loadSkinScopedRig(): SkeletonDocument {
  return parseDocument(JSON.parse(readFileSync(SKIN_SCOPED_RIG_PATH, 'utf8')), { verifyHash: false });
}

// Solve the empty 'default' animation of rig-skin-scoped under `skin` through a fresh view, returning the
// rendered bone transforms keyed by bone name. The rig scopes tcGold (drives boneA) to skin 'gold' and
// leaves tcAlways (drives boneB) unscoped.
function renderSkinScopedBones(skin: string): Map<string, { x: number; y: number; rotation: number }> {
  const document = loadSkinScopedRig();
  const view = new SkeletonView();
  view.setActiveSkin(skin);
  const state = makeAnimationState(document);
  setAnimation(state, 0, 'default', false);
  view.syncState(document, state);
  return new Map(view.describe().bones.map((b) => [b.name, b.transform]));
}

describe('SkeletonView.syncState (ADR-0005)', () => {
  it('a single full-weight track renders identically to syncAnimated at the same time', () => {
    const document = loadLimbRig();
    const t = 0.35;

    const stateView = new SkeletonView();
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'wave', false);
    updateAnimationState(state, t); // trackTime -> t (non-looping, t < duration)
    stateView.syncState(document, state);

    const directView = new SkeletonView();
    directView.syncAnimated(document, 'wave', t);

    // Bones, region attachments, and mesh vertices are bit-identical: applyAnimationState with one
    // non-additive full-weight track IS the single-animation sampler, and deform is scoped to that track.
    expect(stateView.describe()).toEqual(directView.describe());
  });

  it('a second track reaches the rendered pose (multi-track solve is applied)', () => {
    // A base rotate on the root plus an additive overlay rotate on the child; the child's rendered
    // transform must differ from the base-only render, proving track 1 contributed.
    const constRotate = (name: string, angle: number) => ({
      duration: 1,
      bones: { [name]: { rotate: [{ time: 0, value: { angle }, curve: 'linear' as const }] } },
      slots: {},
    });
    const document = makeDocument({
      bones: [bone('root', null), bone('arm', 'root', { x: 50 })],
      animations: { base: constRotate('root', 20), overlay: constRotate('arm', 30) },
    });

    const baseOnly = new SkeletonView();
    const s1 = makeAnimationState(document);
    setAnimation(s1, 0, 'base', true);
    baseOnly.syncState(document, s1);
    const armBase = baseOnly.describe().bones.find((b) => b.name === 'arm')!.transform;

    const layered = new SkeletonView();
    const s2 = makeAnimationState(document);
    setAnimation(s2, 0, 'base', true);
    const overlay = setAnimation(s2, 1, 'overlay', true);
    overlay.additive = true;
    layered.syncState(document, s2);
    const armLayered = layered.describe().bones.find((b) => b.name === 'arm')!.transform;

    expect(armLayered.rotation).not.toBeCloseTo(armBase.rotation, 3);
  });

  it('scopes mesh deform to track 0: an empty track 0 renders meshes as pure skin (v1 scope)', () => {
    const document = loadLimbRig();
    const t = 0.35;

    // Put the deforming 'wave' on track 1 only; track 0 is empty, so per the documented v1 scope the mesh
    // renders as the PURE SKIN of the state-solved pose (no deform), never track 1's deform.
    const view = new SkeletonView();
    const state = makeAnimationState(document);
    setAnimation(state, 1, 'wave', false);
    updateAnimationState(state, t);
    view.syncState(document, state);
    const rendered = view.describe().meshes.find((m) => m.slot === 'limb')!;

    // Independent reconstruction: solve the SAME state, then skin the mesh with NO deform.
    const pose = buildPose(document);
    applyAnimationState(state, pose);
    const slotIndex = pose.slotNames.indexOf('limb');
    const boneIndex = pose.slotBoneIndices[slotIndex]!;
    const pureSkin = new Float32Array(rendered.vertexCount * 2);
    skinMeshInto(meshAttachmentOf(document), pose, boneIndex, pureSkin);
    expect(rendered.vertices).toEqual(Array.from(pureSkin));

    // And prove the scope EXCLUDED deform: sampling wave's deform on top would differ.
    const withDeform = new Float32Array(rendered.vertexCount * 2);
    sampleMeshVertices(document, 'wave', t, pose, 'default', 'limb', 'limb', withDeform);
    expect(Array.from(withDeform)).not.toEqual(rendered.vertices);
  });

  it('forwards the active skin so a skin-scoped constraint toggles under multi-track playback', () => {
    const underDefault = renderSkinScopedBones('default');
    const underGold = renderSkinScopedBones('gold');

    // boneA is driven by tcGold, scoped to 'gold': its rendered transform differs once gold is active,
    // proving syncState forwarded the active skin into applyAnimationState's constraint solve.
    expect(underGold.get('boneA')!.rotation).not.toBeCloseTo(underDefault.get('boneA')!.rotation, 3);
    // boneB is driven by tcAlways (unscoped): identical under either skin.
    expect(underGold.get('boneB')!.rotation).toBeCloseTo(underDefault.get('boneB')!.rotation, 6);
  });
});

function meshAttachmentOf(document: SkeletonDocument) {
  const skin = document.skins.find((s) => s.name === 'default')!;
  const attachment = skin.attachments['limb']!['limb']!;
  if (attachment.type !== 'mesh') throw new Error('expected a mesh attachment on limb/limb');
  return attachment;
}
