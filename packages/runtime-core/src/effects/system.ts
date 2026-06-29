import type {
  EffectBundle,
  EffectConfig,
  EffectsDocument,
  EmitterLayer,
  RibbonTrailLayer,
  SpriteAnimatorLayer,
} from '@marionette/format/types';
import type { Mat2x3 } from '../math/affine';
import { transformPoint } from '../math/affine';
import { resolveAnchor } from './anchor';
import type { BoneAnchorResolver, EffectAnchor } from './anchor';
import { expandBundle } from './bundle';
import {
  isEmitterDone,
  makeEmitterInstance,
  prepareEmitter,
  stepEmitterOnce,
} from './emitter-solve';
import type { EmitterInstance, PreparedEmitter } from './emitter-solve';
import { releaseSlot } from './pool';
import { hash32 } from './prng';
import {
  buildRibbonStrip,
  makeRibbonInstance,
  prepareRibbon,
  recordRibbonPoint,
} from './ribbon-solve';
import type { PreparedRibbon, RibbonInstance } from './ribbon-solve';
import {
  isSpriteAnimatorDone,
  makeSpriteAnimatorState,
  prepareSpriteAnimator,
  stepSpriteAnimatorOnce,
} from './sprite-animator-solve';
import type { PreparedSpriteAnimator, SpriteAnimatorState } from './sprite-animator-solve';

// The EffectSystem (phase-3-vfx-particles.md section 8.7, 8.8, WP-3.4): holds live effect instances, a
// by-name trigger API the Phase 4 sequencer calls, the anchor model, the global live-particle budget +
// eviction policy, and bundle expansion. PixiJS-free, math-bridge-free (LAW 1: triggers are pure inputs,
// particle state never feeds back into any outcome type). step(dt) advances all live instances
// allocation-free after warmup.

// Branded instance id (a monotonic counter, opaque). Kept as a number for cheap comparison/eviction.
export type EffectInstanceId = number;

// The default global live-particle budget (section 8.8). Configurable per scene via SystemOptions.
export const DEFAULT_MAX_LIVE_PARTICLES = 2000;

// Quality tiers scale spawn rate and maxParticles for AMBIENT (deterministic: false) effects ONLY
// (section 7.3, 8.8). Deterministic effects ignore the multiplier (their counts are part of the
// contract). Cross-tier visual identity is explicitly NOT promised.
export type QualityTier = 'low' | 'medium' | 'high';
const TIER_SCALE: Readonly<Record<QualityTier, number>> = { low: 0.4, medium: 0.7, high: 1.0 };

// The by-name trigger (section 8.7). All fields are pure inputs (LAW 1). `seed` is used iff the effect
// config is deterministic. `startTime` is the scene-clock time emission begins.
export interface EffectTrigger {
  readonly effect: string;
  readonly anchor: EffectAnchor;
  readonly seed: number;
  readonly startTime: number;
}

// A budget-overflow warning emitted when the global budget forces an eviction (section 8.8). Surfaced
// through an injected channel so the editor/preview can warn authors to lower counts; runtime-web may
// ignore it. Carries enough to identify the victim.
export interface BudgetWarning {
  readonly kind: 'budget-overflow';
  readonly evictedInstanceId: EffectInstanceId;
  readonly evictedSpawnOrder: number;
  readonly liveTotal: number;
}

export interface SystemOptions {
  readonly maxLiveParticles?: number;
  readonly qualityTier?: QualityTier;
  // Resolves `bone` anchors to a CURRENT-frame world transform (section 8.4 timing). Optional; without
  // it, bone anchors fall back to identity.
  readonly resolveBone?: BoneAnchorResolver;
  // Receives budget-overflow warnings (section 8.8). Optional.
  readonly onWarning?: (warning: BudgetWarning) => void;
}

// One emitter sub-instance plus the prepared config and the layer index (for the per-layer stream seed).
interface EmitterSub {
  readonly prepared: PreparedEmitter;
  readonly instance: EmitterInstance;
  readonly layerIndex: number;
}

interface SpriteSub {
  readonly prepared: PreparedSpriteAnimator;
  readonly state: SpriteAnimatorState;
}

