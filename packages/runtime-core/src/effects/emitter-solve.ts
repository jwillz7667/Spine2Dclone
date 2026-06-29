import type { EmitterLayer, ParticleTexture } from '@marionette/format/types';
import { drawParticleInitialState } from './draw-order';
import type { SpawnDrawInputs, SpawnState } from './draw-order';
import {
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
} from './life-curve';
import type { PreparedLifeCurveNumber, PreparedLifeCurveRgb } from './life-curve';
import {
  acquireSlot,
  makeParticlePool,
  makeParticlePoolState,
  makeSpawnScratch,
  makeTrailRings,
  pushTrailPoint,
  releaseSlot,
} from './pool';
import type { ParticlePool, ParticlePoolState, TrailRing } from './pool';
import { makePrng } from './prng';
import type { PrngState } from './prng';

// The Tier-S emitter SOLVE (phase-3-vfx-particles.md sections 8.2, 8.4, 8.5, WP-3.2). It writes solved
// per-particle state into pooled SoA buffers with ZERO per-step heap allocation after warmup. It is the
// behavioral source of truth runtime-web renders and Unity/Godot reimplement: PixiJS-free,
// math-bridge-free, deterministic.
//
// Determinism rests on the integer step clock (section 8.4): the spawn schedule, burst firing, recycle,
// and the animated-frame index are integer-step events, so they are bit-portable across runtimes. The
// only float-to-integer steps are single, explicitly-rounded quantizations done ONCE at instance
// creation (and the per-particle lifeSteps at spawn). Positions, velocities, rotations, and curve
// outputs live on the float epsilon path (section 8.9).

// Fixed-point one (2^16) for the integer spawn accumulator and the animated-frame rate (section 8.4).
const SPAWN_FIXED_ONE = 65536;
const DEG_TO_RAD = Math.PI / 180;

// Round-half-away-from-zero, the single rounding rule for the instance-creation quantizations
// (section 8.4). Math.round rounds half UP (toward +Inf), which differs for negatives; spawn rates and
// fps are non-negative, but we use the explicit rule so a native runtime matches exactly.
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

// A burst entry resolved to its integer firing step (section 8.4: burstStep = ceil(atTime / dt)).
interface PreparedBurst {
  readonly step: number;
  readonly count: number;
}

// burstStep = max(1, ceil(atTime / dt)) (section 8.4, with the chosen at-zero interpretation NOTED in
// the report): the integer step a burst fires on. The simulation clock starts at 0 and is incremented
// to 1 BEFORE the first spawnForStep, so a literal ceil(0/dt) = 0 would never fire; clamping to >= 1
// makes an atTime-0 burst fire on the first step (the natural author intent), and any atTime > 0 keeps
// its exact ceil step. Integer-exact and portable.
function burstStepOf(atTime: number, dt: number): number {
  return Math.max(1, Math.ceil(atTime / dt));
}

// An emitter prepared for allocation-free stepping. Everything float-to-integer is computed here, once.
// `inputs` is the narrow draw-order view (the draw helper does not depend on the full layer shape).
export interface PreparedEmitter {
  readonly layer: EmitterLayer;
  readonly dt: number;
  // Integer fixed-point particles-per-step for `rate` mode (section 8.4). Zero for burst-only emitters.
  readonly spawnPerStepFixed: number;
  // Bursts resolved to integer steps (section 8.4), empty for a pure-rate emitter.
  readonly bursts: readonly PreparedBurst[];
  // The last step (inclusive) at which `rate` emission is active; +Inf for an endless emitter.
  readonly emitUntilStep: number;
  // Precomputed over-life curves (section 8.5), tables built once.
  readonly scaleOverLife: PreparedLifeCurveNumber;
  readonly alphaOverLife: PreparedLifeCurveNumber;
  readonly colorOverLife: PreparedLifeCurveRgb;
  // The fixed-point animated-frame advance per step for `loop` mode (section 8.4), 0 if not animated/loop.
  readonly framesPerStepFixed: number;
  // The animated region count (0 for a static texture), held so the frame index never reaches N.
  readonly frameCount: number;
  // The draw-order view passed to drawParticleInitialState.
  readonly drawInputs: SpawnDrawInputs;
  // Constant world-space acceleration (gravity + acceleration), precombined per the integrator order.
  readonly accelX: number;
  readonly accelY: number;
  readonly drag: number;
}

