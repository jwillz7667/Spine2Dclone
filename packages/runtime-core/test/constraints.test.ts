import { describe, expect, it } from 'vitest';
import { buildPose, decomposeWorld, sampleSkeleton, transformPoint } from '../src';
import type { Mat2x3, Pose } from '../src';
import { worldOf } from './rig';
import {
  anim,
  bone,
  fullDoc,
  ikConstraint,
  ikKey,
  transformConstraint,
  transformKey,
} from './constraint-fixtures';

// WP-2.x: sampleSkeleton step 2 samples ik/transform mix channels, step 3 solves IK then transform
// constraints (ADR-0003 section 3), step 4 reproduces the result in pose.world. These tests assert the
// solve through the FULL sample path (not the primitives in isolation, which ik.test.ts covers).

const xAngle = (m: Mat2x3): number => Math.atan2(m[1], m[0]);
const worldRotation = (pose: Pose, name: string): number =>
  decomposeWorld(worldOf(pose, name)).rotation;
const originOf = (pose: Pose, name: string): readonly [number, number] => {
  const m = worldOf(pose, name);
  return [m[4], m[5]];
};
const tipOf = (pose: Pose, name: string): readonly [number, number] => {
  const index = pose.boneNames.indexOf(name);
  return transformPoint(worldOf(pose, name), pose.boneLength[index]!, 0);
};
const noNaN = (pose: Pose): void => {
  for (const v of pose.world) expect(Number.isFinite(v)).toBe(true);
};

