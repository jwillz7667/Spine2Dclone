import { describe, expect, it, vi } from 'vitest';
import type { SkeletonDocument } from '@marionette/format/types';
import * as runtimeCore from '@marionette/runtime-core';
import { buildPose, sampleSkeleton } from '@marionette/runtime-core';
import { samplePlaybackWorlds } from '../src';
import { bone, makeDocument } from './rig';

// WP-1.10 acceptance, section 8.5: probe the exported-rig playback hot path for (a) no per-frame pose
// allocation and (b) a sane per-frame sample cost. These are smoke gates, not benchmarks.
//
// On the allocation probe we assert BUFFER IDENTITY rather than process.memoryUsage().heapUsed: the
// runtime-web Vitest worker is not launched with --expose-gc (only document-core's is), so a heapUsed
// delta without a forced GC is dominated by allocator/JIT noise and would flake. Buffer identity is the
// precise statement of the invariant we care about (sampleSkeleton writes into the pre-allocated pose
// and never reallocates it), so it is both stronger and non-flaky.

// A four-bone chain with several channels, so the world pass and the channel application do real work.
function perfRig(): SkeletonDocument {
  return makeDocument({
    bones: [
      bone('root', null),
      bone('b1', 'root', { x: 40, length: 40 }),
      bone('b2', 'b1', { x: 40, length: 40 }),
      bone('b3', 'b2', { x: 40, length: 40 }),
    ],
    animations: {
      spin: {
        duration: 1,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 90 }, curve: 'linear' },
            ],
            translate: [
              { time: 0, value: { x: 0, y: 0 }, curve: 'linear' },
              { time: 1, value: { x: 12, y: -8 }, curve: 'linear' },
            ],
          },
          b1: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: -45 }, curve: 'linear' },
            ],
          },
          b2: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 30 }, curve: 'linear' },
            ],
          },
          b3: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 60 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
      },
    },
  });
}

describe('playback perf probes (WP-1.10 section 8.5)', () => {
  it('reuses the pose world buffer across frames (no per-frame pose allocation)', () => {
    const document = perfRig();
    const pose = buildPose(document);
    // The pose buffers are Float64Array (f64 solve precision); capture the references the sampler must
    // keep writing into rather than reallocating.
    const worldBuffer = pose.world;
    const localBuffer = pose.local;

    for (let i = 0; i < 600; i += 1) {
      sampleSkeleton(document, 'spin', (i % 60) / 60, pose);
    }

    expect(pose.world).toBe(worldBuffer);
    expect(pose.local).toBe(localBuffer);
  });

  it('builds the pose exactly once regardless of how many frames are sampled', () => {
    const document = perfRig();
    const spy = vi.spyOn(runtimeCore, 'buildPose');
    try {
      const times = Array.from({ length: 240 }, (_, k) => (k % 60) / 60);
      samplePlaybackWorlds(document, 'spin', times);
      // The harness builds the pose once up front and reuses it for every time in the list.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('samples a frame well under the smoke-test budget', () => {
    const document = perfRig();
    const pose = buildPose(document);
    const sample = (t: number): void => {
      sampleSkeleton(document, 'spin', t, pose);
    };

    // Warm the JIT and the prepared-animation cache so the measurement reflects steady state, not the
    // first-sample track build.
    for (let i = 0; i < 256; i += 1) sample((i % 60) / 60);

    const frames = 1000;
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) sample((i % 60) / 60);
    const meanMicros = ((performance.now() - start) / frames) * 1000;

    // A four-bone single-period solve costs single-digit microseconds warm. BUDGET_MICROS is ~2 orders
    // of magnitude of headroom, so it does not flake on a slow shared CI core, yet still trips on a
    // catastrophic regression (a per-frame allocation storm, or an accidental O(n^2) in the solve).
    // Averaging over 1000 frames dilutes a one-off GC or scheduler pause to a negligible per-frame delta.
    const BUDGET_MICROS = 300;
    expect(meanMicros).toBeLessThan(BUDGET_MICROS);
  });
});
