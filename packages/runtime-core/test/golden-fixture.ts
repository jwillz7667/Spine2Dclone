import type { SkeletonDocument } from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../src/math/affine';
import { buildPose, computeWorldTransforms, resetToSetupPose } from '../src';
import type { Pose } from '../src';

// A small but non-trivial rig that exercises composition: a root rotated 90 degrees at the origin and
// a child offset along the parent X axis. The child world translation lands at (0, length), so a
// compose-order or multiply-order regression visibly moves it (golden.test.ts catches that). Only the
// bones are read by the Phase-0 solve; the rest of the document is a type-complete minimum.
export const GOLDEN_RIG_ID = 'phase0-root-child';

function setupBone(
  name: string,
  parent: string | null,
  x: number,
  y: number,
  rotation: number,
): SkeletonDocument['bones'][number] {
  return {
    name,
    parent,
    length: 100,
    x,
    y,
    rotation,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
  };
}

export function goldenRig(): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name: GOLDEN_RIG_ID,
    hash: '',
    bones: [setupBone('root', null, 0, 0, 90), setupBone('child', 'root', 100, 0, 0)],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: { pages: [] },
  };
}

// Solve the rig at the setup pose (steps 1 and 4) and return the populated Pose.
export function solveGolden(): Pose {
  const pose = buildPose(goldenRig());
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  return pose;
}

// Serialize the solved world transforms in the conformance fixture layout (conformance-and-ci.md
// appendix A.3): one sample at the setup pose, bones keyed in document order, each a 2x3 affine
// [a, b, c, d, tx, ty]. Deterministic by construction: stable key order, JavaScript shortest
// round-trippable floats, trailing newline. This same function backs the generator and the test, so
// committed bytes and re-derived bytes are identical.
export function serializeGolden(pose: Pose): string {
  const bones: Record<string, number[]> = {};
  for (let i = 0; i < pose.boneCount; i += 1) {
    const name = pose.boneNames[i];
    if (name === undefined) continue;
    const base = i * MAT2X3_STRIDE;
    bones[name] = Array.from(pose.world.subarray(base, base + MAT2X3_STRIDE));
  }
  const fixture = {
    rigId: GOLDEN_RIG_ID,
    generatedBy: 'packages/runtime-core gen-golden.mts (WP-0.4, solve steps 1 and 4, setup pose)',
    note: 'Phase-0 frozen seed: reset to setup pose plus world transforms only. No animation, skinning, or draw order. Regenerate with pnpm gen:golden; a compose/multiply order change alters these values.',
    samples: [{ time: 0, animation: 'setup', bones }],
  };
  return `${JSON.stringify(fixture, null, 2)}\n`;
}
