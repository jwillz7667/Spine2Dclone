import { memoryUsage } from 'node:process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_LIVE_PARTICLES, EffectSystem } from '@marionette/runtime-core';
import type { EffectAnchor } from '@marionette/runtime-core';
import { computeEffectsContentHash, validateEffectsDocument } from '@marionette/format/effects';
import type { EffectConfig, EffectsDocument } from '@marionette/format/effects-types';
import { loadPerfBaseline } from '../src/io';

// WP-3.9: mobile particle-perf mitigations + CI gates (phase-3-vfx-particles.md section 8.8, TASK-3.9.1
// to 3.9.5). The emitter/system tests in runtime-core already prove the per-step zero-alloc hot path,
// the per-emitter maxParticles cap, the tier-scaling rule, and the eviction order; this suite is the
// CONFORMANCE-side gate (C.4) that ties those behaviors to the single committed perf baseline
// (perf/baseline.json) so a regression in a perf bound is a reviewed edit to that artifact. It drives
// the REAL shipped presets through the public EffectSystem surface (no runtime-core test internals), and
// it documents the explicit Phase 5 deferral (TASK-3.9.5): these are conservative defaults, not tuned
// device budgets. The allocation probes require the worker to run with --expose-gc (vitest config).

const PRESETS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'presets',
  'megawin.fx.json',
);

const DT = 1 / 60;
const WORLD: EffectAnchor = { space: 'world', x: 0, y: 0, rotation: 0 };

function loadPresets(): EffectsDocument {
  const report = validateEffectsDocument(JSON.parse(readFileSync(PRESETS_PATH, 'utf8')));
  expect(report.errors).toEqual([]);
  expect(report.document).not.toBeNull();
  return report.document!;
}

// Deep-clone a JSON-serializable value (the presets are plain JSON). Used to derive an ambient variant of
// a preset without mutating the shared document.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Build a tiny two-effect document from a base emitter preset: one deterministic, one ambient
// (deterministic: false), so the tier-scaling rule (deterministic pinned, ambient scaled) can be
// asserted side by side. The effect key and config.name are kept equal (no validator warning).
function ambientVsDeterministicDoc(base: EffectsDocument, baseEffect: string): EffectsDocument {
  const det = clone(base.effects[baseEffect]!);
  det.name = 'det';
  det.deterministic = true;
  const ambient = clone(base.effects[baseEffect]!);
  ambient.name = 'ambient';
  ambient.deterministic = false;
  const doc: EffectsDocument = {
    effectsFormatVersion: base.effectsFormatVersion,
    name: 'perf-tier-probe',
    hash: '',
    atlas: base.atlas,
    effects: { det, ambient },
    bundles: {},
  };
  // The content hash is over the document body, so the derived doc needs its own recomputed hash before
  // the validator's hash-integrity check (the cloned effects still resolve in the shared atlas).
  doc.hash = computeEffectsContentHash(doc);
  const report = validateEffectsDocument(doc);
  expect(report.errors).toEqual([]);
  return report.document!;
}

function firstEmitterMaxParticles(effect: EffectConfig): number {
  const layer = effect.layers.find((l) => l.type === 'emitter');
  if (layer === undefined || layer.type !== 'emitter') throw new Error('no emitter layer');
  return layer.maxParticles;
}

