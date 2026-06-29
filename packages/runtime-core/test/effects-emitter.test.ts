import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  isEmitterDone,
  makeEmitterInstance,
  prepareEmitter,
  stepEmitterOnce,
} from '../src/effects/emitter-solve';
import type { EmitterInstance } from '../src/effects/emitter-solve';
import { hash32 } from '../src/effects/prng';
import { CONST, RANGE, emitterLayer, flatNumber, rampNumber } from './effects-fixtures';

// WP-3.2: the Tier-S emitter solve (phase-3-vfx-particles.md sections 8.2, 8.4, 8.5). Determinism rests
// on the integer step clock; positions/colors are float (epsilon path). dt = 1/60 throughout.

const DT = 1 / 60;

// Build a live emitter instance from a layer + a per-layer stream seed, endless emission unless the
// caller passes a bounded emitUntilStep.
function instance(
  layer = emitterLayer(),
  seed = 12345,
  emitUntilStep = Number.POSITIVE_INFINITY,
): EmitterInstance {
  const prepared = prepareEmitter(layer, DT);
  return makeEmitterInstance(prepared, hash32(seed, 0) >>> 0, emitUntilStep);
}

// Step an instance n times.
function steps(inst: EmitterInstance, n: number): void {
  for (let i = 0; i < n; i += 1) stepEmitterOnce(inst);
}

// The single live slot index (these single-particle tests spawn exactly one). The free stack pops the
// highest index first, so slot 0 is NOT where the first particle lands; find it by the alive flag.
function onlyLiveSlot(inst: EmitterInstance): number {
  for (let s = 0; s < inst.pool.capacity; s += 1) {
    if (inst.pool.alive[s] === 1) return s;
  }
  throw new Error('no live particle');
}

describe('emitter solve: spawn schedule (integer)', () => {
  it('a burst spawns exactly count particles at its step (burstStep = ceil(atTime/dt))', () => {
    // atTime = DT -> burstStep = ceil(DT/DT) = 1; the burst fires on the step where stepIndex === 1.
    const inst = instance(
      emitterLayer({ spawn: { mode: 'burst', count: 40, atTime: DT }, lifetime: CONST(10) }),
    );
    expect(inst.poolState.liveCount).toBe(0);
    stepEmitterOnce(inst); // stepIndex -> 1 -> fires
    expect(inst.poolState.liveCount).toBe(40);
  });

  it('a burst at atTime 0 fires on the first step (burstStep clamps to max(1, ceil(atTime/dt)))', () => {
    // The clock starts at 0 and increments to 1 before the first spawnForStep, so an at-zero burst is
    // clamped to step 1 (the chosen portable interpretation) and fires on the first stepOnce.
    const inst = instance(
      emitterLayer({ spawn: { mode: 'burst', count: 7, atTime: 0 }, lifetime: CONST(10) }),
    );
    stepEmitterOnce(inst);
    expect(inst.poolState.liveCount).toBe(7);
  });

  it('the maxParticles cap is never exceeded (a burst larger than the cap fills only the cap)', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 100, atTime: DT },
      maxParticles: 30,
      lifetime: CONST(10),
    });
    const inst = instance(layer);
    stepEmitterOnce(inst);
    expect(inst.poolState.liveCount).toBe(30);
    // Many further steps never grow beyond the cap.
    steps(inst, 50);
    expect(inst.poolState.liveCount).toBeLessThanOrEqual(30);
  });

  it('a full pool skips a spawn and consumes zero PRNG draws (cap semantics)', () => {
    // A rate emitter at the cap; once full, a further requested spawn must not advance the stream.
    const layer = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 600 },
      maxParticles: 4,
      lifetime: CONST(100), // never die, so the pool stays full
      startSpeed: RANGE(1, 2), // non-constant so a real spawn WOULD draw
    });
    const inst = instance(layer);
    // Fill the pool.
    steps(inst, 20);
    expect(inst.poolState.liveCount).toBe(4);
    const streamBefore = inst.prng.s;
    const orderBefore = inst.nextSpawnOrder;
    // Step many more times: the schedule advances but spawns are skipped (pool full).
    steps(inst, 50);
    expect(inst.poolState.liveCount).toBe(4);
    // No new particles spawned -> spawnOrder did not advance and the PRNG stream did not move.
    expect(inst.nextSpawnOrder).toBe(orderBefore);
    expect(inst.prng.s).toBe(streamBefore);
  });

  it('a rate emitter produces the expected count over time (60/s at dt=1/60 -> ~1 per step)', () => {
    const layer = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 60 },
      maxParticles: 200,
      lifetime: CONST(100),
    });
    const inst = instance(layer);
    steps(inst, 60); // one second
    // 60/s for 1s ~ 60 spawned (integer fixed-point accumulator yields exactly 60 here).
    expect(inst.nextSpawnOrder).toBe(60);
    expect(inst.poolState.liveCount).toBe(60);
  });
});

