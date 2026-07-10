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
// Depth controls (softness/stretch/compress/uniform) are ADR-0010; the default (softness 0, all flags
// false) is the hard ADR-0003 solve, exercised by the two thin wrappers below.

const worldXAngle = (m: Mat2x3): number => Math.atan2(m[1], m[0]);
const originOf = (pose: Pose, index: number): readonly [number, number] => {
  const m = resolveWorldMat(pose, index);
  return [m[4], m[5]];
};
// The bone tip is its length along its local X axis, mapped to world.
const tipOf = (pose: Pose, index: number): readonly [number, number] => {
  return transformPoint(resolveWorldMat(pose, index), pose.boneLength[index]!, 0);
};

// Hard-solve wrappers (all depth controls at their neutral defaults): the ADR-0003 behavior these tests
// assert. The depth suite below drives the extra parameters directly.
const aimOneBone = (pose: Pose, index: number, tx: number, ty: number, mix: number): void =>
  solveIkOneBone(pose, index, tx, ty, mix, false, false);
const aimTwoBone = (
  pose: Pose,
  parentIndex: number,
  childIndex: number,
  tx: number,
  ty: number,
  bendPositive: boolean,
  mix: number,
): void =>
  solveIkTwoBone(pose, parentIndex, childIndex, tx, ty, bendPositive, mix, 0, false, false, false);

describe('solveIkOneBone', () => {
  it('mix=1 points the bone X axis at the target (root bone)', () => {
    const pose = buildPose(makeRig([bone('b', null, { length: 50 })]));
    resetToSetupPose(pose);

    aimOneBone(pose, 0, 30, 30, 1);

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
    aimOneBone(pose, child, targetX, targetY, 1);

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

    aimOneBone(pose, 0, 100, 100, 0);

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

    aimTwoBone(pose, 0, 1, 120, 40, true, 1);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(120, 6);
    expect(ty).toBeCloseTo(40, 6);
  });

  it('bendPositive true vs false mirror the elbow but both reach the target', () => {
    const target: readonly [number, number] = [120, 40];

    const posePos = twoBoneRig();
    aimTwoBone(posePos, 0, 1, target[0], target[1], true, 1);
    const jointPos = originOf(posePos, 1);

    const poseNeg = twoBoneRig();
    aimTwoBone(poseNeg, 0, 1, target[0], target[1], false, 1);
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

    aimTwoBone(pose, 0, 1, 300, 0, true, 1);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(180, 6); // fully extended along +X (no stretch)
    expect(ty).toBeCloseTo(0, 6); // on the line base->target
  });

  it('mix blends between rest and the full solution', () => {
    const target: readonly [number, number] = [120, 40];

    const restTip = tipOf(twoBoneRig(), 1); // straight chain tip at (180, 0)

    const full = twoBoneRig();
    aimTwoBone(full, 0, 1, target[0], target[1], true, 1);
    const fullTip = tipOf(full, 1);

    const half = twoBoneRig();
    aimTwoBone(half, 0, 1, target[0], target[1], true, 0.5);
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

    aimTwoBone(pose, 0, 1, 120, 40, true, 0);

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
        aimTwoBone(pose, 0, 1, tx, ty, bend, 1);
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

// ADR-0010 section 2: the IK depth controls. Each is guarded on its enabling condition; the default
// (exercised by the wrappers above) is the ADR-0003 hard solve, so these tests drive the flags explicitly.
describe('IK depth (ADR-0010 section 2)', () => {
  it('one-bone stretch lengthens the bone to reach a target beyond its length', () => {
    const pose = buildPose(makeRig([bone('b', null, { length: 50 })]));
    resetToSetupPose(pose);

    // Target at (100, 0), twice the bone length. Without stretch the tip stops at 50.
    solveIkOneBone(pose, 0, 100, 0, 1, true, false);

    const [tx, ty] = tipOf(pose, 0);
    expect(tx).toBeCloseTo(100, 6);
    expect(ty).toBeCloseTo(0, 6);
  });

  it('one-bone compress shrinks the bone to reach a nearer target', () => {
    const pose = buildPose(makeRig([bone('b', null, { length: 50 })]));
    resetToSetupPose(pose);

    solveIkOneBone(pose, 0, 20, 0, 1, false, true);

    const [tx] = tipOf(pose, 0);
    expect(tx).toBeCloseTo(20, 6);
  });

  it('two-bone uniform stretch reaches a target beyond full reach with both bones scaled', () => {
    const pose = twoBoneRig(100, 80); // reach 180
    const d = 270; // 1.5x reach along +X

    solveIkTwoBone(pose, 0, 1, d, 0, true, 1, 0, true, false, true);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(d, 5);
    expect(ty).toBeCloseTo(0, 5);
    // Both world segments scaled by d/reach = 1.5, so each bone's world length grew proportionally.
    const upperLen = Math.hypot(...(originOf(pose, 1) as [number, number])); // origin of lower = upper tip
    expect(upperLen).toBeCloseTo(150, 4); // 100 * 1.5
  });

  it('two-bone non-uniform stretch grows only the parent, still reaching the target', () => {
    const pose = twoBoneRig(100, 80); // reach 180
    const d = 270;

    solveIkTwoBone(pose, 0, 1, d, 0, true, 1, 0, true, false, false);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(d, 5);
    expect(ty).toBeCloseTo(0, 5);
    // Only the parent lengthened: its world length is d - len2 = 190; the child kept its length 80.
    const upperTip = originOf(pose, 1); // lower origin == upper tip
    expect(Math.hypot(upperTip[0], upperTip[1])).toBeCloseTo(190, 4);
  });

  it('two-bone compress shrinks the chain to reach a target inside the fold dead zone', () => {
    const pose = twoBoneRig(100, 40); // dead zone radius |100 - 40| = 60
    const d = 30; // inside the dead zone along +X

    // Without compress the folded tip cannot get closer than 60; compress reaches 30.
    solveIkTwoBone(pose, 0, 1, d, 0, true, 1, 0, false, true, false);

    const [tx, ty] = tipOf(pose, 1);
    expect(tx).toBeCloseTo(d, 5);
    expect(ty).toBeCloseTo(0, 5);
  });

  it('softness eases the chain short of the hard-solve extension near full reach', () => {
    const target: readonly [number, number] = [175, 0]; // just inside reach 180

    const hard = twoBoneRig(100, 80);
    solveIkTwoBone(hard, 0, 1, target[0], target[1], true, 1, 0, false, false, false);
    const hardTip = tipOf(hard, 1);

    const soft = twoBoneRig(100, 80);
    solveIkTwoBone(soft, 0, 1, target[0], target[1], true, 1, 40, false, false, false);
    const softTip = tipOf(soft, 1);

    const reachOf = (p: readonly [number, number]): number => Math.hypot(p[0], p[1]);
    // The soft chain bends more (its tip sits closer to the base than the hard solve's) but still aims
    // along the base->target line.
    expect(reachOf(softTip)).toBeLessThan(reachOf(hardTip));
    expect(Math.atan2(softTip[1], softTip[0])).toBeCloseTo(0, 6);
  });

  it('softness 0 is byte-identical to the hard solve', () => {
    const hard = twoBoneRig();
    solveIkTwoBone(hard, 0, 1, 120, 40, true, 1, 0, false, false, false);

    const wrapped = twoBoneRig();
    aimTwoBone(wrapped, 0, 1, 120, 40, true, 1);

    expect(Array.from(hard.local)).toEqual(Array.from(wrapped.local));
  });
});