// A live emitter instance: the prepared config, the pooled buffers, the integer step clock, the spawn
// accumulator, the PRNG stream, and the optional per-particle trail rings. Allocated once per trigger.
export interface EmitterInstance {
  readonly prepared: PreparedEmitter;
  readonly pool: ParticlePool;
  readonly poolState: ParticlePoolState;
  readonly prng: PrngState;
  // Reusable spawn scratch so the spawn draw path allocates nothing.
  readonly scratch: SpawnState;
  // Optional pooled trail rings, one per slot, or null when the emitter has no TrailSpec.
  readonly trails: TrailRing[] | null;
  // The integer simulation clock (section 8.4); starts at 0, incremented once per stepOnce.
  stepIndex: number;
  // The integer fixed-point spawn accumulator for `rate` mode (section 8.4).
  spawnAccFixed: number;
  // Monotonic spawn counter -> particle.spawnOrder (exact conformance key, section 8.2 / 8.9).
  nextSpawnOrder: number;
  // When true, spawnForStep emits NO new particles (a soft stop, section 8.7: emission ends but live
  // particles integrate to end of life). The schedule clock still advances so the emitter is bit-exact
  // up to the stop point; setting this never resurrects already-fired bursts.
  suppressSpawn: boolean;
}

// Resolve the animated frame count and the fixed-point advance for `loop` mode, once.
function prepareFrames(texture: ParticleTexture, dt: number): { fixed: number; count: number } {
  if (texture.kind !== 'animated') return { fixed: 0, count: 0 };
  const count = texture.regions.length;
  // framesPerStepFixed = round(fps * dt * 65536), two multiplies left to right then one round.
  const fixed =
    texture.mode === 'loop' ? roundHalfAwayFromZero(texture.fps * dt * SPAWN_FIXED_ONE) : 0;
  return { fixed, count };
}

// Prepare an emitter layer for stepping. Computes every float-to-integer quantization once (section
// 8.4) and precomputes the over-life curve tables (section 8.5). `dt` is the effect's simulationDt.
export function prepareEmitter(layer: EmitterLayer, dt: number): PreparedEmitter {
  let spawnPerStepFixed = 0;
  const bursts: PreparedBurst[] = [];
  const spawn = layer.spawn;
  if (spawn.mode === 'rate') {
    // spawnPerStepFixed = round(particlesPerSecond * dt * 65536), two multiplies left to right.
    spawnPerStepFixed = roundHalfAwayFromZero(spawn.particlesPerSecond * dt * SPAWN_FIXED_ONE);
  } else if (spawn.mode === 'burst') {
    bursts.push({ step: burstStepOf(spawn.atTime, dt), count: spawn.count });
  } else {
    for (const b of spawn.bursts) bursts.push({ step: burstStepOf(b.atTime, dt), count: b.count });
  }

  const frames = prepareFrames(layer.texture, dt);

  const drawInputs: SpawnDrawInputs = {
    shape: layer.shape,
    lifetime: layer.lifetime,
    emissionAngle: layer.emissionAngle,
    startSpeed: layer.startSpeed,
    startRotation: layer.startRotation,
    angularVelocity: layer.angularVelocity,
    startScale: layer.startScale,
    texture: layer.texture,
  };

  return {
    layer,
    dt,
    spawnPerStepFixed,
    bursts,
    emitUntilStep: Number.POSITIVE_INFINITY,
    scaleOverLife: prepareLifeCurveNumber(layer.scaleOverLife),
    alphaOverLife: prepareLifeCurveNumber(layer.alphaOverLife),
    colorOverLife: prepareLifeCurveRgb(layer.colorOverLife),
    framesPerStepFixed: frames.fixed,
    frameCount: frames.count,
    drawInputs,
    accelX: layer.gravity.x + layer.acceleration.x,
    accelY: layer.gravity.y + layer.acceleration.y,
    drag: layer.drag,
  };
}

// Create a live emitter instance. `emitUntilStep` comes from the owning effect's duration (section 8.4:
// ceil(duration / dt), or +Inf for an endless effect); the instance overrides the prepared placeholder.
// `instanceSeed` is the per-layer stream seed (hash32(triggerSeed, layerIndex), section 8.3).
export function makeEmitterInstance(
  prepared: PreparedEmitter,
  instanceSeed: number,
  emitUntilStep: number,
): EmitterInstance {
  const capacity = prepared.layer.maxParticles;
  const effective: PreparedEmitter = { ...prepared, emitUntilStep };
  return {
    prepared: effective,
    pool: makeParticlePool(capacity),
    poolState: makeParticlePoolState(capacity),
    prng: makePrng(instanceSeed),
    scratch: makeSpawnScratch(),
    trails: makeTrailRings(capacity, prepared.layer.particleTrail),
    stepIndex: 0,
    spawnAccFixed: 0,
    nextSpawnOrder: 0,
    suppressSpawn: false,
  };
}