interface RibbonSub {
  readonly prepared: PreparedRibbon;
  readonly instance: RibbonInstance;
}

// A live effect instance: all of an effect's layers solved together under one anchor, one fixed-dt
// clock, and (for deterministic effects) one seed. Allocated on trigger; reclaimed when finished.
interface LiveInstance {
  readonly id: EffectInstanceId;
  readonly config: EffectConfig;
  readonly anchor: EffectAnchor;
  readonly deterministic: boolean;
  readonly dt: number;
  // Fixed-dt accumulator (seconds) for the frame loop -> sub-step subdivision (section 8.4).
  acc: number;
  // The scene-clock time emission begins; the instance is dormant until step time reaches it.
  readonly startTime: number;
  // The instance's local clock (seconds since trigger), advanced by step(frameDt).
  localTime: number;
  // emission window end in integer steps (ceil(duration / dt)) or +Inf (endless).
  readonly emitUntilStep: number;
  readonly emitters: EmitterSub[];
  readonly sprites: SpriteSub[];
  readonly ribbons: RibbonSub[];
  // Set by stop(): emission ends, live particles finish (unless hardStopped).
  stopped: boolean;
  hardStopped: boolean;
  // The current frame's resolved anchor world matrix (sampled once per frame, held across sub-steps).
  anchorMat: Mat2x3;
}

// A readonly view of one live effect's solved state, the surface the renderer consumes. Buffers are the
// live SoA arrays (not copied); the renderer must read them within the frame.
export interface ReadonlyEmitterView {
  readonly layer: EmitterLayer;
  readonly anchor: Mat2x3;
  readonly capacity: number;
  readonly liveCount: number;
  readonly alive: Uint8Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly rot: Float64Array;
  readonly outScale: Float64Array;
  readonly outAlpha: Float64Array;
  readonly outR: Float64Array;
  readonly outG: Float64Array;
  readonly outB: Float64Array;
  readonly frame: Int32Array;
  readonly spawnOrder: Int32Array;
}

export interface ReadonlySpriteView {
  readonly layer: SpriteAnimatorLayer;
  readonly anchor: Mat2x3;
  readonly rotationDeg: number;
  readonly scale: number;
  readonly alpha: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ReadonlyRibbonView {
  readonly layer: RibbonTrailLayer;
  readonly anchor: Mat2x3;
  readonly vertexCount: number;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vAlpha: Float64Array;
  readonly vR: Float64Array;
  readonly vG: Float64Array;
  readonly vB: Float64Array;
}

export interface ReadonlyInstanceFrame {
  readonly id: EffectInstanceId;
  readonly emitters: readonly ReadonlyEmitterView[];
  readonly sprites: readonly ReadonlySpriteView[];
  readonly ribbons: readonly ReadonlyRibbonView[];
}

export interface ReadonlyEffectFrame {
  readonly instances: readonly ReadonlyInstanceFrame[];
}

// Thrown when a trigger names an effect (or bundle) not in the loaded document (section 8.7 acceptance:
// a typed error, not a throw-with-string or silent no-op).
export class EffectNotFoundError extends Error {
  readonly code = 'EFFECT_NOT_FOUND';
  constructor(public readonly effectName: string) {
    super(`effect "${effectName}" is not defined in the loaded EffectsDocument`);
    this.name = 'EffectNotFoundError';
  }
}

export class BundleNotFoundError extends Error {
  readonly code = 'BUNDLE_NOT_FOUND';
  constructor(public readonly bundleName: string) {
    super(`bundle "${bundleName}" is not defined in the loaded EffectsDocument`);
    this.name = 'BundleNotFoundError';
  }
}

// emitUntilStep from an effect duration (section 8.4): ceil(duration / dt), or +Inf for endless.
function emitUntilStepOf(config: EffectConfig): number {
  return config.duration === null
    ? Number.POSITIVE_INFINITY
    : Math.ceil(config.duration / config.simulationDt);
}

// The EffectSystem. Construct with the loaded document and options; trigger by name; step per frame;
// read the solved state. Holds live instances in an array; instance ids are a monotonic counter.
export class EffectSystem {
  private readonly doc: EffectsDocument;
  private readonly maxLive: number;
  private readonly tier: QualityTier;
  private readonly resolveBone: BoneAnchorResolver | null;
  private readonly onWarning: ((w: BudgetWarning) => void) | null;
  private readonly live: LiveInstance[] = [];
  private nextId: EffectInstanceId = 1;
  // Reused frame view, rebuilt in place per readState so the read path allocates within bounds. The
  // views reference the live SoA buffers (no per-particle copy).
  private readonly frameViews: ReadonlyInstanceFrame[] = [];