describe('emitter solve: lifetime + recycle (integer-exact)', () => {
  it('a particle with lifeSteps=k is alive for exactly k steps then recycled', () => {
    // lifetime 5*dt -> lifeSteps = ceil(5*dt / dt) = 5. A particle is alive at logical ages 0..k-1 (the
    // spawn step reaches age 0 via the newborn sentinel), recycled when age reaches k. So with k=5 the
    // particle is alive across its spawn step plus 4 more steps (5 steps total), recycled on the next.
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      lifetime: CONST(5 * DT),
      maxParticles: 4,
    });
    const inst = instance(layer);
    stepEmitterOnce(inst); // spawn step: age 0, alive
    expect(inst.poolState.liveCount).toBe(1);
    for (let i = 0; i < 4; i += 1) {
      stepEmitterOnce(inst); // ages 1..4, still alive (4 more alive steps)
      expect(inst.poolState.liveCount).toBe(1);
    }
    stepEmitterOnce(inst); // age 5 >= 5 -> recycled
    expect(inst.poolState.liveCount).toBe(0);
  });

  it('lifeSteps is at least 1 even for a sub-dt lifetime', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      lifetime: CONST(DT / 10),
      maxParticles: 4,
    });
    const inst = instance(layer);
    stepEmitterOnce(inst); // spawn
    expect(inst.pool.lifeSteps[onlyLiveSlot(inst)]).toBeGreaterThanOrEqual(1);
  });
});

describe('emitter solve: integration + over-life', () => {
  it('gravity pulls a particle down over time (semi-implicit Euler)', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      gravity: { x: 0, y: 100 },
      lifetime: CONST(100),
      maxParticles: 4,
    });
    const inst = instance(layer);
    steps(inst, 31); // spawn on step 1, then 30 integration steps
    const slot = onlyLiveSlot(inst);
    // After 30 steps under gravity 100, vy and py are positive and growing.
    expect(inst.pool.vy[slot]!).toBeGreaterThan(0);
    expect(inst.pool.py[slot]!).toBeGreaterThan(0);
  });

  it('scaleOverLife drives outScale and alphaOverLife drives outAlpha as authored', () => {
    // scale ramps 2 -> 0 over life; alpha ramps 1 -> 0. Check the midpoint trends.
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      lifetime: CONST(10 * DT), // lifeSteps 10
      startScale: CONST(3),
      scaleOverLife: rampNumber(1, 0),
      alphaOverLife: rampNumber(1, 0),
      maxParticles: 4,
    });
    const inst = instance(layer);
    stepEmitterOnce(inst); // step 1 spawn, ageSteps 0
    steps(inst, 5); // advance to ageSteps 5 -> u = 5/10 = 0.5
    const slot = onlyLiveSlot(inst);
    // outScale = baseScale(3) * scaleOverLife(0.5) = 3 * 0.5 = 1.5; outAlpha = 0.5.
    expect(inst.pool.outScale[slot]!).toBeCloseTo(1.5, 6);
    expect(inst.pool.outAlpha[slot]!).toBeCloseTo(0.5, 6);
  });

  it('a constant scaleOverLife holds outScale at baseScale', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      lifetime: CONST(100),
      startScale: CONST(2),
      scaleOverLife: flatNumber(1),
      maxParticles: 4,
    });
    const inst = instance(layer);
    steps(inst, 10);
    const slot = onlyLiveSlot(inst);
    expect(inst.pool.outScale[slot]!).toBeCloseTo(2, 6);
  });
});

describe('emitter solve: animated frame index (integer-exact)', () => {
  it('overLife mode advances frame 0..N-1 across life', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 1, atTime: DT },
      lifetime: CONST(10 * DT), // lifeSteps 10
      texture: { kind: 'animated', regions: ['a', 'b', 'c', 'd'], fps: 12, mode: 'overLife' },
      maxParticles: 4,
    });
    const inst = instance(layer);
    stepEmitterOnce(inst); // spawn, ageSteps 0 -> frame floor(0*4/10) = 0
    const slot = onlyLiveSlot(inst);
    expect(inst.pool.frame[slot]).toBe(0);
    steps(inst, 5); // ageSteps 5 -> floor(5*4/10) = 2
    expect(inst.pool.frame[slot]).toBe(2);
    steps(inst, 3); // ageSteps 8 -> floor(8*4/10) = 3 (clamped at N-1)
    expect(inst.pool.frame[slot]).toBe(3);
  });
});

