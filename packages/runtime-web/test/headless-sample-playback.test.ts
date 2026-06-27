import { describe, expect, it } from 'vitest';
import type { SkeletonDocument } from '@marionette/format/types';
import { buildPose, MAT2X3_STRIDE, sampleSkeleton } from '@marionette/runtime-core';
import { loopTime, samplePlaybackWorlds } from '../src';
import { bone, makeDocument } from './rig';

// A two-bone rig whose every animated channel has MATCHED endpoints (first key value == last per
// channel), so the loop is seamless: pose(0) and pose(duration) sample identical composed locals. The
// mid-cycle keyframes are non-constant, so the rig genuinely moves between distinct in-cycle times
// (guarding the loop/seamless equalities from being vacuously true on a static rig).
const DURATION = 2;

function seamlessRig(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null), bone('arm', 'root', { x: 50, length: 50 })],
    animations: {
      idle: {
        duration: DURATION,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 10 }, curve: 'linear' },
              { time: 1, value: { angle: 40 }, curve: 'linear' },
              { time: 2, value: { angle: 10 }, curve: 'linear' },
            ],
          },
          arm: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 25 }, curve: 'linear' },
              { time: 2, value: { angle: 0 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
      },
    },
  });
}

describe('samplePlaybackWorlds (headless harness, TASK-1.10.4)', () => {
  it('reads world affines straight out of pose.world, matching the player render path', () => {
    const document = seamlessRig();
    const t = 0.4;
    const [frame] = samplePlaybackWorlds(document, 'idle', [t]);

    // The harness must read the SAME bytes SkeletonView.renderFromPose reads (pose.world at
    // boneIndex * MAT2X3_STRIDE), so a manual buildPose + sampleSkeleton reproduces it exactly.
    const pose = buildPose(document);
    sampleSkeleton(document, 'idle', t, pose);
    expect(frame!.worlds).toHaveLength(document.bones.length);
    for (let i = 0; i < document.bones.length; i += 1) {
      const base = i * MAT2X3_STRIDE;
      expect(frame!.worlds[i]).toEqual([
        pose.world[base]!,
        pose.world[base + 1]!,
        pose.world[base + 2]!,
        pose.world[base + 3]!,
        pose.world[base + 4]!,
        pose.world[base + 5]!,
      ]);
    }
  });

  it('is deterministic: the same time yields byte-identical world affines and tips', () => {
    const document = seamlessRig();
    const t = 0.37;

    // Within one call the pose buffer is reused between the two samples; across calls a fresh pose is
    // built. Both must produce identical output (determinism + non-perturbation by buffer reuse).
    const twice = samplePlaybackWorlds(document, 'idle', [t, t]);
    expect(twice[1]!.worlds).toEqual(twice[0]!.worlds);

    const again = samplePlaybackWorlds(document, 'idle', [t]);
    expect(again[0]!.worlds).toEqual(twice[0]!.worlds);
    expect(again[0]!.tips).toEqual(twice[0]!.tips);
  });

  it('does not drift across 10 loop iterations of the same in-cycle time', () => {
    const document = seamlessRig();

    // Map t + k*DURATION back into one period via loopTime (the transport wrap the player uses): every
    // iteration samples the SAME in-cycle time, so a solve that drifted through the reused pose would
    // diverge by iteration 10. The mid-cycle times (0.5, 1.5) exercise interpolated, non-endpoint values.
    for (const t of [0, 0.5, 1, 1.5]) {
      const times = Array.from({ length: 10 }, (_, k) => loopTime(t + k * DURATION, DURATION));
      const frames = samplePlaybackWorlds(document, 'idle', times);
      for (let k = 1; k < frames.length; k += 1) {
        expect(frames[k]!.worlds).toEqual(frames[0]!.worlds);
      }
    }
  });

  it('agrees at t=0 and t=duration for matched endpoints (seamless loop)', () => {
    const document = seamlessRig();

    const [start, end] = samplePlaybackWorlds(document, 'idle', [0, DURATION]);
    // Matched endpoints make pose(0) and pose(duration) compose identical locals, so the world affines
    // are bitwise equal, not merely close: there is no pop at the loop seam.
    expect(end!.worlds).toEqual(start!.worlds);
    expect(end!.tips).toEqual(start!.tips);
  });

  it('moves the rig between distinct in-cycle times (the equalities above are not vacuous)', () => {
    const document = seamlessRig();

    const [a, b] = samplePlaybackWorlds(document, 'idle', [0.25, 0.75]);
    expect(b!.worlds).not.toEqual(a!.worlds);
  });
});