// Spawn one particle: consume the per-particle draws in the normative order, quantize lifetime to
// integer lifeSteps, and write the initial state into the pool slot. The slot is already acquired by the
// caller. Allocation-free (writes into the reusable scratch then into the SoA lanes). Returns nothing.
function spawnInto(instance: EmitterInstance, slot: number): void {
  const { prepared, pool, prng, scratch } = instance;
  drawParticleInitialState(prng, prepared.drawInputs, scratch);
  pool.px[slot] = scratch.px;
  pool.py[slot] = scratch.py;
  pool.vx[slot] = scratch.vx;
  pool.vy[slot] = scratch.vy;
  pool.rot[slot] = scratch.rot;
  pool.angVel[slot] = scratch.angVel;
  pool.baseScale[slot] = scratch.baseScale;
  pool.startFrame[slot] = scratch.startFrameOffset;
  // Newborn sentinel: ageSteps starts at -1 so the integration loop's `age = ageSteps + 1` makes a
  // particle spawned this step reach logical age 0 on its spawn step (NOT 1). With this, a particle with
  // lifeSteps=k is alive at ages 0..k-1 (exactly k steps) and recycled when age reaches k (section 8.4
  // acceptance: alive for exactly k steps). The spawn step still runs spawn-before-integrate per 8.4.
  pool.ageSteps[slot] = -1;
  // lifeSteps = max(1, ceil(lifeSeconds / dt)) (section 8.4): one divide then ceil; recycle is the
  // integer event ageSteps >= lifeSteps, never a float compare.
  pool.lifeSteps[slot] = Math.max(1, Math.ceil(scratch.lifeSeconds / prepared.dt));
  // The spawn-step frame index reflects logical age 0 (the loop offset for loop mode, else 0).
  pool.frame[slot] = computeFrame(prepared, pool, slot, 0);
  pool.spawnOrder[slot] = instance.nextSpawnOrder;
  instance.nextSpawnOrder += 1;
  // Reset the trail ring for this slot (the previous tenant's path must not leak in).
  if (instance.trails !== null) instance.trails[slot]!.count = 0;
}

// Try to spawn `n` particles this step (section 8.4 batch spawn ordering). A spawn into a full pool is
// SKIPPED and consumes ZERO PRNG draws, but the schedule has already advanced (the caller drew `n`).
function spawnBatch(instance: EmitterInstance, n: number): void {
  for (let i = 0; i < n; i += 1) {
    const slot = acquireSlot(instance.pool, instance.poolState);
    if (slot < 0) return; // pool full: skip the rest of the batch, zero draws (cap semantics)
    spawnInto(instance, slot);
  }
}

// Compute the animated frame index for slot `s` at the given integer `age` (section 8.4), integer so the
// frame is EXACT-portable. Static textures (frameCount 0) always return 0. `age` is passed explicitly so
// the spawn-step frame (logical age 0) is well-defined while the SoA ageSteps lane sits at the newborn
// sentinel (-1) until the step loop ages it.
function computeFrame(
  prepared: PreparedEmitter,
  pool: ParticlePool,
  s: number,
  age: number,
): number {
  const texture = prepared.layer.texture;
  if (texture.kind !== 'animated') return 0;
  const n = prepared.frameCount;
  const life = pool.lifeSteps[s]!;
  if (texture.mode === 'loop') {
    const start = pool.startFrame[s]!;
    // frame = (startOffset + ((ageSteps * framesPerStepFixed) >> 16)) mod N.
    const advanced = Math.floor((age * prepared.framesPerStepFixed) / SPAWN_FIXED_ONE);
    const idx = (start + advanced) % n;
    return idx < 0 ? idx + n : idx;
  }
  // overLife and once: frame = min(N - 1, (ageSteps * N) / lifeSteps), integer division.
  const idx = Math.floor((age * n) / life);
  return idx < n - 1 ? idx : n - 1;
}

// Advance the spawn schedule by one step and spawn the scheduled particles (section 8.4). The integer
// accumulator (rate) and integer burst steps mean the count sequence is identical on every runtime.
function spawnForStep(instance: EmitterInstance): void {
  // A soft stop suppresses ALL new spawns (rate and burst) while live particles finish (section 8.7).
  if (instance.suppressSpawn) return;
  const { prepared } = instance;
  // rate: integer fixed-point accumulator, only while emission is active.
  if (prepared.spawnPerStepFixed > 0 && instance.stepIndex <= prepared.emitUntilStep) {
    instance.spawnAccFixed += prepared.spawnPerStepFixed;
    const n = instance.spawnAccFixed >> 16;
    instance.spawnAccFixed -= n << 16;
    if (n > 0) spawnBatch(instance, n);
  }
  // bursts: fire on integer-equal step (each entry independently).
  for (const burst of prepared.bursts) {
    if (instance.stepIndex === burst.step && burst.count > 0) spawnBatch(instance, burst.count);
  }
}

