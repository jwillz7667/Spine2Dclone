import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import type {
  Animation,
  Bone,
  PhysicsChannel,
  PhysicsConstraint,
  PhysicsSettings,
  SkeletonDocument,
  TransformConstraint,
} from '@marionette/format/types';
import {
  buildPose,
  physicsStepsFixed,
  PHYSICS_RESET_DISTANCE,
  PHYSICS_STEP_FIXED_ONE,
  resetPhysics,
  sampleSkeleton,
} from '../src';
import { MAT2X3_STRIDE } from '../src/math/affine';
import { bone } from './rig';

// Physics constraint SOLVE tests (ADR-0014, PP-B7). The solve is deterministic and stateful across frames,
// so these drive sampleSkeleton frame by frame with an explicit frameDt (0 on the first frame, then a fixed
// dt) exactly as the conformance harness does. Oracles are analytic where a closed form exists: a
// zero-strength passthrough, a mix=0 identity, a full-mix one-step response (the integrator's exact
// arithmetic), and equilibrium settling. Determinism, allocation, teleport reset, and constraint order round
// out the coverage.

const DT = 1 / 60;

// A physics constraint with sensible neutral defaults, overridable per field.
function physics(overrides: Partial<PhysicsConstraint> = {}): PhysicsConstraint {
  return {
    name: 'phys',
    bone: 'b',
    channels: ['x'] as PhysicsChannel[],
    step: DT,
    inertia: 0,
    strength: 0,
    damping: 1,
    mass: 1,
    wind: 0,
    gravity: 0,
    mix: 1,
    ...overrides,
  };
}

interface DocOptions {
  readonly bones?: Bone[];
  readonly physicsConstraints?: PhysicsConstraint[];
  readonly transformConstraints?: TransformConstraint[];
  readonly settings?: PhysicsSettings;
  // Per-bone translateX keyframes for the driving animation: boneName -> [time, value] pairs, linear.
  readonly translateX?: Record<string, [number, number][]>;
  readonly duration?: number;
}

// Build a minimal but structurally-complete document: one or more bones, physics/transform constraints, and
// an animation "anim" that drives the named bones' local x via a translateX component track. buildPose and
// sampleSkeleton tolerate the hand-built shape (they read the fields the solve needs).
function makeDoc(options: DocOptions): SkeletonDocument {
  const bones = options.bones ?? [bone('b', null)];
  const boneTimelines: Animation['bones'] = {};
  for (const [name, keys] of Object.entries(options.translateX ?? {})) {
    boneTimelines[name] = {
      translateX: keys.map(([time, value]) => ({ time, value: { value }, curve: 'linear' })),
    };
  }
  const anim: Animation = {
    duration: options.duration ?? 10,
    bones: boneTimelines,
    slots: {},
    ik: {},
    transform: {},
    path: {},
    physics: {},
    deform: {},
    drawOrder: [],
    events: [],
  };
  const doc: SkeletonDocument = {
    formatVersion: '0.6.0',
    name: 'phys-test',
    hash: '',
    bones,
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: options.transformConstraints ?? [],
    pathConstraints: [],
    physicsConstraints: options.physicsConstraints ?? [],
    animations: { anim },
    atlas: { pages: [] },
  };
  if (options.settings !== undefined) doc.physics = options.settings;
  return doc;
}

// Read a solved bone's world translation x (lane 4). For a root bone this equals the local x, which for the
// x channel is the physics output verbatim (composeInto copies the translation lane through unchanged).
function worldX(pose: ReturnType<typeof buildPose>, name: string): number {
  const index = pose.boneNames.indexOf(name);
  return pose.world[index * MAT2X3_STRIDE + 4]!;
}

// Sample a sequence of frame times, advancing physics by the delta between consecutive times (0 first).
function sampleSequence(
  doc: SkeletonDocument,
  times: number[],
  pose = buildPose(doc),
): ReturnType<typeof buildPose> {
  for (let i = 0; i < times.length; i += 1) {
    const frameDt = i === 0 ? 0 : times[i]! - times[i - 1]!;
    sampleSkeleton(doc, 'anim', times[i]!, pose, null, frameDt);
  }
  return pose;
}

