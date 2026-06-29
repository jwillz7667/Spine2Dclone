import {
  buildRibbonStrip,
  hash32,
  makeEmitterInstance,
  makePrng,
  makeRibbonInstance,
  makeSpriteAnimatorState,
  nextU32,
  prepareEmitter,
  prepareRibbon,
  prepareSpriteAnimator,
  recordRibbonPoint,
  stepEmitterOnce,
  stepSpriteAnimatorOnce,
} from '@marionette/runtime-core';
import type {
  EmitterInstance,
  RibbonInstance,
  SpriteAnimatorState,
} from '@marionette/runtime-core';
import type {
  EffectConfig,
  EffectsDocument,
  EmitterLayer,
  RibbonTrailLayer,
  SpriteAnimatorLayer,
} from '@marionette/format/effects-types';
import type {
  EffectsFixture,
  EffectsSample,
  EmitterState,
  ParticleRow,
  RibbonState,
  RibbonVertex,
  SpriteState,
} from './schema/effects-fixture';
import type { EffectsSampleSpec } from './schema/effects-sample-spec';

// The pure particle fixture builder (phase-3-vfx-particles.md section 8.9, WP-3.10, TASK-3.10.2). This
// is the behavioral source of truth (INV-conformance-from-core): it imports @marionette/runtime-core
// (the effects solve) and @marionette/format effects TYPES only, no filesystem, no clock, no random
// beyond the seeded PRNG. It runs the canonical solve over a validated effect at the committed
// sample-spec's fixed simulationDt and seed, advancing the integer step clock and recording the solved
// state at each sampled step. generate-effects.ts wraps this with file I/O and provenance.
//
// It drives the layer-level solve primitives (prepareEmitter/stepEmitterOnce, the sprite-animator step,
// the ribbon record + strip build) DIRECTLY rather than through the full EffectSystem, mirroring how the
// skeletal builder calls sampleSkeleton directly: this keeps the fixture a pure, anchor-free, budget-free
// per-effect stepper whose ONLY inputs are (effect, seed, dt, steps). The per-layer stream seed is the
// normative hash32(triggerSeed, layerIndex) (section 8.3), exactly as the EffectSystem mints it, so the
// dump matches what the system would produce for the same effect under a world anchor at the origin.
//
// Ribbon anchor path (NOTE, the one place the builder synthesizes an input the EffectSystem would
// otherwise supply from the scene): a ribbon's geometry is a pure function of the per-frame anchor path
// (section 8.6). With no scene, the builder feeds a DETERMINISTIC synthetic path: the anchor starts at
// the origin and advances by RIBBON_ANCHOR_STEP units in +x each step. This is documented and committed
// in the fixture so it is reproducible; it exercises the segmentSpacing threshold, the ring fill, and the
// strip geometry without coupling the particle conformance to a skeleton rig. Bone/world anchor coverage
// of ribbons under a real anchor is the WP-3.11 DoD harness's job, not this fixture's.
const RIBBON_ANCHOR_STEP = 5;

// Look up the named EffectConfig in a committed effects rig (a full EffectsDocument). A missing name is a
// fixture-authoring bug (the spec names an effect the rig does not define), surfaced loudly.
export function selectEffect(document: EffectsDocument, effectName: string): EffectConfig {
  const config = document.effects[effectName];
  if (config === undefined) {
    const known = Object.keys(document.effects).join(', ');
    throw new Error(
      `effects rig does not define effect "${effectName}" (defined effects: ${known})`,
    );
  }
  return config;
}

// Provenance recorded on the fixture (A.3). None of it participates in comparison; it exists for review
// (which rig/spec/toolchain produced this fixture) and for the .effects-fixtures.lock drift gate.
export interface EffectsFixtureProvenance {
  readonly effectId: string;
  readonly rigHash: string;
  readonly specHash: string;
  readonly coreVersion: string;
  readonly toolchain: string;
  readonly generatedBy: string;
}

