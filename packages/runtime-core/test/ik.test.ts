import { describe, expect, it } from 'vitest';
import {
  buildPose,
  resetToSetupPose,
  resolveWorldMat,
  solveIkOneBone,
  solveIkTwoBone,
  transformPoint,
} from '../src';
import type { Mat2x3, Pose } from '../src';
import { bone, makeRig } from './rig';

// ADR-0003 section 4: IK reads WORLD positions and writes LOCAL rotation blended by mix. One-bone aims
// a single bone's X axis at the target; two-bone uses the law of cosines on the two segment lengths.

const worldXAngle = (m: Mat2x3): number => Math.atan2(m[1], m[0]);
const originOf = (pose: Pose, index: number): readonly [number, number] => {
  const m = resolveWorldMat(pose, index);
  return [m[4], m[5]];
};
// The bone tip is its length along its local X axis, mapped to world.
const tipOf = (pose: Pose, index: number): readonly [number, number] => {
  return transformPoint(resolveWorldMat(pose, index), pose.boneLength[index]!, 0);
};

describe('solveIkOneBone', () => {
  it('mix=1 points the bone X axis at the target (root bone)', () => {
    const pose = buildPose(makeRig([bone('b', null, { length: 50 })]));
    resetToSetupPose(pose);

    solveIkOneBone(pose, 0, 30, 30, 1);

    const [ox, oy] = originOf(pose, 0);
    expect(worldXAngle(resolveWorldMat(pose, 0))).toBeCloseTo(Math.atan2(30 - oy, 30 - ox), 9);
  });

  it('mix=1 aims correctly through a rotated, non-uniformly scaled, sheared parent', () => {
    const pose = buildPose(
      makeRig([
        bone('parent', null, { x: 5, y: -3, rotation: 40, scaleX: 1.6, scaleY: 0.7, shearX: 12 }),
        bone('child', 'parent', { x: 20, y: 8, rotation: 17 }),
      ]),
    );
    resetToSetupPose(pose);
    const child = pose.boneNames.indexOf('child');

    const targetX = 80;
    const targetY = -40;
    solveIkOneBone(pose, child, targetX, targetY, 1);

    const [ox, oy] = originOf(pose, child);
    // World X axis points from the bone origin straight at the target, regardless of parent shear.
    expect(worldXAngle(resolveWorldMat(pose, child))).toBeCloseTo(
      Math.atan2(targetY - oy, targetX - ox),
      9,
    );
  });

  it('mix=0 leaves the bone unchanged', () => {
    const pose = buildPose(makeRig([bone('b', null, { rotation: 33, length: 50 })]));
    resetToSetupPose(pose);
    const before = pose.local.slice();

    solveIkOneBone(pose, 0, 100, 100, 0);

    expect(Array.from(pose.local)).toEqual(Array.from(before));
  });
});

// A standard upper/lower two-bone chain: lower is positioned at the upper's tip (x = upper.length).
const twoBoneRig = (upperLen = 100, lowerLen = 80): Pose => {
  const pose = buildPose(
    makeRig([
      bone('upper', null, { length: upperLen }),
      bone('lower', 'upper', { x: upperLen, length: lowerLen }),
    ]),
  );
  resetToSetupPose(pose);
  return pose;
};

describe('solveIkTwoBone', () => {
  it('mix=1 places the chain tip on a reachable target', () => {
    const pose = twoBoneRig();

    solveIkTwoBone(pose, 0, 1, 120, 40, true, 1);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(120, 6);
    expect(ty).toBeCloseTo(40, 6);
  });

  it('bendPositive true vs false mirror the elbow but both reach the target', () => {
    const target: readonly [number, number] = [120, 40];

    const posePos = twoBoneRig();
    solveIkTwoBone(posePos, 0, 1, target[0], target[1], true, 1);
    const jointPos = originOf(posePos, 1);

    const poseNeg = twoBoneRig();
    solveIkTwoBone(poseNeg, 0, 1, target[0], target[1], false, 1);
    const jointNeg = originOf(poseNeg, 1);

    // Both solutions reach the target.
    for (const pose of [posePos, poseNeg]) {
      const [tx, ty] = tipOf(pose, 1);
      expect(tx).toBeCloseTo(target[0], 6);
      expect(ty).toBeCloseTo(target[1], 6);
    }

    // The joints sit on opposite sides of the base->target line (signed cross product flips).
    const cross = (j: readonly [number, number]): number => target[0] * j[1] - target[1] * j[0];
    expect(Math.sign(cross(jointPos))).toBe(-Math.sign(cross(jointNeg)));
    expect(jointPos[1]).not.toBeCloseTo(jointNeg[1], 3);
  });

  it('straightens toward an unreachable target (tip on the line, chain extended)', () => {
    const pose = twoBoneRig(100, 80); // max reach 180

    solveIkTwoBone(pose, 0, 1, 300, 0, true, 1);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(180, 6); // fully extended along +X
    expect(ty).toBeCloseTo(0, 6); // on the line base->target
  });

  it('mix blends between rest and the full solution', () => {
    const target: readonly [number, number] = [120, 40];

    const restTip = tipOf(twoBoneRig(), 1); // straight chain tip at (180, 0)

    const full = twoBoneRig();
    solveIkTwoBone(full, 0, 1, target[0], target[1], true, 1);
    const fullTip = tipOf(full, 1);

    const half = twoBoneRig();
    solveIkTwoBone(half, 0, 1, target[0], target[1], true, 0.5);
    const halfTip = tipOf(half, 1);

    const dist = (p: readonly [number, number]): number =>
      Math.hypot(p[0] - target[0], p[1] - target[1]);

    // Partial mix lands strictly between doing nothing and the full reach.
    expect(dist(halfTip)).toBeLessThan(dist(restTip));
    expect(dist(halfTip)).toBeGreaterThan(dist(fullTip));
  });

  it('mix=0 leaves the chain unchanged', () => {
    const pose = twoBoneRig();
    const before = pose.local.slice();

    solveIkTwoBone(pose, 0, 1, 120, 40, true, 0);

    expect(Array.from(pose.local)).toEqual(Array.from(before));
  });

  it('produces no NaN over a sweep of targets including degenerate ones', () => {
    const sweep: ReadonlyArray<readonly [number, number]> = [
      [0, 0], // target on the base origin
      [1e-9, 0], // target extremely close
      [120, 40],
      [-50, 90],
      [180, 0], // exactly at full reach
      [400, 400], // far unreachable
      [-300, -10],
    ];

    for (const [tx, ty] of sweep) {
      for (const bend of [true, false]) {
        const pose = twoBoneRig();
        solveIkTwoBone(pose, 0, 1, tx, ty, bend, 1);
        for (const value of pose.local) {
          expect(Number.isFinite(value)).toBe(true);
        }
        const [px, py] = tipOf(pose, 1);
        expect(Number.isFinite(px)).toBe(true);
        expect(Number.isFinite(py)).toBe(true);
      }
    }
  });
});