describe('emitter solve: determinism', () => {
  it('same (config, seed, dt) produces deep-equal solved state across repeated runs', () => {
    const layer = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 120 },
      shape: { kind: 'circle', radius: 10, edgeOnly: false },
      lifetime: RANGE(0.3, 0.6),
      startSpeed: RANGE(50, 100),
      emissionAngle: RANGE(60, 120),
      angularVelocity: RANGE(-90, 90),
      startScale: RANGE(0.5, 1.5),
      gravity: { x: 0, y: 200 },
      maxParticles: 128,
    });
    const run = () => {
      const inst = instance(layer, 777);
      steps(inst, 40);
      return {
        live: inst.poolState.liveCount,
        order: inst.nextSpawnOrder,
        px: Array.from(inst.pool.px),
        py: Array.from(inst.pool.py),
        alive: Array.from(inst.pool.alive),
        spawnOrder: Array.from(inst.pool.spawnOrder),
      };
    };
    const a = run();
    const b = run();
    expect(b).toStrictEqual(a);
  });

  it('a different seed produces a different trajectory', () => {
    const layer = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 120 },
      shape: { kind: 'circle', radius: 10, edgeOnly: false },
      lifetime: RANGE(0.5, 1.0),
      startSpeed: RANGE(50, 100),
      emissionAngle: RANGE(0, 360),
      maxParticles: 128,
    });
    const trajectory = (seed: number) => {
      const inst = instance(layer, seed);
      steps(inst, 30);
      return Array.from(inst.pool.px);
    };
    expect(trajectory(1)).not.toStrictEqual(trajectory(2));
  });

  it('a constant RangeF leaves the stream position identical to omitting the draw', () => {
    // Two emitters identical except startSpeed: one constant, one varying. A point-shape, all-constant
    // emitter should consume ZERO draws per spawn, so the stream never moves.
    const allConst = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 120 },
      lifetime: CONST(1),
      startSpeed: CONST(0),
      emissionAngle: CONST(0),
      startRotation: CONST(0),
      angularVelocity: CONST(0),
      startScale: CONST(1),
      maxParticles: 128,
    });
    const inst = instance(allConst, 999);
    const before = inst.prng.s;
    steps(inst, 30);
    expect(inst.prng.s).toBe(before); // no draws consumed across many spawns
  });
});

describe('emitter solve: lifecycle', () => {
  it('a bounded burst emitter reports done after its particles drain', () => {
    const layer = emitterLayer({
      spawn: { mode: 'burst', count: 5, atTime: DT },
      lifetime: CONST(3 * DT),
      maxParticles: 16,
    });
    // emitUntilStep does not bound bursts; isEmitterDone waits for the burst step + drain.
    const inst = instance(layer, 1, 1);
    expect(isEmitterDone(inst)).toBe(false);
    stepEmitterOnce(inst); // step 1: burst fires
    expect(isEmitterDone(inst)).toBe(false);
    steps(inst, 5); // drain
    expect(inst.poolState.liveCount).toBe(0);
    expect(isEmitterDone(inst)).toBe(true);
  });
});

describe('emitter solve: zero heap allocation in stepOnce (allocation probe)', () => {
  it('allocates no heap across many steps after warmup', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the emitter allocation probe requires the worker to run with --expose-gc');
    }
    const layer = emitterLayer({
      spawn: { mode: 'rate', particlesPerSecond: 600 },
      shape: { kind: 'circle', radius: 20, edgeOnly: false },
      lifetime: RANGE(0.2, 0.5),
      startSpeed: RANGE(50, 150),
      emissionAngle: RANGE(0, 360),
      angularVelocity: RANGE(-180, 180),
      startScale: RANGE(0.5, 2),
      gravity: { x: 0, y: 300 },
      scaleOverLife: rampNumber(1, 0),
      alphaOverLife: rampNumber(1, 0),
      maxParticles: 256,
    });
    const inst = instance(layer, 4242);
    // Warm up: reach steady state (pool churning, JIT settled).
    for (let i = 0; i < 3000; i += 1) stepEmitterOnce(inst);
    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 100_000; i += 1) stepEmitterOnce(inst);
    runGc();
    const growth = memoryUsage().heapUsed - before;
    // 100k steps that each allocated even one small object would add megabytes. Allow GC/measure noise.
    expect(growth).toBeLessThan(512 * 1024);
  });
});