describe('physicsStepsFixed (the integer step clock, ADR-0014 section 2.2)', () => {
  it('schedules exactly one step per frame when frameDt equals step', () => {
    expect(physicsStepsFixed(DT, DT)).toBe(PHYSICS_STEP_FIXED_ONE);
  });

  it('is fixed-point exact and carries a fractional remainder across frames', () => {
    // step 1/50, frameDt 1/60: (1/60)/(1/50) = 0.8333..., * 65536 rounds to 54613 per frame. Fewer than one
    // whole step accrues per frame, so the accumulator carries the remainder and steps fire on some frames.
    const frames = 6;
    const perFrame = physicsStepsFixed(1 / 60, 1 / 50);
    expect(perFrame).toBe(Math.round((1 / 60 / (1 / 50)) * PHYSICS_STEP_FIXED_ONE));
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < frames; i += 1) {
      acc += perFrame;
      const n = acc >> 16;
      acc -= n << 16;
      steps += n;
    }
    // The whole-step count is the integer part of the accumulated fixed-point time; the remainder is exact.
    expect(steps).toBe(Math.floor((frames * perFrame) / PHYSICS_STEP_FIXED_ONE));
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(frames);
    expect(acc).toBe(frames * perFrame - steps * PHYSICS_STEP_FIXED_ONE);
    expect(acc).toBeGreaterThanOrEqual(0);
    expect(acc).toBeLessThan(PHYSICS_STEP_FIXED_ONE);
  });

  it('schedules zero steps for a zero frameDt (the first-frame rest initialization)', () => {
    expect(physicsStepsFixed(0, DT)).toBe(0);
  });
});

describe('physics solve: analytic oracles', () => {
  it('zero-strength, undamped, zero-inertia is an exact passthrough of the animated pose', () => {
    // strength 0 + inertia 0: the inertia carry tracks the setpoint exactly and the spring adds nothing, so
    // the bone sits ON its animated pose every frame. The x lane flows through composeInto verbatim, so this
    // is BIT-exact, not merely within tolerance.
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 0, inertia: 0, damping: 1 })],
      translateX: {
        b: [
          [0, 0],
          [1, 120],
        ],
      },
    });
    const times = [0, DT, 2 * DT, 3 * DT, 4 * DT];
    const pose = sampleSequence(doc, times);
    // At the last sampled time the animated x is a linear interp of the [0,0]->[1,120] track.
    const expected = 120 * times[times.length - 1]!;
    expect(worldX(pose, 'b')).toBe(expected);
  });

  it('mix=0 is the identity: the bone equals its no-physics animated pose', () => {
    const shared: DocOptions = {
      bones: [bone('b', null, { rotation: 20, scaleX: 1.3 })],
      translateX: {
        b: [
          [0, 0],
          [1, 80],
        ],
      },
    };
    const withPhysics = makeDoc({
      ...shared,
      physicsConstraints: [physics({ strength: 200, inertia: 1, damping: 0.8, mix: 0 })],
    });
    const withoutPhysics = makeDoc(shared);
    const times = [0, DT, 2 * DT, 3 * DT, 4 * DT, 5 * DT];
    const posePhys = sampleSequence(withPhysics, times);
    const poseNone = sampleSequence(withoutPhysics, times);
    const bIndex = posePhys.boneNames.indexOf('b');
    for (let lane = 0; lane < MAT2X3_STRIDE; lane += 1) {
      // The translation lanes are bit-exact; the basis lanes ride decompose/recompose f64 round-off.
      expect(posePhys.world[bIndex * MAT2X3_STRIDE + lane]!).toBeCloseTo(
        poseNone.world[bIndex * MAT2X3_STRIDE + lane]!,
        9,
      );
    }
  });

  it('full-mix one-step response matches the closed-form symplectic-Euler step', () => {
    // inertia 1 holds p at the OLD setpoint through the carry, so the first fixed step moves p purely by the
    // spring: p1 = A + damping * strength * (B - A) * dt * dt (ADR section 2.5 lines 1-6, one step).
    const A = 0;
    const B = 40;
    const k = 150;
    const damping = 0.85;
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: k, inertia: 1, damping, mix: 1 })],
      // frame 0 at t=0 -> x=A; frame 1 at t=DT -> x=B. A key at each frame time makes the setpoint step.
      translateX: {
        b: [
          [0, A],
          [DT, B],
        ],
      },
    });
    const pose = sampleSequence(doc, [0, DT]);
    const expected = A + damping * k * (B - A) * DT * DT;
    expect(worldX(pose, 'b')).toBeCloseTo(expected, 12);
  });

  it('settles to the animated pose (equilibrium at the setpoint) after a displaced start', () => {
    // A small setpoint step with inertia 1 leaves p displaced from the held target; the damped spring pulls
    // it back and it converges to the setpoint (the fixed point p* = target, v* = 0). Convergence is the
    // analytic property (independent of the exact trajectory): |p - target| decays below a tight bound.
    const B = 50;
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 120, inertia: 1, damping: 0.9, mix: 1 })],
      translateX: {
        b: [
          [0, 0],
          [DT, B],
        ],
      }, // step 0 -> B at frame 1, then held (clamp) forever
    });
    const times: number[] = [];
    for (let i = 0; i < 1200; i += 1) times.push(i * DT);
    const pose = sampleSequence(doc, times);
    expect(worldX(pose, 'b')).toBeCloseTo(B, 4);
  });

  it('a heavier mass responds less to gravity (force / mass acceleration)', () => {
    // A constant setpoint at x=0, gravity projected onto the local x (a bone rotated 90 degrees so world -y
    // maps to local +/- x). Two masses: the lighter bone is pulled further from the setpoint at every frame.
    const makeGravityDoc = (mass: number): SkeletonDocument =>
      makeDoc({
        bones: [bone('b', null, { rotation: 90 })],
        physicsConstraints: [
          physics({ bone: 'b', channels: ['x'], strength: 40, damping: 0.9, mass, gravity: 500 }),
        ],
      });
    const times: number[] = [];
    for (let i = 0; i < 200; i += 1) times.push(i * DT);
    const light = sampleSequence(makeGravityDoc(1), times);
    const heavy = sampleSequence(makeGravityDoc(10), times);
    // Both are displaced from 0; the lighter bone moves further (larger |x|).
    expect(Math.abs(worldX(light, 'b'))).toBeGreaterThan(Math.abs(worldX(heavy, 'b')));
    expect(Math.abs(worldX(heavy, 'b'))).toBeGreaterThan(0);
  });
});