  constructor(doc: EffectsDocument, options: SystemOptions = {}) {
    this.doc = doc;
    this.maxLive = options.maxLiveParticles ?? DEFAULT_MAX_LIVE_PARTICLES;
    this.tier = options.qualityTier ?? 'high';
    this.resolveBone = options.resolveBone ?? null;
    this.onWarning = options.onWarning ?? null;
  }

  // Trigger an effect by name (section 8.7). Returns the new instance id. Throws EffectNotFoundError for
  // an unknown name. The seed is used iff the effect is deterministic; ambient effects ignore it.
  trigger(t: EffectTrigger): EffectInstanceId {
    const config = this.doc.effects[t.effect];
    if (config === undefined) throw new EffectNotFoundError(t.effect);
    return this.instantiate(config, t.anchor, t.seed, t.startTime);
  }

  // Expand a bundle into instances (section 8.7, 8.8): each item fires at its startOffset (relative to
  // the bundle start), at the anchor resolved from `anchors[item.anchorRole]`, with the per-item seed
  // hash32(baseSeed, item.seedSalt). Returns the spawned instance ids in item order. Unknown bundle or
  // an item referencing an unknown effect is a typed error.
  triggerBundle(
    bundle: string,
    baseSeed: number,
    anchors: Readonly<Record<string, EffectAnchor>>,
    startTime: number,
  ): EffectInstanceId[] {
    const def: EffectBundle | undefined = this.doc.bundles[bundle];
    if (def === undefined) throw new BundleNotFoundError(bundle);
    const ids: EffectInstanceId[] = [];
    for (const expanded of expandBundle(def, baseSeed, anchors, startTime)) {
      const config = this.doc.effects[expanded.effect];
      if (config === undefined) throw new EffectNotFoundError(expanded.effect);
      ids.push(this.instantiate(config, expanded.anchor, expanded.seed, expanded.startTime));
    }
    return ids;
  }

  // End emission for an instance (section 8.7). Live particles finish unless hardStop is set. A no-op for
  // an unknown id (the instance may already have been reclaimed).
  stop(id: EffectInstanceId, hardStop = false): void {
    for (const inst of this.live) {
      if (inst.id === id) {
        inst.stopped = true;
        if (hardStop) inst.hardStopped = true;
        return;
      }
    }
  }

  // Advance all live instances by `frameDt` seconds (section 8.4): each instance accumulates time and
  // runs zero-or-more fixed-dt sub-steps; the anchor is resolved ONCE per frame and held across
  // sub-steps. Finished non-looping instances are reclaimed. The global budget is enforced AFTER
  // stepping (eviction). Allocation-free in the steady state (no instance creation/removal).
  step(frameDt: number): void {
    for (let i = 0; i < this.live.length; i += 1) {
      const inst = this.live[i]!;
      inst.localTime += frameDt;
      // Dormant until the scene clock reaches the instance's start time.
      const active = inst.localTime >= inst.startTime;
      if (!active) continue;

      // Resolve the anchor ONCE this frame (section 8.4); hold it across sub-steps.
      inst.anchorMat = resolveAnchor(inst.anchor, this.resolveBone);

      inst.acc += frameDt;
      const dt = inst.dt;
      while (inst.acc >= dt) {
        this.subStep(inst);
        inst.acc -= dt;
      }
      // Ribbon geometry is rebuilt once per frame from the per-frame anchor path (section 8.4/8.6).
      for (const r of inst.ribbons) buildRibbonStrip(r.instance);
    }

    this.enforceBudget();
    this.reclaimFinished();
  }

