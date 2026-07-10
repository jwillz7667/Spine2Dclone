import { describe, expect, it } from 'vitest';
import type { Skin } from '@marionette/format/types';
import {
  applyAnimationState,
  buildPose,
  decomposeWorld,
  makeAnimationState,
  setAnimation,
} from '../src';
import type { Pose } from '../src';
import { worldOf } from './rig';
import { anim, bone, fullDoc, transformConstraint } from './constraint-fixtures';

// The multi-track twin of skin-scoping.test.ts (ADR-0011 section 4). applyAnimationState now takes an
// optional activeSkin and forwards it to the step-3 constraint solve, so a skin-scoped constraint toggles
// with the active skin under AnimationState EXACTLY as it does under single-animation sampleSkeleton. This
// asserts the two paths agree: the same rig, the same scoping, driven through the AnimationState surface.

const worldRotation = (pose: Pose, name: string): number =>
  decomposeWorld(worldOf(pose, name)).rotation;

// boneA driven by a transform constraint scoped to skin "gold"; boneB by an unscoped one; boneC by a
// constraint scoped to the always-active "default" skin. The target sits at rotation 40; a solved bone
// tracks it (mixRotate 1), an unsolved one stays at its setup rotation 0. (Same rig as skin-scoping.test.ts.)
const document = fullDoc({
  bones: [
    bone('root', null),
    bone('boneA', 'root'),
    bone('boneB', 'root'),
    bone('boneC', 'root'),
    bone('target', 'root', { rotation: 40 }),
  ],
  transformConstraints: [
    transformConstraint('tcGold', ['boneA'], 'target', { mixRotate: 1 }),
    transformConstraint('tcAlways', ['boneB'], 'target', { mixRotate: 1 }),
    transformConstraint('tcDefault', ['boneC'], 'target', { mixRotate: 1 }),
  ],
  skins: [
    { name: 'default', attachments: {}, constraints: ['tcDefault'] } as Skin,
    { name: 'gold', attachments: {}, constraints: ['tcGold'] } as Skin,
  ],
  animations: { a: anim() },
});

// Solve one AnimationState frame (a single non-looping track playing the empty animation 'a' at trackTime 0)
// under `activeSkin`, mirroring sampleSkeleton(document, 'a', 0, pose, activeSkin) on the single-animation path.
function solveState(activeSkin: string | null): Pose {
  const pose = buildPose(document);
  const state = makeAnimationState(document);
  setAnimation(state, 0, 'a', false);
  applyAnimationState(state, pose, activeSkin);
  return pose;
}

describe('skin-scoped constraints under AnimationState (ADR-0011 section 4)', () => {
  it('a scoped constraint is INACTIVE when its skin is not active (default null skin)', () => {
    const pose = solveState(null);

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(0, 6); // tcGold inactive (gold not active)
    expect(worldRotation(pose, 'boneB')).toBeCloseTo(40, 6); // tcAlways always active
    expect(worldRotation(pose, 'boneC')).toBeCloseTo(40, 6); // tcDefault: default skin always active
  });

  it('a scoped constraint is ACTIVE when its skin is the active skin', () => {
    const pose = solveState('gold');

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(40, 6); // tcGold now active
    expect(worldRotation(pose, 'boneB')).toBeCloseTo(40, 6);
    expect(worldRotation(pose, 'boneC')).toBeCloseTo(40, 6);
  });

  it('a different active skin leaves the gold-scoped constraint inactive', () => {
    const pose = solveState('silver');

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(0, 6); // silver does not scope tcGold
  });
});