describe('physics solve: reset semantics (ADR-0014 section 6)', () => {
  it('a setpoint jump beyond RESET_DISTANCE snaps the bone to the new pose at rest', () => {
    const far = PHYSICS_RESET_DISTANCE + 500;
    // inertia 1 would normally hold p at the old value and whip toward the jump; the teleport reset snaps p
    // to the new setpoint with zero velocity, so the output equals the new setpoint exactly on that frame.
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 200, inertia: 1, damping: 0.9 })],
      translateX: {
        b: [
          [0, 0],
          [DT, far],
        ],
      },
    });
    const pose = sampleSequence(doc, [0, DT]);
    expect(worldX(pose, 'b')).toBe(far);
  });

  it('a setpoint jump within RESET_DISTANCE does NOT reset (the bone lags)', () => {
    const near = PHYSICS_RESET_DISTANCE - 100;
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 200, inertia: 1, damping: 0.9 })],
      translateX: {
        b: [
          [0, 0],
          [DT, near],
        ],
      },
    });
    const pose = sampleSequence(doc, [0, DT]);
    // inertia 1 holds p at ~0 through the carry; one small spring step leaves it far below the setpoint.
    expect(worldX(pose, 'b')).toBeLessThan(near / 2);
  });

  it('resetPhysics restarts the simulation so a rewound sequence is identical to a fresh one', () => {
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 120, inertia: 1, damping: 0.9 })],
      translateX: {
        b: [
          [0, 0],
          [DT, 60],
        ],
      },
    });
    const times = [0, DT, 2 * DT, 3 * DT];
    const fresh = sampleSequence(doc, times);
    const freshX = worldX(fresh, 'b');

    // Reuse the SAME pose: run once, reset, run again; the second run must match a fresh pose bit-for-bit.
    const reused = buildPose(doc);
    sampleSequence(doc, times, reused);
    resetPhysics(reused);
    sampleSequence(doc, times, reused);
    expect(worldX(reused, 'b')).toBe(freshX);
  });
});