// One emitter layer's live solve state, plus its layer name (for the dump key) and its layer index (for
// the per-layer stream seed hash32(seed, layerIndex), section 8.3).
interface EmitterSub {
  readonly name: string;
  readonly instance: EmitterInstance;
}

interface SpriteSub {
  readonly name: string;
  readonly state: SpriteAnimatorState;
  readonly prepared: ReturnType<typeof prepareSpriteAnimator>;
}

interface RibbonSub {
  readonly name: string;
  readonly instance: RibbonInstance;
}

// Build the live per-layer solve state for one effect under the deterministic seed. emitUntilStep is
// the effect's emission window in integer steps (ceil(duration / dt), or +Inf), matching the system.
function buildSubs(
  config: EffectConfig,
  seed: number,
  dt: number,
): { emitters: EmitterSub[]; sprites: SpriteSub[]; ribbons: RibbonSub[] } {
  const emitUntilStep =
    config.duration === null ? Number.POSITIVE_INFINITY : Math.ceil(config.duration / dt);
  const emitters: EmitterSub[] = [];
  const sprites: SpriteSub[] = [];
  const ribbons: RibbonSub[] = [];

  for (let layerIndex = 0; layerIndex < config.layers.length; layerIndex += 1) {
    const layer = config.layers[layerIndex]!;
    if (layer.type === 'emitter') {
      const emitterLayer: EmitterLayer = layer;
      const prepared = prepareEmitter(emitterLayer, dt);
      // The normative per-layer stream seed (section 8.3), identical to EffectSystem.instantiate.
      const instanceSeed = hash32(seed, layerIndex) >>> 0;
      emitters.push({
        name: emitterLayer.name,
        instance: makeEmitterInstance(prepared, instanceSeed, emitUntilStep),
      });
    } else if (layer.type === 'spriteAnimator') {
      const spriteLayer: SpriteAnimatorLayer = layer;
      sprites.push({
        name: spriteLayer.name,
        state: makeSpriteAnimatorState(),
        prepared: prepareSpriteAnimator(spriteLayer, dt),
      });
    } else {
      const ribbonLayer: RibbonTrailLayer = layer;
      ribbons.push({
        name: ribbonLayer.name,
        instance: makeRibbonInstance(prepareRibbon(ribbonLayer)),
      });
    }
  }
  return { emitters, sprites, ribbons };
}

// Snapshot one emitter's live particles, sorted by spawnOrder (the exact conformance key), so the
// committed JSON row order is stable for diffs regardless of pool-slot iteration order.
function snapshotEmitter(sub: EmitterSub): EmitterState {
  const pool = sub.instance.pool;
  const rows: ParticleRow[] = [];
  for (let s = 0; s < pool.capacity; s += 1) {
    if (pool.alive[s] === 0) continue;
    rows.push({
      spawnOrder: pool.spawnOrder[s]!,
      frame: pool.frame[s]!,
      alive: 1,
      px: pool.px[s]!,
      py: pool.py[s]!,
      rot: pool.rot[s]!,
      outScale: pool.outScale[s]!,
      outR: pool.outR[s]!,
      outG: pool.outG[s]!,
      outB: pool.outB[s]!,
      outAlpha: pool.outAlpha[s]!,
    });
  }
  rows.sort((a, b) => a.spawnOrder - b.spawnOrder);
  return { layerName: sub.name, liveCount: sub.instance.poolState.liveCount, particles: rows };
}

function snapshotSprite(sub: SpriteSub): SpriteState {
  const st = sub.state;
  return {
    layerName: sub.name,
    stepIndex: st.stepIndex,
    rotationDeg: st.rotationDeg,
    scale: st.scale,
    alpha: st.alpha,
    r: st.r[0]!,
    g: st.g[0]!,
    b: st.b[0]!,
  };
}

