import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import type {
  Animation,
  Bone,
  IkConstraint,
  SkeletonDocument,
  Slot,
  TransformConstraint,
} from '@marionette/format/types';
import {
  applyAnimationState,
  buildPose,
  clearTrack,
  crossfadeTo,
  getRotationDeg,
  getTrackEntry,
  makeAnimationState,
  MAT2X3_STRIDE,
  queueAnimation,
  sampleSkeleton,
  setAnimation,
  updateAnimationState,
} from '../src';
import type { Mat2x3, Pose } from '../src';
import { attachmentFrame, bone, rotateKey, slot, vec2Key } from './anim-fixtures';

// AnimationState (ADR-0005) rule-by-rule tests. Each numbered semantic gets at least one test that would
// FAIL if the rule were implemented differently: the order of track/mix application, the shortest-arc
// rotation lerp, the additive setup-delta, the single-level crossfade, the discrete greater-weight-wins
// 50% flip, loop wrap vs clamp, and the queue loop-boundary timing.

function worldAffineOf(pose: Pose, name: string): Mat2x3 {
  const i = pose.boneNames.indexOf(name);
  const base = i * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

function worldRotationOf(pose: Pose, name: string): number {
  return getRotationDeg(worldAffineOf(pose, name));
}

// A single-root document with the given animations (root bone 'b' at setup rotation 0). Draft docs
// (hash ''): buildPose reads bones/slots, makeAnimationState reads animations only.
function rootDoc(
  animations: Record<string, Animation>,
  slots: readonly Slot[] = [],
): SkeletonDocument {
  return {
    formatVersion: '0.2.0',
    name: 'anim-state-test',
    hash: '',
    bones: [bone('b', null)],
    slots: [...slots],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: [],
    animations,
    atlas: { pages: [] },
  };
}

// An animation that holds bone 'b' at a constant added rotation for its whole (1s) period.
function constRotate(angle: number): Animation {
  return {
    duration: 1,
    bones: { b: { rotate: [rotateKey(0, angle, 'linear'), rotateKey(1, angle, 'linear')] } },
    slots: {},
    ik: {},
    transform: {},
    deform: {},
  };
}

describe('AnimationState rule 1: tracks apply in ascending index order', () => {
  it('a higher track fully replaces a lower track for a channel both key (order-sensitive)', () => {
    const document = rootDoc({ low: constRotate(10), high: constRotate(40) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'low', true);
    setAnimation(state, 1, 'high', true);
    applyAnimationState(state, pose);

    // Track 1 (applied last, weight 1) wins: setup 0 + 40. If tracks applied high-then-low, it would be 10.
    expect(worldRotationOf(pose, 'b')).toBeCloseTo(40, 6);
  });

  it('leaves a channel a higher track does not key as the lower track wrote it (rule 2 scoping)', () => {
    const rotateAnim = constRotate(30);
    const translateAnim: Animation = {
      duration: 1,
      bones: { b: { translate: [vec2Key(0, 25, 0, 'linear'), vec2Key(1, 25, 0, 'linear')] } },
      slots: {},
      ik: {},
      transform: {},
      deform: {},
    };
    const document = rootDoc({ base: rotateAnim, overlay: translateAnim });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'base', true); // keys rotate only
    setAnimation(state, 1, 'overlay', true); // keys translate only
    applyAnimationState(state, pose);

    const affine = worldAffineOf(pose, 'b');
    expect(getRotationDeg(affine)).toBeCloseTo(30, 6); // rotate survived from track 0
    expect(affine[4]).toBeCloseTo(25, 6); // translate came from track 1
  });
});

describe('AnimationState rule 2: replace-toward lerp with shortest-arc rotation', () => {
  it('a partial-weight track lerps the local component toward the sampled value', () => {
    const document = rootDoc({ a: constRotate(60) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    const entry = setAnimation(state, 0, 'a', true);
    entry.alpha = 0.5;
    applyAnimationState(state, pose);

    // lerp(setup 0 -> 60, 0.5) = 30.
    expect(worldRotationOf(pose, 'b')).toBeCloseTo(30, 6);
  });

  it('rotation lerps along the SHORTEST arc, not the raw numeric midpoint', () => {
    // Track 0 holds 170 degrees; track 1 (weight 0.5) targets -170. The shortest arc 170 -> -170 crosses
    // +/-180 (a +20 span), so the midpoint is 180. A naive numeric lerp would give 0, the long way round.
    const document = rootDoc({ base: constRotate(170), swap: constRotate(-170) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'base', true);
    const top = setAnimation(state, 1, 'swap', true);
    top.alpha = 0.5;
    applyAnimationState(state, pose);

    // 180 and -180 are the same basis; assert |rotation| ~ 180, and NOT ~ 0.
    expect(Math.abs(worldRotationOf(pose, 'b'))).toBeCloseTo(180, 4);
  });
});

describe('AnimationState rule 3: additive tracks layer the setup delta', () => {
  it('adds the animation delta-from-setup on top of the base track, not replacing it', () => {
    const document = rootDoc({ base: constRotate(30), wave: constRotate(20) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'base', true); // base rotation 30
    const overlay = setAnimation(state, 1, 'wave', true);
    overlay.additive = true; // additive adds (20 - 0) on top -> 50
    applyAnimationState(state, pose);

    expect(worldRotationOf(pose, 'b')).toBeCloseTo(50, 6);
  });

  it('additive tracks IGNORE discrete attachment swaps', () => {
    const baseAnim: Animation = {
      duration: 1,
      bones: {},
      slots: { s: { attachment: [attachmentFrame(0, 'baseIcon')] } },
      ik: {},
      transform: {},
      deform: {},
    };
    const overlayAnim: Animation = {
      duration: 1,
      bones: { b: { rotate: [rotateKey(0, 10, 'linear'), rotateKey(1, 10, 'linear')] } },
      slots: { s: { attachment: [attachmentFrame(0, 'overlayIcon')] } },
      ik: {},
      transform: {},
      deform: {},
    };
    const document = rootDoc({ base: baseAnim, overlay: overlayAnim }, [slot('s', 'b')]);
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'base', true);
    const overlay = setAnimation(state, 1, 'overlay', true);
    overlay.additive = true;
    applyAnimationState(state, pose);

    const slotIndex = pose.slotNames.indexOf('s');
    // The additive overlay keys 'overlayIcon' but must not win the discrete channel: base wins.
    expect(pose.slotAttachment[slotIndex]).toBe('baseIcon');
  });
});

describe('AnimationState rule 4: single-level crossfade, outgoing-then-incoming', () => {
  it('applies the outgoing entry BEFORE the incoming, so the apply order changes the pose', () => {
    const document = rootDoc({ a: constRotate(40), b: constRotate(80) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'a', false);
    crossfadeTo(state, 0, 'b', false, 1);
    updateAnimationState(state, 0.5); // w_in = 0.5
    applyAnimationState(state, pose);

    // outgoing-then-incoming: lerp(0, 40, 0.5)=20 then lerp(20, 80, 0.5)=50.
    // incoming-then-outgoing (the WRONG order) would give lerp(0,80,.5)=40 then lerp(40,40,.5)=40.
    expect(worldRotationOf(pose, 'b')).toBeCloseTo(50, 6);
  });

  it('a crossfade from a crossfade drops the older mixFrom immediately (single-level)', () => {
    const document = rootDoc({ a: constRotate(10), b: constRotate(20), c: constRotate(30) });
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'a', false);
    crossfadeTo(state, 0, 'b', false, 1); // b.mixFrom = a
    const c = crossfadeTo(state, 0, 'c', false, 1); // c.mixFrom = b; b.mixFrom (a) dropped

    expect(c.mixFrom?.animationId).toBe('b');
    expect(c.mixFrom?.mixFrom).toBeNull(); // the older outgoing 'a' is gone, not chained
  });
});

describe('AnimationState rule 5: discrete greater-weight-wins with incoming tie-break', () => {
  function flipDoc(): SkeletonDocument {
    const a: Animation = {
      duration: 1,
      bones: {},
      slots: { s: { attachment: [attachmentFrame(0, 'iconA')] } },
      ik: {},
      transform: {},
      deform: {},
    };
    const b: Animation = {
      duration: 1,
      bones: {},
      slots: { s: { attachment: [attachmentFrame(0, 'iconB')] } },
      ik: {},
      transform: {},
      deform: {},
    };
    return rootDoc({ a, b }, [slot('s', 'b')]);
  }

  function attachmentAtMixTime(mixTime: number): string | null {
    const document = flipDoc();
    const pose = buildPose(document);
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', true);
    crossfadeTo(state, 0, 'b', true, 1);
    updateAnimationState(state, mixTime);
    applyAnimationState(state, pose);
    return pose.slotAttachment[pose.slotNames.indexOf('s')] ?? null;
  }

  it('the outgoing attachment wins below the 50% crossing', () => {
    expect(attachmentAtMixTime(0.25)).toBe('iconA'); // outgoing weight 0.75 > incoming 0.25
  });

  it('the incoming attachment wins AT the 50% crossing (tie breaks to incoming)', () => {
    expect(attachmentAtMixTime(0.5)).toBe('iconB'); // 0.5 vs 0.5, incoming applied later wins
  });

  it('the incoming attachment wins above the 50% crossing', () => {
    expect(attachmentAtMixTime(0.75)).toBe('iconB');
  });
});

describe('AnimationState rule 6: loop wrap vs clamp and queue timing', () => {
  it('a looping entry wraps trackTime into [0, duration)', () => {
    const document = rootDoc({ a: constRotate(0) });
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', true); // duration 1
    updateAnimationState(state, 1.5);
    expect(getTrackEntry(state, 0)?.trackTime).toBeCloseTo(0.5, 9);
  });

  it('a non-looping entry clamps trackTime at duration and stays there', () => {
    const document = rootDoc({ a: constRotate(0) });
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', false);
    updateAnimationState(state, 1.5);
    expect(getTrackEntry(state, 0)?.trackTime).toBeCloseTo(1, 9);
  });

  it('a non-looping entry past duration matches sampleSkeleton clamped at duration', () => {
    // A non-seamless ramp (0 -> 45 over [0,1]); past the end both clamp to 45, never wrap toward 0.
    const ramp: Animation = {
      duration: 1,
      bones: { b: { rotate: [rotateKey(0, 0, 'linear'), rotateKey(1, 45, 'linear')] } },
      slots: {},
      ik: {},
      transform: {},
      deform: {},
    };
    const document = rootDoc({ ramp });

    const statePose = buildPose(document);
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'ramp', false);
    updateAnimationState(state, 2); // clamp to duration
    applyAnimationState(state, statePose);

    const directPose = buildPose(document);
    sampleSkeleton(document, 'ramp', 1, directPose); // sampleSkeleton at duration

    for (let lane = 0; lane < MAT2X3_STRIDE; lane += 1) {
      expect(worldAffineOf(statePose, 'b')[lane]).toBeCloseTo(
        worldAffineOf(directPose, 'b')[lane],
        9,
      );
    }
  });

  it('queues the next entry across a loop boundary (next boundary plus delay)', () => {
    const document = rootDoc({ a: constRotate(0), b: constRotate(0) });
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', true); // looping, duration 1
    queueAnimation(state, 0, 'b', false, 0); // start at the next loop boundary + 0

    updateAnimationState(state, 0.5);
    expect(getTrackEntry(state, 0)?.animationId).toBe('a'); // before the boundary

    updateAnimationState(state, 0.5); // elapsed 1.0 == duration: queue starts
    const now = getTrackEntry(state, 0);
    expect(now?.animationId).toBe('b');
    expect(now?.trackTime).toBeCloseTo(0, 9); // started with zero leftover
  });

  it('honors a positive queue delay after the loop boundary', () => {
    const document = rootDoc({ a: constRotate(0), b: constRotate(0) });
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', true);
    queueAnimation(state, 0, 'b', false, 0.25); // boundary at 1.0, start at 1.25

    updateAnimationState(state, 1.1); // past the boundary but before boundary + delay
    expect(getTrackEntry(state, 0)?.animationId).toBe('a');

    updateAnimationState(state, 0.2); // elapsed 1.3 >= 1.25
    expect(getTrackEntry(state, 0)?.animationId).toBe('b');
  });
});

describe('AnimationState rule 7: constraint mix channels blend like continuous locals', () => {
  // A follower bone constrained (mixRotate) toward a target. One track holds the target rotated 90 with
  // the transform mix at its base (0). A second track keys ONLY the transform mix to 1; its weight scales
  // the mix continuously, so the follower's world rotation grows monotonically with that track's alpha.
  function constraintDoc(): SkeletonDocument {
    const bones: Bone[] = [bone('root', null), bone('target', 'root'), bone('follower', 'root')];
    const tc: TransformConstraint = {
      name: 'tc',
      bones: ['follower'],
      target: 'target',
      mixRotate: 0,
      mixX: 0,
      mixY: 0,
      mixScaleX: 0,
      mixScaleY: 0,
      mixShearY: 0,
      offsetRotation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetScaleX: 0,
      offsetScaleY: 0,
      offsetShearY: 0,
    };
    const base: Animation = {
      duration: 1,
      bones: { target: { rotate: [rotateKey(0, 90, 'linear'), rotateKey(1, 90, 'linear')] } },
      slots: {},
      ik: {},
      transform: {},
      deform: {},
    };
    const mixDriver: Animation = {
      duration: 1,
      bones: {},
      slots: {},
      ik: {},
      transform: {
        tc: [
          { time: 0, value: { mixRotate: 1 }, curve: 'linear' },
          { time: 1, value: { mixRotate: 1 }, curve: 'linear' },
        ],
      },
      deform: {},
    };
    return {
      formatVersion: '0.2.0',
      name: 'tc-blend',
      hash: '',
      bones,
      slots: [],
      skins: [{ name: 'default', attachments: {} }],
      ikConstraints: [] as IkConstraint[],
      transformConstraints: [tc],
      animations: { base, mixDriver },
      atlas: { pages: [] },
    };
  }

  function followerRotationAtMix(alpha: number): number {
    const document = constraintDoc();
    const pose = buildPose(document);
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'base', true);
    const driver = setAnimation(state, 1, 'mixDriver', true);
    driver.alpha = alpha;
    applyAnimationState(state, pose);
    return worldRotationOf(pose, 'follower');
  }

  it('a half-weight mix track applies about half the constraint rotation', () => {
    const none = followerRotationAtMix(0);
    const half = followerRotationAtMix(0.5);
    const full = followerRotationAtMix(1);

    expect(none).toBeCloseTo(0, 6); // mix 0: follower unconstrained
    expect(full).toBeCloseTo(90, 6); // mix 1: follower fully follows the target's 90
    expect(half).toBeCloseTo(45, 4); // mix 0.5: half the rotation (continuous blend)
  });
});

describe('AnimationState rule 8: events are deferred (no event surface yet)', () => {
  it('updateAnimationState fires nothing and exposes no event output', () => {
    const document = rootDoc({ a: constRotate(0) });
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'a', true);
    // Advancing across many loop boundaries must not throw and must produce no event stream (the API
    // reserves nothing for events; format-0.3.0 event firing lands with the event timelines).
    for (let i = 0; i < 10; i += 1) updateAnimationState(state, 0.3);
    expect('events' in state).toBe(false);
  });
});

describe('AnimationState clearTrack', () => {
  it('empties a track so it no longer contributes to the pose', () => {
    const document = rootDoc({ a: constRotate(45) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);

    setAnimation(state, 0, 'a', true);
    applyAnimationState(state, pose);
    expect(worldRotationOf(pose, 'b')).toBeCloseTo(45, 6);

    clearTrack(state, 0);
    applyAnimationState(state, pose);
    expect(worldRotationOf(pose, 'b')).toBeCloseTo(0, 6); // back to setup
  });
});

describe('AnimationState allocation (INV-5, matches sampleSkeleton probe style)', () => {
  it('updateAnimationState + applyAnimationState allocate no heap per frame after warmup', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error(
        'the AnimationState allocation probe requires the worker to run with --expose-gc',
      );
    }

    const document = rootDoc({ base: constRotate(30), wave: constRotate(20) });
    const pose = buildPose(document);
    const state = makeAnimationState(document);
    setAnimation(state, 0, 'base', true);
    const overlay = setAnimation(state, 1, 'wave', true);
    overlay.additive = true;

    // Warm up: cache the prepared animations and let the JIT settle.
    for (let i = 0; i < 2000; i += 1) {
      updateAnimationState(state, 0.016);
      applyAnimationState(state, pose);
    }

    runGc();
    const before = memoryUsage().heapUsed;
    const iterations = 100_000;
    for (let i = 0; i < iterations; i += 1) {
      updateAnimationState(state, 0.016);
      applyAnimationState(state, pose);
    }
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;

    // Any per-frame allocation over 100k frames would add megabytes; the residual is GC/measurement noise.
    expect(heapGrowth).toBeLessThan(512 * 1024);
  });
});