  // The renderer-facing readonly view (section 8.7). Rebuilds the view array in place; the views
  // reference the live SoA buffers (no per-particle copy), so the renderer must consume them this frame.
  readState(): ReadonlyEffectFrame {
    this.frameViews.length = 0;
    for (const inst of this.live) {
      const emitters: ReadonlyEmitterView[] = [];
      for (const e of inst.emitters) {
        const pool = e.instance.pool;
        emitters.push({
          layer: e.prepared.layer,
          anchor: inst.anchorMat,
          capacity: pool.capacity,
          liveCount: e.instance.poolState.liveCount,
          alive: pool.alive,
          px: pool.px,
          py: pool.py,
          rot: pool.rot,
          outScale: pool.outScale,
          outAlpha: pool.outAlpha,
          outR: pool.outR,
          outG: pool.outG,
          outB: pool.outB,
          frame: pool.frame,
          spawnOrder: pool.spawnOrder,
        });
      }
      const sprites: ReadonlySpriteView[] = [];
      for (const s of inst.sprites) {
        sprites.push({
          layer: s.prepared.layer,
          anchor: inst.anchorMat,
          rotationDeg: s.state.rotationDeg,
          scale: s.state.scale,
          alpha: s.state.alpha,
          r: s.state.r[0]!,
          g: s.state.g[0]!,
          b: s.state.b[0]!,
        });
      }
      const ribbons: ReadonlyRibbonView[] = [];
      for (const r of inst.ribbons) {
        ribbons.push({
          layer: r.prepared.layer,
          anchor: inst.anchorMat,
          vertexCount: r.instance.vertexCount,
          vx: r.instance.vx,
          vy: r.instance.vy,
          vAlpha: r.instance.vAlpha,
          vR: r.instance.vR,
          vG: r.instance.vG,
          vB: r.instance.vB,
        });
      }
      this.frameViews.push({ id: inst.id, emitters, sprites, ribbons });
    }
    return { instances: this.frameViews };
  }

  // The number of currently live instances (for tests / a stats HUD).
  liveInstanceCount(): number {
    return this.live.length;
  }

  // The current global live-particle total across all instances (for the budget and a stats HUD).
  liveParticleTotal(): number {
    let total = 0;
    for (const inst of this.live) {
      for (const e of inst.emitters) total += e.instance.poolState.liveCount;
    }
    return total;
  }

  // ---- internals ----

  private instantiate(
    config: EffectConfig,
    anchor: EffectAnchor,
    seed: number,
    startTime: number,
  ): EffectInstanceId {
    const id = this.nextId;
    this.nextId += 1;
    const dt = config.simulationDt;
    const emitUntilStep = emitUntilStepOf(config);
    // Ambient effects tier-scale spawn rate + maxParticles (section 7.3, 8.8); deterministic effects use
    // authored counts unchanged. The per-layer stream seed is hash32(triggerSeed, layerIndex).
    const scale = config.deterministic ? 1 : TIER_SCALE[this.tier];

    const emitters: EmitterSub[] = [];
    const sprites: SpriteSub[] = [];
    const ribbons: RibbonSub[] = [];

    for (let layerIndex = 0; layerIndex < config.layers.length; layerIndex += 1) {
      const layer = config.layers[layerIndex]!;
      if (layer.type === 'emitter') {
        const scaled = scale === 1 ? layer : scaleEmitterLayer(layer, scale);
        const prepared = prepareEmitter(scaled, dt);
        const instanceSeed = hash32(seed, layerIndex) >>> 0;
        emitters.push({
          prepared,
          instance: makeEmitterInstance(prepared, instanceSeed, emitUntilStep),
          layerIndex,
        });
      } else if (layer.type === 'spriteAnimator') {
        const prepared = prepareSpriteAnimator(layer, dt);
        sprites.push({ prepared, state: makeSpriteAnimatorState() });
      } else {
        const prepared = prepareRibbon(layer);
        ribbons.push({ prepared, instance: makeRibbonInstance(prepared) });
      }
    }

    this.live.push({
      id,
      config,
      anchor,
      deterministic: config.deterministic,
      dt,
      acc: 0,
      startTime,
      localTime: 0,
      emitUntilStep,
      emitters,
      sprites,
      ribbons,
      stopped: false,
      hardStopped: false,
      anchorMat: resolveAnchor(anchor, this.resolveBone),
    });
    return id;
  }

