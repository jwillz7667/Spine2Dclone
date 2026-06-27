import { describe, expect, it } from 'vitest';
import {
  buildPose,
  compose,
  computeWorldTransforms,
  multiply,
  resetToSetupPose,
  resolveWorld,
  resolveWorldMat,
} from '../src';
import type { Mat2x3 } from '../src';
import { bone, makeRig, worldOf } from './rig';

// ADR-0003 section 2: resolveWorld composes a bone's ancestor chain's CURRENT local transforms with
// the SAME routine as the step-4 forward pass, so its result equals what computeWorldTransforms
// produces for that bone.

const matCloseTo = (actual: Mat2x3, expected: Mat2x3, digits = 9): void => {
  for (let i = 0; i < 6; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], digits);
  }
};

describe('resolveWorld', () => {
  it('equals a hand-composed chain for a non-trivial 3-bone hierarchy', () => {
    const pose = buildPose(
      makeRig([
        bone('root', null, { x: 10, y: 20, rotation: 25, scaleX: 1.3, scaleY: 0.8 }),
        bone('mid', 'root', { x: 40, y: 5, rotation: 15, shearX: 10 }),
        bone('tip', 'mid', { x: 30, y: -10, rotation: -35, scaleX: 1.1, scaleY: 1.4 }),
      ]),
    );
    resetToSetupPose(pose);

    const rootLocal = compose(10, 20, 25, 1.3, 0.8, 0, 0);
    const midLocal = compose(40, 5, 15, 1, 1, 10, 0);
    const tipLocal = compose(30, -10, -35, 1.1, 1.4, 0, 0);
    const expectedTip = multiply(multiply(rootLocal, midLocal), tipLocal);

    matCloseTo(resolveWorldMat(pose, pose.boneNames.indexOf('tip')), expectedTip);
  });

  it('agrees with computeWorldTransforms for every bone in the chain', () => {
    const pose = buildPose(
      makeRig([
        bone('a', null, { x: 3, y: 7, rotation: 50, scaleX: 0.9 }),
        bone('b', 'a', { x: 25, rotation: -20, scaleY: 1.2 }),
        bone('c', 'b', { x: 15, y: 4, rotation: 33, shearX: -8 }),
      ]),
    );
    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    for (const name of pose.boneNames) {
      const index = pose.boneNames.indexOf(name);
      matCloseTo(resolveWorldMat(pose, index), worldOf(pose, name));
    }
  });

  it('writes into a caller buffer at an offset without allocating', () => {
    const pose = buildPose(makeRig([bone('root', null, { x: 1, y: 2, rotation: 90 })]));
    resetToSetupPose(pose);

    const out = new Float64Array(12);
    resolveWorld(pose, 0, out, 6);

    expect(Array.from(out.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    matCloseTo(
      [out[6]!, out[7]!, out[8]!, out[9]!, out[10]!, out[11]!],
      compose(1, 2, 90, 1, 1, 0, 0),
    );
  });

  it('returns the local matrix for a root bone', () => {
    const pose = buildPose(makeRig([bone('root', null, { x: 5, y: 6, rotation: 12, scaleX: 2 })]));
    resetToSetupPose(pose);

    matCloseTo(resolveWorldMat(pose, 0), compose(5, 6, 12, 2, 1, 0, 0));
  });
});