describe('sampleSkeleton IK constraints (step 3)', () => {
  it('one-bone IK aims the constrained bone world X axis at the target', () => {
    const document = fullDoc({
      bones: [bone('b', null, { length: 50 }), bone('target', null, { x: 30, y: 30 })],
      ikConstraints: [ikConstraint('aim', ['b'], 'target', 1, true)],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'pose', 0, pose);

    const [ox, oy] = originOf(pose, 'b');
    expect(xAngle(worldOf(pose, 'b'))).toBeCloseTo(Math.atan2(30 - oy, 30 - ox), 9);
    noNaN(pose);
  });

  it('two-bone IK places the chain tip on a reachable target', () => {
    const document = fullDoc({
      bones: [
        bone('upper', null, { length: 100 }),
        bone('lower', 'upper', { x: 100, length: 80 }),
        bone('target', null, { x: 120, y: 40 }),
      ],
      ikConstraints: [ikConstraint('leg', ['upper', 'lower'], 'target', 1, true)],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'pose', 0, pose);

    const [tx, ty] = tipOf(pose, 'lower');
    expect(tx).toBeCloseTo(120, 6);
    expect(ty).toBeCloseTo(40, 6);
    noNaN(pose);
  });

  it('an ik mix timeline ramping 0 -> 1 moves the bone across time', () => {
    const document = fullDoc({
      bones: [bone('b', null, { length: 50 }), bone('target', null, { x: 30, y: 30 })],
      ikConstraints: [ikConstraint('aim', ['b'], 'target', 0, true)],
      animations: {
        ramp: anim({ duration: 1, ik: { aim: [ikKey(0, 0, true), ikKey(1, 1, true)] } }),
      },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'ramp', 0, pose);
    const atZero = xAngle(worldOf(pose, 'b'));
    sampleSkeleton(document, 'ramp', 1, pose);
    const atOne = xAngle(worldOf(pose, 'b'));

    // mix 0 leaves the bone at its setup X angle (0); mix 1 aims it at the 45-degree target.
    expect(atZero).toBeCloseTo(0, 9);
    expect(atOne).toBeCloseTo(Math.atan2(30, 30), 9);
    expect(atOne).not.toBeCloseTo(atZero, 3);
  });

  it('a stepped bendPositive flip mirrors the elbow at the keyframe', () => {
    const document = fullDoc({
      bones: [
        bone('upper', null, { length: 100 }),
        bone('lower', 'upper', { x: 100, length: 80 }),
        bone('target', null, { x: 120, y: 40 }),
      ],
      ikConstraints: [ikConstraint('leg', ['upper', 'lower'], 'target', 1, true)],
      animations: {
        flip: anim({
          duration: 1,
          // bendPositive is sampled STEPPED (ADR-0003 section 7): false holds until t = 0.5, then true.
          ik: { leg: [ikKey(0, 1, false, 'stepped'), ikKey(0.5, 1, true)] },
        }),
      },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'flip', 0.4, pose);
    const jointBefore = originOf(pose, 'lower');
    const tipBefore = tipOf(pose, 'lower');

    sampleSkeleton(document, 'flip', 0.5, pose);
    const jointAfter = originOf(pose, 'lower');
    const tipAfter = tipOf(pose, 'lower');

    // Both bend directions still place the tip on the target.
    for (const [tx, ty] of [tipBefore, tipAfter]) {
      expect(tx).toBeCloseTo(120, 6);
      expect(ty).toBeCloseTo(40, 6);
    }
    // The elbow flips to the other side of the base->target line at the stepped key.
    const cross = (j: readonly [number, number]): number => 120 * j[1] - 40 * j[0];
    expect(Math.sign(cross(jointBefore))).toBe(-Math.sign(cross(jointAfter)));
    expect(jointBefore[1]).not.toBeCloseTo(jointAfter[1], 3);
  });
});

describe('sampleSkeleton transform constraints (step 3)', () => {
  it('mixRotate=1 makes the constrained bone world rotation track the target', () => {
    const document = fullDoc({
      bones: [bone('b', null, { rotation: 10 }), bone('target', null, { rotation: 70 })],
      transformConstraints: [transformConstraint('tc', ['b'], 'target', { mixRotate: 1 })],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'pose', 0, pose);

    expect(worldRotation(pose, 'b')).toBeCloseTo(70, 9);
    noNaN(pose);
  });

  it('a transform mix timeline overrides only the keyed channel, base holds the rest', () => {
    const document = fullDoc({
      bones: [bone('b', null, { rotation: 10 }), bone('target', null, { rotation: 70 })],
      // Base mixRotate 0 (no follow); the timeline ramps mixRotate to 1, the other channels keep base 0.
      transformConstraints: [transformConstraint('tc', ['b'], 'target', { mixRotate: 0 })],
      animations: {
        ramp: anim({
          duration: 1,
          transform: { tc: [transformKey(0, { mixRotate: 0 }), transformKey(1, { mixRotate: 1 })] },
        }),
      },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'ramp', 0, pose);
    const atZero = worldRotation(pose, 'b');
    sampleSkeleton(document, 'ramp', 1, pose);
    const atOne = worldRotation(pose, 'b');

    expect(atZero).toBeCloseTo(10, 9); // mix 0: keeps its own setup rotation
    expect(atOne).toBeCloseTo(70, 9); // mix 1: tracks the target
  });
});

describe('sampleSkeleton constraint order (IK before transform)', () => {
  it('a transform constraint reads the IK-updated target world (IK runs first)', () => {
    // aim is IK-rotated toward goal at (0, 50) => world rotation 90. follower copies aim via a transform
    // constraint (mixRotate=1). Because IK solves before transform, follower copies the POST-IK aim, not
    // aim's setup. If the order were swapped, follower would copy aim's setup rotation (0) instead.
    const document = fullDoc({
      bones: [
        bone('aim', null, { length: 50, rotation: 0 }),
        bone('goal', null, { x: 0, y: 50 }),
        bone('follower', null, { rotation: 0 }),
      ],
      ikConstraints: [ikConstraint('aimIk', ['aim'], 'goal', 1, true)],
      transformConstraints: [transformConstraint('copy', ['follower'], 'aim', { mixRotate: 1 })],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);

    sampleSkeleton(document, 'pose', 0, pose);

    const aimRotation = worldRotation(pose, 'aim');
    expect(aimRotation).toBeCloseTo(90, 6); // IK aimed it straight up
    expect(aimRotation).not.toBeCloseTo(0, 3); // proves IK moved it off setup
    expect(worldRotation(pose, 'follower')).toBeCloseTo(aimRotation, 6); // copied the post-IK aim
    noNaN(pose);
  });
});