  // One fixed-dt sub-step of a live instance: step every layer. The anchor is held constant across
  // sub-steps (section 8.4). A soft stop suppresses new spawns (live particles finish); a hard stop
  // clears live particles immediately.
  private subStep(inst: LiveInstance): void {
    for (const e of inst.emitters) {
      if (inst.hardStopped) {
        // Hard stop: clear all live particles immediately (the instance finishes this frame).
        hardClearEmitter(e.instance);
      } else {
        // Soft stop ends emission but lets live particles integrate to end of life (section 8.7).
        e.instance.suppressSpawn = inst.stopped;
        stepEmitterOnce(e.instance);
      }
    }
    for (const s of inst.sprites) stepSpriteAnimatorOnce(s.prepared, s.state);
    for (const r of inst.ribbons) {
      // Record the per-frame anchor position (the anchor's translation) into the ribbon ring. The anchor
      // is held across sub-steps, so this records at most one distinct point per frame (section 8.4).
      const p = transformPoint(inst.anchorMat, 0, 0);
      recordRibbonPoint(r.instance, p[0], p[1]);
    }
  }

  // Reclaim instances that have finished: emission ended AND no live particles / sprite cycles remain
  // (section 8.7). Looping sprite animators never report done, so an instance with a looping sprite is
  // reclaimed only when explicitly stopped. Allocation-free in the steady state (no removals).
  private reclaimFinished(): void {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const inst = this.live[i]!;
      if (this.isInstanceFinished(inst)) {
        // Swap-remove (order among live instances does not affect determinism; the per-instance solve is
        // self-contained and eviction ties break on id, not array position).
        const last = this.live.length - 1;
        this.live[i] = this.live[last]!;
        this.live.pop();
      }
    }
  }

  private isInstanceFinished(inst: LiveInstance): boolean {
    // An instance whose start time has not arrived (a delayed bundle item) is never finished: it has not
    // had a chance to emit yet. A hard stop overrides this (it ends the instance regardless).
    if (!inst.hardStopped && inst.localTime < inst.startTime) return false;
    // A hard stop finishes once every emitter's live particles are cleared (cleared in subStep).
    if (inst.hardStopped) {
      for (const e of inst.emitters) if (e.instance.poolState.liveCount > 0) return false;
      return true;
    }
    // A looping sprite animator never finishes on its own; it requires an explicit stop. A non-looping
    // sprite finishes after one cycle. While any sprite is still running the instance stays live.
    for (const s of inst.sprites) {
      if (s.prepared.layer.loop) {
        if (!inst.stopped) return false;
      } else if (!isSpriteAnimatorDone(s.prepared, s.state)) {
        return false;
      }
    }
    // Every emitter must be done (emission ended and no live particles). isEmitterDone already accounts
    // for the soft-stop suppressSpawn flag set in subStep.
    for (const e of inst.emitters) {
      if (!isEmitterDone(e.instance)) return false;
    }
    // A ribbon-only or sprite-only instance with no remaining emitters is reclaimed once its sprites are
    // done (above) and it has been stopped; a ribbon follows an anchor endlessly, so a pure-ribbon
    // instance finishes only when explicitly stopped.
    if (inst.emitters.length === 0 && inst.sprites.length === 0 && inst.ribbons.length > 0) {
      return inst.stopped;
    }
    return true;
  }

  // Enforce the global live-particle budget (section 8.8): while the total exceeds the cap, evict the
  // OLDEST live particle of the LOWEST-priority active effect (ambient before deterministic), ties
  // broken by lowest instance id then lowest spawnOrder. Each eviction emits a budget-overflow warning.
  private enforceBudget(): void {
    let total = this.liveParticleTotal();
    // Bound the eviction loop by the current total to avoid any chance of an infinite loop.
    let guard = total;
    while (total > this.maxLive && guard > 0) {
      const victim = this.findEvictionVictim();
      if (victim === null) break;
      const { sub, slot, spawnOrder, instanceId } = victim;
      // Recycle the oldest live particle (release its pool slot).
      releaseEmitterSlot(sub.instance, slot);
      total -= 1;
      guard -= 1;
      if (this.onWarning) {
        this.onWarning({
          kind: 'budget-overflow',
          evictedInstanceId: instanceId,
          evictedSpawnOrder: spawnOrder,
          liveTotal: total,
        });
      }
    }
  }

