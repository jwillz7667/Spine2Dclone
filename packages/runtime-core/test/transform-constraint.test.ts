import { describe, expect, it } from 'vitest';
import {
  buildPose,
  computeWorldTransforms,
  decomposeWorld,
  resetToSetupPose,
  resolveWorldMat,
  solveTransformConstraint,
} from '../src';
import type { Pose, TransformMix, TransformOffset } from '../src';
import { bone, makeRig } from './rig';

// ADR-0003 section 5: read WORLD channels of target and bone, blend per channel in WORLD, recompose to
// a WORLD matrix, write LOCAL = inverse(parentWorld) * blendedWorld. Step 4's forward pass reproduces
// the blended world from that local.

const noMix: TransformMix = { rotate: 0, x: 0, y: 0, scaleX: 0, scaleY: 0, shearY: 0 };
const noOffset: TransformOffset = { rotation: 0, x: 0, y: 0, scaleX: 0, scaleY: 0, shearY: 0 };

// A bone and an independent target, plus a constrained bone. Indices: 0 = bone, 1 = target.
const makeConstraintPose = (): Pose => {
  const pose = buildPose(
    makeRig([
      bone('bone', null, { x: 10, y: 20, rotation: 10, scaleX: 1.2, scaleY: 0.9 }),
      bone('target', null, { x: 80, y: -30, rotation: 70, scaleX: 1.5, scaleY: 1.1 }),
    ]),
  );
  resetToSetupPose(pose);
  return pose;
};

describe('solveTransformConstraint', () => {
  it('mixRotate=1 with zero offset makes the bone world rotation track the target', () => {
    const pose = makeConstraintPose();
    const targetRotation = decomposeWorld(resolveWorldMat(pose, 1)).rotation;

    solveTransformConstraint(pose, 0, 1, { ...noMix, rotate: 1 }, noOffset);

    expect(decomposeWorld(resolveWorldMat(pose, 0)).rotation).toBeCloseTo(targetRotation, 9);
  });

  it('full mix with zero offset makes the bone world equal the target world', () => {
    const pose = makeConstraintPose();
    const targetWorld = resolveWorldMat(pose, 1);

    const fullMix: TransformMix = { rotate: 1, x: 1, y: 1, scaleX: 1, scaleY: 1, shearY: 1 };
    solveTransformConstraint(pose, 0, 1, fullMix, noOffset);

    const boneWorld = resolveWorldMat(pose, 0);
    for (let i = 0; i < 6; i += 1) {
      expect(boneWorld[i]).toBeCloseTo(targetWorld[i], 9);
    }
  });

  it('mixX=0.5 half-follows the target world x', () => {
    const pose = makeConstraintPose();
    const boneX = decomposeWorld(resolveWorldMat(pose, 0)).x;
    const targetX = decomposeWorld(resolveWorldMat(pose, 1)).x;

    solveTransformConstraint(pose, 0, 1, { ...noMix, x: 0.5 }, noOffset);

    expect(decomposeWorld(resolveWorldMat(pose, 0)).x).toBeCloseTo(
      boneX + 0.5 * (targetX - boneX),
      9,
    );
  });

  it('applies offsets additively in world space', () => {
    const pose = makeConstraintPose();
    const boneRotation = decomposeWorld(resolveWorldMat(pose, 0)).rotation;

    // mix 0 on every channel: the bone keeps its own world, then the rotation offset adds on top.
    solveTransformConstraint(pose, 0, 1, noMix, { ...noOffset, rotation: 25 });

    expect(decomposeWorld(resolveWorldMat(pose, 0)).rotation).toBeCloseTo(boneRotation + 25, 9);
  });

  it('writes a LOCAL value that the forward pass recomposes into the blended world', () => {
    // A constrained bone with a real parent: the write must be inverse(parentWorld) * blendedWorld so
    // the step-4 forward pass reproduces the blended world.
    const pose = buildPose(
      makeRig([
        bone('parent', null, { x: 5, y: 5, rotation: 30, scaleX: 1.4 }),
        bone('bone', 'parent', { x: 25, y: 0, rotation: 10 }),
        bone('target', null, { x: 90, y: 10, rotation: 55, scaleX: 0.8, scaleY: 1.3 }),
      ]),
    );
    resetToSetupPose(pose);
    const boneIndex = pose.boneNames.indexOf('bone');
    const targetIndex = pose.boneNames.indexOf('target');

    const mix: TransformMix = { rotate: 0.6, x: 0.4, y: 0.5, scaleX: 0.3, scaleY: 0.7, shearY: 0 };
    const offset: TransformOffset = { rotation: 12, x: 3, y: -2, scaleX: 0, scaleY: 0, shearY: 5 };
    solveTransformConstraint(pose, boneIndex, targetIndex, mix, offset);

    // Capture the on-demand resolved world right after the write, then run the authoritative forward
    // pass; pose.world for the bone must match (step 4 reproduces what resolveWorld saw).
    const resolved = resolveWorldMat(pose, boneIndex);
    computeWorldTransforms(pose);
    const base = boneIndex * 6;
    for (let i = 0; i < 6; i += 1) {
      expect(pose.world[base + i]).toBeCloseTo(resolved[i], 9);
    }
  });
});