function snapshotRibbon(sub: RibbonSub): RibbonState {
  const inst = sub.instance;
  const vertices: RibbonVertex[] = [];
  // Two vertices per recorded point (the strip left/right edges), section 8.6.
  for (let v = 0; v < inst.vertexCount * 2; v += 1) {
    vertices.push({
      vx: inst.vx[v]!,
      vy: inst.vy[v]!,
      vAlpha: inst.vAlpha[v]!,
      vR: inst.vR[v]!,
      vG: inst.vG[v]!,
      vB: inst.vB[v]!,
    });
  }
  return { layerName: sub.name, vertexCount: inst.vertexCount, vertices };
}

// The first few nextU32 draws of the layer-0 stream (the PRNG golden-vector reference, WP-3.10
// acceptance): a fresh stream seeded with hash32(seed, 0), advanced GOLDEN_HEAD_LEN times. Recomputed on
// regeneration; locking it ties the committed integer stream to WP-3.1 so a PRNG change fails CI. Uses a
// throwaway stream (does NOT touch the solve's PRNG state).
const GOLDEN_HEAD_LEN = 4;
function prngStreamHead(seed: number): number[] {
  const state = makePrng(hash32(seed, 0) >>> 0);
  const head: number[] = [];
  for (let i = 0; i < GOLDEN_HEAD_LEN; i += 1) head.push(nextU32(state));
  return head;
}

// Run the runtime-core effects solve over one effect at a fixed dt + seed, recording the solved state at
// each sampled step. Pure: advances the integer step clock `spec.steps` times, snapshotting at the steps
// in `spec.snapshotSteps`. A ribbon layer is fed the deterministic synthetic anchor path (see the note
// above). Allocation outside the per-step hot path (the snapshot arrays) is acceptable here, as in the
// skeletal builder.
export function buildEffectsSamples(
  document: EffectsDocument,
  spec: EffectsSampleSpec,
): EffectsSample[] {
  const config = selectEffect(document, spec.effectName);
  if (config.simulationDt !== spec.simulationDt) {
    throw new Error(
      `sample-spec simulationDt ${spec.simulationDt} does not match effect "${spec.effectName}" simulationDt ${config.simulationDt}`,
    );
  }
  const dt = spec.simulationDt;
  const { emitters, sprites, ribbons } = buildSubs(config, spec.seed, dt);
  const snapshotAt = new Set(spec.snapshotSteps);
  const samples: EffectsSample[] = [];

  for (let step = 1; step <= spec.steps; step += 1) {
    for (const e of emitters) stepEmitterOnce(e.instance);
    for (const s of sprites) stepSpriteAnimatorOnce(s.prepared, s.state);
    if (ribbons.length > 0) {
      // The per-frame synthetic anchor position (section 8.4: recorded once per frame). step-1 places
      // the first point at the origin, so the segmentSpacing threshold is exercised as the anchor moves.
      const ax = (step - 1) * RIBBON_ANCHOR_STEP;
      const ay = 0;
      for (const r of ribbons) {
        recordRibbonPoint(r.instance, ax, ay);
        buildRibbonStrip(r.instance);
      }
    }
    if (snapshotAt.has(step)) {
      samples.push({
        step,
        emitters: emitters.map(snapshotEmitter),
        sprites: sprites.map(snapshotSprite),
        ribbons: ribbons.map(snapshotRibbon),
      });
    }
  }
  return samples;
}

export function buildEffectsFixture(
  document: EffectsDocument,
  spec: EffectsSampleSpec,
  provenance: EffectsFixtureProvenance,
): EffectsFixture {
  return {
    effectId: provenance.effectId,
    effectName: spec.effectName,
    rigHash: provenance.rigHash,
    specHash: provenance.specHash,
    seed: spec.seed,
    simulationDt: spec.simulationDt,
    coreVersion: provenance.coreVersion,
    toolchain: provenance.toolchain,
    generatedBy: provenance.generatedBy,
    prngStreamHead: prngStreamHead(spec.seed),
    samples: buildEffectsSamples(document, spec),
  };
}
