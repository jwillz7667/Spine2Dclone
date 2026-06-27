import { describe, expect, it } from 'vitest';
import {
  buildPose,
  computeWorldTransforms,
  getRotationDeg,
  getTranslation,
  resetToSetupPose,
} from '../src';
import { bone, makeRig, worldOf } from './rig';

// The MANDATED world-transform test (phase-0-foundations.md WP-0.4): a root rotated 90 degrees with a
// child offset along the parent X axis lands the child at (0, length), rotated 90 degrees. This pins
// the world-composition convention (child.world = parent.world * child.local) and the local layout.
describe('world transform pass', () => {
  it('rotates and translates a child through its parent (root at origin, 90 degrees)', () => {
    const length = 80;
    const pose = buildPose(
      makeRig([bone('root', null, { rotation: 90 }), bone('child', 'root', { x: length, y: 0 })]),
    );

    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    const childWorld = worldOf(pose, 'child');
    const [tx, ty] = getTranslation(childWorld);
    expect(tx).toBeCloseTo(0, 9);
    expect(ty).toBeCloseTo(length, 9);
    expect(getRotationDeg(childWorld)).toBeCloseTo(90, 9);
  });

  it('composes parent translation with rotation (root offset and rotated)', () => {
    const length = 50;
    const pose = buildPose(
      makeRig([
        bone('root', null, { x: 10, y: 5, rotation: 90 }),
        bone('child', 'root', { x: length }),
      ]),
    );

    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    const [tx, ty] = getTranslation(worldOf(pose, 'child'));
    // The child sits at the parent origin (10, 5) plus its local offset rotated 90 degrees: (0, length).
    expect(tx).toBeCloseTo(10, 9);
    expect(ty).toBeCloseTo(5 + length, 9);
  });

  it('leaves a root bone world matrix equal to its local matrix', () => {
    const pose = buildPose(makeRig([bone('root', null, { x: 12, y: 34, rotation: 17 })]));

    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    const root = worldOf(pose, 'root');
    expect(getTranslation(root)).toEqual([12, 34]);
    expect(getRotationDeg(root)).toBeCloseTo(17, 9);
  });

  it('chains a three-bone hierarchy (rotations accumulate)', () => {
    // root 90, mid +0 offset 10 on X, tip +0 offset 10 on X. Each child rotates with its parent.
    const pose = buildPose(
      makeRig([
        bone('root', null, { rotation: 90 }),
        bone('mid', 'root', { x: 10 }),
        bone('tip', 'mid', { x: 10 }),
      ]),
    );

    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    const [tx, ty] = getTranslation(worldOf(pose, 'tip'));
    expect(tx).toBeCloseTo(0, 9);
    expect(ty).toBeCloseTo(20, 9);
  });
});