describe('physics solve: determinism', () => {
  it('two independent poses produce bit-identical output for the same frameDt sequence', () => {
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 130, inertia: 0.5, damping: 0.85 })],
      translateX: {
        b: [
          [0, 0],
          [0.5, 90],
          [1, -30],
        ],
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 300; i += 1) times.push(i * DT);
    const a = Array.from(sampleSequence(doc, times).world);
    const b = Array.from(sampleSequence(doc, times).world);
    expect(b).toStrictEqual(a);
  });

  it('interleaving two poses of the same document does not cross-contaminate their state', () => {
    const doc = makeDoc({
      physicsConstraints: [physics({ strength: 130, inertia: 0.5, damping: 0.85 })],
      translateX: {
        b: [
          [0, 0],
          [0.5, 90],
          [1, -30],
        ],
      },
    });
    const times: number[] = [];
    for (let i = 0; i < 200; i += 1) times.push(i * DT);

    const reference = Array.from(sampleSequence(doc, times).world);

    // Drive two poses frame-by-frame in an interleaved order; each must end identical to the reference.
    const p1 = buildPose(doc);
    const p2 = buildPose(doc);
    for (let i = 0; i < times.length; i += 1) {
      const frameDt = i === 0 ? 0 : times[i]! - times[i - 1]!;
      sampleSkeleton(doc, 'anim', times[i]!, p1, null, frameDt);
      sampleSkeleton(doc, 'anim', times[i]!, p2, null, frameDt);
    }
    expect(Array.from(p1.world)).toStrictEqual(reference);
    expect(Array.from(p2.world)).toStrictEqual(reference);
  });

  it('allocates no heap across repeated physics solves (allocation probe)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the physics allocation probe requires the worker to run with --expose-gc');
    }
    const doc = makeDoc({
      physicsConstraints: [
        physics({
          channels: ['x', 'rotation', 'scaleX'],
          strength: 100,
          inertia: 0.5,
          damping: 0.9,
        }),
      ],
      translateX: {
        b: [
          [0, 0],
          [0.5, 40],
        ],
      },
    });
    const pose = buildPose(doc);
    // Warm up: JIT settle + one-time allocation, then measure a long steady-state run at a fixed dt.
    for (let i = 0; i < 2000; i += 1) sampleSkeleton(doc, 'anim', 0.25, pose, null, DT);

    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 100_000; i += 1) sampleSkeleton(doc, 'anim', 0.25, pose, null, DT);
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;
    expect(heapGrowth).toBeLessThan(256 * 1024);
  });
});

describe('physics solve: constraint order (ADR-0014 section 4)', () => {
  // A transform constraint overwrites "driven" x with a MOVING target's world x (the target bone is animated
  // 0 -> 200); a physics constraint simulates driven's x with lag. Ordering is observable because the
  // setpoint moves: physics-LAST lags the moving transformed pose, physics-FIRST lags driven's own (static)
  // x and is then overwritten by the transform to the target exactly. This locks the default
  // IK-then-transform-then-path-then-physics ordering.
  function orderDoc(physicsOrder: number | undefined, transformOrder: number | undefined) {
    const target = bone('target', null);
    const driven = bone('driven', null);
    const transform: TransformConstraint = {
      name: 'tc',
      bones: ['driven'],
      target: 'target',
      mixRotate: 0,
      mixX: 1,
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
      local: false,
      relative: false,
      ...(transformOrder !== undefined ? { order: transformOrder } : {}),
    };
    return makeDoc({
      bones: [target, driven],
      transformConstraints: [transform],
      physicsConstraints: [
        {
          ...physics({ bone: 'driven', channels: ['x'], strength: 90, inertia: 0.6, damping: 0.9 }),
          ...(physicsOrder !== undefined ? { order: physicsOrder } : {}),
        },
      ],
      translateX: {
        target: [
          [0, 0],
          [1, 200],
        ],
      },
    });
  }

  const midTimes: number[] = [];
  for (let i = 0; i < 30; i += 1) midTimes.push(i * DT);

  it('physics defaults to solving LAST (its setpoint is the post-transform, moving pose)', () => {
    const pose = sampleSequence(orderDoc(undefined, undefined), midTimes);
    const target = 200 * midTimes[midTimes.length - 1]!; // the target's animated x at the last frame
    const driven = worldX(pose, 'driven');
    // Physics lags the moving transformed setpoint: strictly between 0 and the current target.
    expect(driven).toBeGreaterThan(0);
    expect(driven).toBeLessThan(target);
  });

  it('running physics BEFORE the transform (explicit order) is a provably different result', () => {
    const target = 200 * midTimes[midTimes.length - 1]!;
    // physics order 0 (first), transform order 1 (after): the transform overwrites physics with the target
    // world x every frame, so the bone tracks the target EXACTLY with no lag.
    const first = worldX(sampleSequence(orderDoc(0, 1), midTimes), 'driven');
    const last = worldX(sampleSequence(orderDoc(undefined, undefined), midTimes), 'driven');
    expect(first).toBeCloseTo(target, 6);
    expect(last).toBeLessThan(target); // the default (physics last) lags
    expect(first).not.toBeCloseTo(last, 2);
  });
});