// Advance one fixed-dt simulation step (section 8.4): increment the clock, spawn, then integrate every
// live particle with semi-implicit (symplectic) Euler in the EXACT operation order, recycling on the
// integer recycle event and writing the derived render outputs. Allocation-free.
export function stepEmitterOnce(instance: EmitterInstance): void {
  const { prepared, pool, poolState } = instance;
  const dt = prepared.dt;
  instance.stepIndex += 1;
  spawnForStep(instance); // BEFORE integrating (section 8.4 stepOnce order)

  const capacity = pool.capacity;
  const accelX = prepared.accelX;
  const accelY = prepared.accelY;
  const drag = prepared.drag;
  const trailSpec = prepared.layer.particleTrail;
  const trails = instance.trails;
  const spacingSq = trailSpec !== null ? trailSpec.segmentSpacing * trailSpec.segmentSpacing : 0;

  for (let s = 0; s < capacity; s += 1) {
    if (pool.alive[s] === 0) continue;
    const age = pool.ageSteps[s]! + 1;
    pool.ageSteps[s] = age;
    if (age >= pool.lifeSteps[s]!) {
      releaseSlot(pool, poolState, s);
      continue;
    }
    // Semi-implicit Euler, fixed operation order (section 8.4): gravity+accel, drag, position, rotation.
    let vx = pool.vx[s]!;
    let vy = pool.vy[s]!;
    vx += accelX * dt;
    vy += accelY * dt;
    vx -= vx * drag * dt;
    vy -= vy * drag * dt;
    pool.vx[s] = vx;
    pool.vy[s] = vy;
    const px = pool.px[s]! + vx * dt;
    const py = pool.py[s]! + vy * dt;
    pool.px[s] = px;
    pool.py[s] = py;
    pool.rot[s] = pool.rot[s]! + pool.angVel[s]! * dt;

    // Over-life outputs at u = ageSteps / lifeSteps (integer / integer -> float in [0, 1)).
    const u = age / pool.lifeSteps[s]!;
    pool.outScale[s] = pool.baseScale[s]! * evalLifeCurveNumber(prepared.scaleOverLife, u);
    evalLifeCurveRgbInto(prepared.colorOverLife, u, pool.outR, pool.outG, pool.outB, s);
    pool.outAlpha[s] = evalLifeCurveNumber(prepared.alphaOverLife, u);
    pool.frame[s] = computeFrame(prepared, pool, s, age);

    // Per-particle trail: record on the segmentSpacing threshold (section 8.4: at most one point per
    // step; the per-particle position path is sampled once per stepOnce here).
    if (trails !== null && trailSpec !== null) {
      const ring = trails[s]!;
      if (ring.count === 0) {
        pushTrailPoint(ring, px, py);
      } else {
        // Distance from the last recorded point (head - 1 in the ring).
        const last = (ring.head - 1 + ring.maxSegments) % ring.maxSegments;
        const dx = px - ring.px[last]!;
        const dy = py - ring.py[last]!;
        if (dx * dx + dy * dy >= spacingSq) pushTrailPoint(ring, px, py);
      }
    }
  }
}

// Whether the instance has finished: emission ended (stepIndex past emitUntilStep and all bursts fired)
// AND no live particles remain. A pure read; the EffectSystem uses it to reclaim non-looping instances.
export function isEmitterDone(instance: EmitterInstance): boolean {
  if (instance.poolState.liveCount > 0) return false;
  // A soft-stopped emitter with no live particles is done (no further spawns will occur).
  if (instance.suppressSpawn) return true;
  const { prepared, stepIndex } = instance;
  if (stepIndex < prepared.emitUntilStep) return false;
  for (const burst of prepared.bursts) {
    if (stepIndex < burst.step) return false;
  }
  return true;
}

// Angle convention (documented so a native runtime matches): emission angle 0 deg = +x, ccw positive,
// vx = speed*cos, vy = speed*sin (set in drawParticleInitialState). DEG_TO_RAD is re-exported for the
// sprite-animator solve, which shares the degrees-to-radians factor.
export { DEG_TO_RAD };
