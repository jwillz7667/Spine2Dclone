import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import { buildPose, computeWorldTransforms, resetToSetupPose } from '../src';
import { bone, makeRig } from './rig';

// A small hierarchy used by both determinism checks.
function chainRig() {
  return makeRig([
    bone('root', null, { x: 3, y: 7, rotation: 33 }),
    bone('a', 'root', { x: 20, rotation: 10 }),
    bone('b', 'a', { x: 15, rotation: -25, scaleX: 1.2 }),
    bone('c', 'b', { x: 8, rotation: 5 }),
  ]);
}

describe('determinism', () => {
  it('produces bit-identical world arrays when the same pose is solved twice', () => {
    const pose = buildPose(chainRig());
    resetToSetupPose(pose);
    computeWorldTransforms(pose);
    const first = Array.from(pose.world);

    computeWorldTransforms(pose);
    const second = Array.from(pose.world);

    expect(second).toStrictEqual(first);
  });

  it('produces equal world arrays for two independent solves of the same document', () => {
    const solve = () => {
      const pose = buildPose(chainRig());
      resetToSetupPose(pose);
      computeWorldTransforms(pose);
      return Array.from(pose.world);
    };

    expect(solve()).toStrictEqual(solve());
  });

  it('allocates no heap across repeated solves (allocation probe)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error(
        'the determinism allocation probe requires the worker to run with --expose-gc',
      );
    }

    const pose = buildPose(chainRig());
    resetToSetupPose(pose);
    // Warm up: let the JIT settle and any one-time allocation happen before measuring.
    for (let i = 0; i < 2000; i += 1) computeWorldTransforms(pose);

    runGc();
    const before = memoryUsage().heapUsed;
    const iterations = 100_000;
    for (let i = 0; i < iterations; i += 1) computeWorldTransforms(pose);
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;

    // Zero per-call allocation: 100k calls that each allocated even a 6-number array would add megabytes.
    // The remaining growth is GC/measurement noise, held under a tight threshold.
    expect(heapGrowth).toBeLessThan(256 * 1024);
  });
});