describe('WP-3.9 particle perf gates (conformance C.4)', () => {
  it('the committed baseline maxLiveParticles agrees with runtime-core DEFAULT_MAX_LIVE_PARTICLES (drift guard)', () => {
    const baseline = loadPerfBaseline();
    expect(baseline.maxLiveParticles).toBe(DEFAULT_MAX_LIVE_PARTICLES);
    expect(baseline.qualityTierScale.high).toBe(1.0);
    expect(baseline.qualityTierScale.medium).toBeLessThan(1.0);
    expect(baseline.qualityTierScale.low).toBeLessThan(baseline.qualityTierScale.medium);
  });

  it('no emitter exceeds its maxParticles and the scene never exceeds MAX_LIVE_PARTICLES under heavy over-spawn', () => {
    const baseline = loadPerfBaseline();
    const doc = loadPresets();
    const sys = new EffectSystem(doc, { maxLiveParticles: baseline.maxLiveParticles });
    const cap = firstEmitterMaxParticles(doc.effects['coinShowerLarge']!);

    // Trigger enough heavy rate emitters that their combined steady-state live count exceeds the global
    // budget, forcing the eviction policy to hold the scene at the cap.
    const INSTANCES = 12;
    for (let i = 0; i < INSTANCES; i += 1) {
      sys.trigger({ effect: 'coinShowerLarge', anchor: WORLD, seed: 100 + i, startTime: 0 });
    }
    expect(INSTANCES * cap).toBeGreaterThan(baseline.maxLiveParticles); // the stress is real

    let observedTotalPeak = 0;
    for (let step = 0; step < 200; step += 1) {
      sys.step(DT);
      const total = sys.liveParticleTotal();
      observedTotalPeak = Math.max(observedTotalPeak, total);
      // The global budget holds AFTER each frame's eviction pass (section 8.8).
      expect(total).toBeLessThanOrEqual(baseline.maxLiveParticles);
      // Each emitter respects its own hard pool cap at all times.
      for (const inst of sys.readState().instances) {
        for (const e of inst.emitters) {
          expect(e.liveCount).toBeLessThanOrEqual(e.capacity);
          expect(e.capacity).toBeLessThanOrEqual(cap);
        }
      }
    }
    // The stress genuinely pushed the scene to (near) the budget, so the cap was actually exercised.
    expect(observedTotalPeak).toBeGreaterThan(baseline.maxLiveParticles * 0.5);
  });

  it('quality-tier scaling reduces AMBIENT counts by the baseline multiplier and leaves deterministic counts unchanged', () => {
    const baseline = loadPresets();
    const doc = ambientVsDeterministicDoc(baseline, 'coinShowerLarge');
    const baseCap = firstEmitterMaxParticles(doc.effects['det']!);

    const high = new EffectSystem(doc, { qualityTier: 'high' });
    const low = new EffectSystem(doc, { qualityTier: 'low' });
    for (const sys of [high, low]) {
      sys.trigger({ effect: 'det', anchor: WORLD, seed: 1, startTime: 0 });
      sys.trigger({ effect: 'ambient', anchor: WORLD, seed: 1, startTime: 0 });
    }

    // Step into the active emission window where the rate emitter has ramped to a steady live count.
    for (let step = 0; step < 110; step += 1) {
      high.step(DT);
      low.step(DT);
    }

    const scale = loadPerfBaseline().qualityTierScale.low;
    const cap = (sys: EffectSystem, effectIdx: number): number =>
      sys.readState().instances[effectIdx]!.emitters[0]!.capacity;
    const live = (sys: EffectSystem, effectIdx: number): number =>
      sys.readState().instances[effectIdx]!.emitters[0]!.liveCount;

    // Instance order matches trigger order: index 0 = 'det', index 1 = 'ambient'.
    // Deterministic effect: maxParticles is PINNED across tiers (counts are part of the contract).
    expect(cap(high, 0)).toBe(baseCap);
    expect(cap(low, 0)).toBe(baseCap);
    expect(live(low, 0)).toBe(live(high, 0));

    // Ambient effect: maxParticles scales by the tier multiplier (floored, never below 1), and the
    // steady live count drops accordingly (the scaled rate fills a scaled pool).
    expect(cap(high, 1)).toBe(baseCap);
    expect(cap(low, 1)).toBe(Math.max(1, Math.floor(baseCap * scale)));
    expect(live(low, 1)).toBeLessThan(live(high, 1));
  });

  it('pool high-water is bounded and stepOnce churn allocates no heap after warmup', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the WP-3.9 pool gate requires the worker to run with --expose-gc');
    }
    const doc = loadPresets();
    const sys = new EffectSystem(doc);
    const cap = firstEmitterMaxParticles(doc.effects['coinShowerLarge']!);
    // An endless churn: re-trigger as instances drain so spawn + recycle run continuously.
    sys.trigger({ effect: 'coinShowerLarge', anchor: WORLD, seed: 9, startTime: 0 });

    let highWater = 0;
    // Warm up to steady state (the pool free-list churning spawn <-> recycle).
    for (let i = 0; i < 1500; i += 1) {
      sys.step(DT);
      highWater = Math.max(highWater, sys.liveParticleTotal());
    }
    // High-water never exceeds the per-emitter hard cap (the pool is pre-allocated, never grown).
    expect(highWater).toBeLessThanOrEqual(cap);
    expect(highWater).toBeGreaterThan(0); // the churn was real (particles actually spawned)

    // Re-trigger repeatedly to keep emission alive, measuring heap across many spawn/recycle cycles.
    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 20_000; i += 1) {
      if (sys.liveInstanceCount() === 0) {
        sys.trigger({ effect: 'coinShowerLarge', anchor: WORLD, seed: 9, startTime: 0 });
      }
      sys.step(DT);
    }
    runGc();
    const growth = memoryUsage().heapUsed - before;
    // The per-particle spawn/integrate/recycle path is pure index bookkeeping over pre-allocated SoA
    // buffers, so 20k frames of churn add no per-particle heap. Allow GC/measurement noise + the
    // occasional re-trigger's one-time instance allocation.
    expect(growth).toBeLessThan(4 * 1024 * 1024);
  });

  it('step + readState stay within the committed per-frame heap budget over a long run', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the WP-3.9 per-frame heap gate requires --expose-gc');
    }
    const baseline = loadPerfBaseline();
    const doc = loadPresets();
    const sys = new EffectSystem(doc);
    sys.trigger({ effect: 'coinShowerLarge', anchor: WORLD, seed: 3, startTime: 0 });
    sys.trigger({ effect: 'godRaysSprite', anchor: WORLD, seed: 4, startTime: 0 });
    sys.trigger({ effect: 'ribbonTrailGold', anchor: WORLD, seed: 5, startTime: 0 });
    // Warm up; the steady state churns the pool and rebuilds the per-frame view arrays.
    for (let i = 0; i < 2000; i += 1) {
      sys.step(DT);
      sys.readState();
    }
    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < baseline.perFrameStepHeapBudgetFrames; i += 1) {
      sys.step(DT);
      sys.readState();
    }
    runGc();
    const growth = memoryUsage().heapUsed - before;
    expect(growth).toBeLessThan(baseline.perFrameStepHeapBudgetBytes);
  });
});