  // Find the single particle to evict per the policy (section 8.8). Lowest priority first (ambient
  // before deterministic), then lowest instance id, then the oldest live particle (lowest spawnOrder).
  private findEvictionVictim(): {
    sub: EmitterSub;
    slot: number;
    spawnOrder: number;
    instanceId: EffectInstanceId;
  } | null {
    let best: {
      sub: EmitterSub;
      slot: number;
      spawnOrder: number;
      instanceId: EffectInstanceId;
      ambient: boolean;
    } | null = null;
    for (const inst of this.live) {
      const ambient = !inst.deterministic;
      for (const sub of inst.emitters) {
        const pool = sub.instance.pool;
        for (let s = 0; s < pool.capacity; s += 1) {
          if (pool.alive[s] === 0) continue;
          const order = pool.spawnOrder[s]!;
          if (best === null) {
            best = { sub, slot: s, spawnOrder: order, instanceId: inst.id, ambient };
            continue;
          }
          // Priority: ambient (lower priority) wins over deterministic.
          if (ambient !== best.ambient) {
            if (ambient && !best.ambient) {
              best = { sub, slot: s, spawnOrder: order, instanceId: inst.id, ambient };
            }
            continue;
          }
          // Same priority: lowest instance id.
          if (inst.id !== best.instanceId) {
            if (inst.id < best.instanceId) {
              best = { sub, slot: s, spawnOrder: order, instanceId: inst.id, ambient };
            }
            continue;
          }
          // Same instance: oldest (lowest spawnOrder).
          if (order < best.spawnOrder) {
            best = { sub, slot: s, spawnOrder: order, instanceId: inst.id, ambient };
          }
        }
      }
    }
    if (best === null) return null;
    return {
      sub: best.sub,
      slot: best.slot,
      spawnOrder: best.spawnOrder,
      instanceId: best.instanceId,
    };
  }
}

// Scale an emitter layer's spawn rate and maxParticles for an ambient effect at a quality tier (section
// 8.8). Deterministic effects never reach here (scale === 1). Counts round down (floor) so a tier cannot
// EXCEED the authored cap; maxParticles stays at least 1. A fresh layer object is built ONCE at trigger
// time (not in the step path), so this allocation is outside the per-frame hot path.
function scaleEmitterLayer(layer: EmitterLayer, scale: number): EmitterLayer {
  const maxParticles = Math.max(1, Math.floor(layer.maxParticles * scale));
  let spawn = layer.spawn;
  if (spawn.mode === 'rate') {
    spawn = { mode: 'rate', particlesPerSecond: spawn.particlesPerSecond * scale };
  } else if (spawn.mode === 'burst') {
    spawn = { mode: 'burst', count: Math.floor(spawn.count * scale), atTime: spawn.atTime };
  } else {
    spawn = {
      mode: 'bursts',
      bursts: spawn.bursts.map((b) => ({ atTime: b.atTime, count: Math.floor(b.count * scale) })),
    };
  }
  return { ...layer, maxParticles, spawn };
}

// Release a specific live pool slot (used by eviction). The pool's releaseSlot is the single owner of
// the free-list bookkeeping; this passes the instance's pool + poolState through. Allocation-free.
function releaseEmitterSlot(instance: EmitterInstance, slot: number): void {
  releaseSlot(instance.pool, instance.poolState, slot);
}

// Clear all live particles in an emitter immediately (hard stop). Allocation-free.
function hardClearEmitter(instance: EmitterInstance): void {
  const pool = instance.pool;
  for (let s = 0; s < pool.capacity; s += 1) {
    if (pool.alive[s] === 1) releaseSlot(pool, instance.poolState, s);
  }
}
