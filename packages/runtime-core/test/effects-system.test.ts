import { memoryUsage } from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { BundleNotFoundError, EffectNotFoundError, EffectSystem } from '../src/effects/system';
import type { BudgetWarning } from '../src/effects/system';
import type { EffectAnchor } from '../src/effects/anchor';
import {
  CONST,
  RANGE,
  effectConfig,
  effectsDocument,
  emitterLayer,
  rampNumber,
  spriteAnimatorLayer,
} from './effects-fixtures';

// WP-3.4: the EffectSystem, trigger API, anchor model, budget/eviction, and bundles
// (phase-3-vfx-particles.md sections 8.7, 8.8). dt = 1/60.

const DT = 1 / 60;
const WORLD: EffectAnchor = { space: 'world', x: 100, y: 50, rotation: 0 };

describe('EffectSystem: trigger + anchor', () => {
  it('trigger spawns an instance at the anchor and step advances it', () => {
    const doc = effectsDocument({
      fx: effectConfig({
        duration: 1,
        layers: [
          emitterLayer({ spawn: { mode: 'burst', count: 5, atTime: 0 }, lifetime: CONST(1) }),
        ],
      }),
    });
    const sys = new EffectSystem(doc);
    const id = sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
    expect(id).toBeGreaterThan(0);
    expect(sys.liveInstanceCount()).toBe(1);
    sys.step(DT); // first frame: one sub-step, burst fires
    const frame = sys.readState();
    expect(frame.instances).toHaveLength(1);
    const emitter = frame.instances[0]!.emitters[0]!;
    expect(emitter.liveCount).toBe(5);
    // The anchor matrix carries the world translation (100, 50).
    expect(emitter.anchor[4]).toBeCloseTo(100, 9);
    expect(emitter.anchor[5]).toBeCloseTo(50, 9);
  });

  it('an unknown effect name throws a typed EffectNotFoundError', () => {
    const sys = new EffectSystem(effectsDocument({ fx: effectConfig() }));
    expect(() => sys.trigger({ effect: 'nope', anchor: WORLD, seed: 1, startTime: 0 })).toThrow(
      EffectNotFoundError,
    );
    try {
      sys.trigger({ effect: 'nope', anchor: WORLD, seed: 1, startTime: 0 });
    } catch (e) {
      expect(e).toBeInstanceOf(EffectNotFoundError);
      expect((e as EffectNotFoundError).code).toBe('EFFECT_NOT_FOUND');
    }
  });

  it('a bone anchor reads the resolver transform once per frame', () => {
    const doc = effectsDocument({
      fx: effectConfig({
        duration: 1,
        layers: [
          emitterLayer({ spawn: { mode: 'burst', count: 1, atTime: 0 }, lifetime: CONST(1) }),
        ],
      }),
    });
    const resolveBone = vi.fn((_id: string, _bone: string) => [1, 0, 0, 1, 7, 9] as const);
    const sys = new EffectSystem(doc, { resolveBone });
    sys.trigger({
      effect: 'fx',
      anchor: { space: 'bone', skeletonInstanceId: 's0', pointOrBone: 'tip' },
      seed: 1,
      startTime: 0,
    });
    sys.step(DT);
    const emitter = sys.readState().instances[0]!.emitters[0]!;
    expect(emitter.anchor[4]).toBeCloseTo(7, 9);
    expect(emitter.anchor[5]).toBeCloseTo(9, 9);
    // The resolver is called once per frame (one step -> one resolve, plus the construction-time seed).
    sys.step(DT);
    // At most one resolve per step after construction.
    expect(resolveBone.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('EffectSystem: bundles', () => {
  it('triggering a bundle expands to exactly its items at their startOffsets', () => {
    const doc = effectsDocument(
      {
        a: effectConfig({ name: 'a', duration: 1 }),
        b: effectConfig({ name: 'b', duration: 1 }),
      },
      {
        mega: {
          name: 'mega',
          items: [
            { effect: 'a', startOffset: 0, anchorRole: 'center', seedSalt: 1 },
            { effect: 'b', startOffset: 0.5, anchorRole: 'center', seedSalt: 2 },
          ],
        },
      },
    );
    const sys = new EffectSystem(doc);
    const ids = sys.triggerBundle('mega', 999, { center: WORLD }, 0);
    expect(ids).toHaveLength(2);
    expect(sys.liveInstanceCount()).toBe(2);
  });

  it('an unknown bundle throws BundleNotFoundError', () => {
    const sys = new EffectSystem(effectsDocument({ fx: effectConfig() }));
    expect(() => sys.triggerBundle('nope', 1, {}, 0)).toThrow(BundleNotFoundError);
  });

  it('same (bundle, baseSeed, anchors) yields deep-equal solved state across runs (determinism)', () => {
    const doc = effectsDocument(
      {
        a: effectConfig({
          name: 'a',
          duration: 1,
          layers: [
            emitterLayer({
              spawn: { mode: 'rate', particlesPerSecond: 120 },
              lifetime: RANGE(0.3, 0.6),
              startSpeed: RANGE(50, 100),
              emissionAngle: RANGE(0, 360),
              maxParticles: 128,
            }),
          ],
        }),
      },
      {
        mega: {
          name: 'mega',
          items: [{ effect: 'a', startOffset: 0, anchorRole: 'c', seedSalt: 7 }],
        },
      },
    );
    const run = () => {
      const sys = new EffectSystem(doc);
      sys.triggerBundle('mega', 42, { c: WORLD }, 0);
      for (let i = 0; i < 30; i += 1) sys.step(DT);
      const e = sys.readState().instances[0]!.emitters[0]!;
      return { live: e.liveCount, px: Array.from(e.px), alive: Array.from(e.alive) };
    };
    expect(run()).toStrictEqual(run());
  });
});

describe('EffectSystem: lifecycle', () => {
  it('a finished non-looping instance is reclaimed', () => {
    const doc = effectsDocument({
      fx: effectConfig({
        duration: 1 / 60, // emit for one step
        layers: [
          emitterLayer({
            spawn: { mode: 'burst', count: 3, atTime: 0 },
            lifetime: CONST(2 / 60), // lifeSteps 2
            maxParticles: 8,
          }),
        ],
      }),
    });
    const sys = new EffectSystem(doc);
    sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
    expect(sys.liveInstanceCount()).toBe(1);
    // Step enough to fire the burst and drain the particles.
    for (let i = 0; i < 6; i += 1) sys.step(DT);
    expect(sys.liveInstanceCount()).toBe(0); // reclaimed
  });

  it('an endless instance stays live until stopped, then drains and is reclaimed', () => {
    const doc = effectsDocument({
      fx: effectConfig({
        duration: null, // endless
        layers: [
          emitterLayer({
            spawn: { mode: 'rate', particlesPerSecond: 120 },
            lifetime: CONST(3 / 60),
            maxParticles: 32,
          }),
        ],
      }),
    });
    const sys = new EffectSystem(doc);
    const id = sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
    for (let i = 0; i < 30; i += 1) sys.step(DT);
    expect(sys.liveInstanceCount()).toBe(1); // endless, still live
    sys.stop(id);
    for (let i = 0; i < 10; i += 1) sys.step(DT); // emission stops, particles drain
    expect(sys.liveInstanceCount()).toBe(0);
  });
});

describe('EffectSystem: quality tier (section 7.3)', () => {
  it('the tier does NOT change a deterministic effect particle count', () => {
    const make = (tier: 'low' | 'high') => {
      const doc = effectsDocument({
        fx: effectConfig({
          deterministic: true,
          duration: 1,
          layers: [
            emitterLayer({
              spawn: { mode: 'burst', count: 50, atTime: 0 },
              lifetime: CONST(1),
              maxParticles: 64,
            }),
          ],
        }),
      });
      const sys = new EffectSystem(doc, { qualityTier: tier });
      sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
      sys.step(DT);
      return sys.readState().instances[0]!.emitters[0]!.liveCount;
    };
    expect(make('low')).toBe(make('high'));
    expect(make('high')).toBe(50);
  });

  it('the tier scales an AMBIENT effect particle count down', () => {
    const make = (tier: 'low' | 'high') => {
      const doc = effectsDocument({
        fx: effectConfig({
          deterministic: false,
          duration: 1,
          layers: [
            emitterLayer({
              spawn: { mode: 'burst', count: 50, atTime: 0 },
              lifetime: CONST(1),
              maxParticles: 64,
            }),
          ],
        }),
      });
      const sys = new EffectSystem(doc, { qualityTier: tier });
      sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
      sys.step(DT);
      return sys.readState().instances[0]!.emitters[0]!.liveCount;
    };
    // low scales count by 0.4 -> floor(50*0.4) = 20; high uses 50.
    expect(make('low')).toBe(20);
    expect(make('high')).toBe(50);
  });
});

describe('EffectSystem: global budget + eviction (section 8.8)', () => {
  it('exceeding MAX_LIVE_PARTICLES evicts and emits a budget-overflow warning', () => {
    const warnings: BudgetWarning[] = [];
    const doc = effectsDocument({
      fx: effectConfig({
        deterministic: true,
        duration: 1,
        layers: [
          emitterLayer({
            spawn: { mode: 'burst', count: 100, atTime: 0 },
            lifetime: CONST(5), // long-lived
            maxParticles: 100,
          }),
        ],
      }),
    });
    const sys = new EffectSystem(doc, {
      maxLiveParticles: 60,
      onWarning: (w) => warnings.push(w),
    });
    sys.trigger({ effect: 'fx', anchor: WORLD, seed: 1, startTime: 0 });
    sys.step(DT); // burst 100, budget 60 -> evict 40
    expect(sys.liveParticleTotal()).toBe(60);
    expect(warnings.length).toBe(40);
    expect(warnings[0]!.kind).toBe('budget-overflow');
  });

  it('eviction prefers AMBIENT particles over deterministic ones', () => {
    const doc = effectsDocument({
      det: effectConfig({
        name: 'det',
        deterministic: true,
        duration: 1,
        layers: [
          emitterLayer({
            spawn: { mode: 'burst', count: 40, atTime: 0 },
            lifetime: CONST(5),
            maxParticles: 64,
          }),
        ],
      }),
      amb: effectConfig({
        name: 'amb',
        deterministic: false,
        duration: 1,
        layers: [
          emitterLayer({
            spawn: { mode: 'burst', count: 40, atTime: 0 },
            lifetime: CONST(5),
            maxParticles: 64,
          }),
        ],
      }),
    });
    const sys = new EffectSystem(doc, { maxLiveParticles: 50, qualityTier: 'high' });
    const detId = sys.trigger({ effect: 'det', anchor: WORLD, seed: 1, startTime: 0 });
    const ambId = sys.trigger({ effect: 'amb', anchor: WORLD, seed: 2, startTime: 0 });
    sys.step(DT);
    // 80 total, budget 50 -> evict 30, all from the ambient effect (40 -> 10), det stays at 40.
    const frame = sys.readState();
    const detView = frame.instances.find((i) => i.id === detId)!.emitters[0]!;
    const ambView = frame.instances.find((i) => i.id === ambId)!.emitters[0]!;
    expect(detView.liveCount).toBe(40); // deterministic untouched
    expect(ambView.liveCount).toBe(10); // ambient evicted first
  });
});

describe('EffectSystem: zero-heap over many steps (allocation probe)', () => {
  it('step + readState allocate within bounds across many frames after warmup', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the EffectSystem allocation probe requires --expose-gc');
    }
    const doc = effectsDocument({
      fx: effectConfig({
        duration: null,
        layers: [
          emitterLayer({
            spawn: { mode: 'rate', particlesPerSecond: 300 },
            shape: { kind: 'circle', radius: 10, edgeOnly: false },
            lifetime: RANGE(0.3, 0.6),
            startSpeed: RANGE(50, 120),
            emissionAngle: RANGE(0, 360),
            scaleOverLife: rampNumber(1, 0),
            alphaOverLife: rampNumber(1, 0),
            maxParticles: 256,
          }),
          spriteAnimatorLayer({ rotationDegPerSec: 30 }),
        ],
      }),
    });
    const sys = new EffectSystem(doc);
    sys.trigger({ effect: 'fx', anchor: WORLD, seed: 7, startTime: 0 });
    // Warm up to steady state (pool churning).
    for (let i = 0; i < 2000; i += 1) {
      sys.step(DT);
      sys.readState();
    }
    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 20_000; i += 1) {
      sys.step(DT);
      sys.readState();
    }
    runGc();
    const growth = memoryUsage().heapUsed - before;
    // readState rebuilds small view arrays each call; the steady-state churn is bounded. The hot
    // per-particle step path allocates nothing. Allow a modest budget for the per-frame view arrays
    // (which are GC'd) plus measurement noise.
    expect(growth).toBeLessThan(4 * 1024 * 1024);
  });
});
