import type { TrailSpec } from '@marionette/format/types';
import { makeSpawnState } from './draw-order';
import type { SpawnState } from './draw-order';

// Solved-state buffers for one active emitter instance (phase-3-vfx-particles.md section 8.2, WP-3.2).
// Structure-of-arrays in pre-allocated typed arrays of length `maxParticles`, allocated ONCE at
// instance creation and never reallocated. The render layer reads these arrays directly. No PixiJS,
// no DOM: this is platform-agnostic solved state.
//
// Determinism + perf contract:
//   - ageSteps/lifeSteps are INTEGER sim-steps, so recycle (ageSteps >= lifeSteps) is an integer-exact
//     event, never a float compare (section 8.4). Integer quantities are bit-portable across runtimes.
//   - The free-list is an index stack (Uint32Array), so spawn/recycle does ZERO allocation after warmup.
//   - Float lanes (px/py/vx/vy/rot/baseScale and the out* render outputs) follow the float epsilon path
//     of the conformance contract (section 8.9).

export interface ParticlePool {
  // Hard pool cap; the buffers are sized to this and never grown (section 8.2 / 8.4 cap semantics).
  readonly capacity: number;
  // 1 = live, 0 = free. The render layer reads this to skip dead slots.
  readonly alive: Uint8Array;
  // Integer sim-steps since spawn; the recycle decision (ageSteps >= lifeSteps) is integer-exact.
  readonly ageSteps: Int32Array;
  // Total lifetime in integer sim-steps = max(1, ceil(lifeSeconds / dt)) (section 8.4).
  readonly lifeSteps: Int32Array;
  // World-local particle position (the anchor transform is applied by the EffectSystem / renderer).
  readonly px: Float64Array;
  readonly py: Float64Array;
  // Velocity, units/sec.
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  // Rotation (degrees) and angular velocity (degrees/sec).
  readonly rot: Float64Array;
  readonly angVel: Float64Array;
  // The startScale draw; outScale multiplies this by scaleOverLife each step.
  readonly baseScale: Float64Array;
  // The per-particle animated starting frame offset (loop mode draw, section 8.3 step 8).
  readonly startFrame: Int32Array;
  // Current animated-frame index (integer, EXACT-portable, section 8.4).
  readonly frame: Int32Array;
  // Monotonic spawn counter, the exact conformance key (section 8.2 / 8.9).
  readonly spawnOrder: Int32Array;
  // Derived render outputs, written each step (section 8.2).
  readonly outScale: Float64Array;
  readonly outAlpha: Float64Array;
  readonly outR: Float64Array;
  readonly outG: Float64Array;
  readonly outB: Float64Array;
  // Index free stack (section 8.2): freeStack[0 .. freeTop-1] holds the currently-free slot indices.
  // freeTop is the count of free slots; liveCount === capacity - freeTop.
  readonly freeStack: Uint32Array;
}

// Mutable counters carried alongside the (readonly-typed) buffers. Kept in a small object so the hot
// path mutates fields in place without reallocating; the typed arrays themselves never change identity.
export interface ParticlePoolState {
  freeTop: number;
  liveCount: number;
}

// Allocate a pool sized to `capacity` (an emitter's maxParticles). All slots start free. This is the
// one allocation point per emitter instance; nothing here runs in the per-step hot path.
export function makeParticlePool(capacity: number): ParticlePool {
  const freeStack = new Uint32Array(capacity);
  // Seed the free stack with every slot index. Spawning pops from the top; recycling pushes back.
  for (let i = 0; i < capacity; i += 1) freeStack[i] = i;
  return {
    capacity,
    alive: new Uint8Array(capacity),
    ageSteps: new Int32Array(capacity),
    lifeSteps: new Int32Array(capacity),
    px: new Float64Array(capacity),
    py: new Float64Array(capacity),
    vx: new Float64Array(capacity),
    vy: new Float64Array(capacity),
    rot: new Float64Array(capacity),
    angVel: new Float64Array(capacity),
    baseScale: new Float64Array(capacity),
    startFrame: new Int32Array(capacity),
    frame: new Int32Array(capacity),
    spawnOrder: new Int32Array(capacity),
    outScale: new Float64Array(capacity),
    outAlpha: new Float64Array(capacity),
    outR: new Float64Array(capacity),
    outG: new Float64Array(capacity),
    outB: new Float64Array(capacity),
    freeStack,
  };
}

export function makeParticlePoolState(capacity: number): ParticlePoolState {
  return { freeTop: capacity, liveCount: 0 };
}

// Reset a pool to empty without reallocating (used when an instance slot is recycled by the system).
export function resetParticlePool(pool: ParticlePool, state: ParticlePoolState): void {
  pool.alive.fill(0);
  for (let i = 0; i < pool.capacity; i += 1) pool.freeStack[i] = i;
  state.freeTop = pool.capacity;
  state.liveCount = 0;
}

// Pop a free slot index, or -1 if the pool is full (section 8.4 cap semantics: a full pool skips the
// spawn). Pure index bookkeeping, allocation-free.
export function acquireSlot(pool: ParticlePool, state: ParticlePoolState): number {
  if (state.freeTop === 0) return -1;
  state.freeTop -= 1;
  const slot = pool.freeStack[state.freeTop]!;
  pool.alive[slot] = 1;
  state.liveCount += 1;
  return slot;
}

// Return a slot to the free stack (recycle at end of life). Allocation-free.
export function releaseSlot(pool: ParticlePool, state: ParticlePoolState, slot: number): void {
  pool.alive[slot] = 0;
  pool.freeStack[state.freeTop] = slot;
  state.freeTop += 1;
  state.liveCount -= 1;
}

// A per-particle trail recorded as a pooled ring buffer of points (section 8.2, 8.4). TrailSpec on an
// emitter requests one of these per live particle; the buffer is sized to maxSegments and never grown.
// The ring records the particle's per-frame position path; the renderer reads it to draw a streak.
export interface TrailRing {
  readonly maxSegments: number;
  readonly px: Float64Array;
  readonly py: Float64Array;
  // Number of valid points currently stored (0 .. maxSegments).
  count: number;
  // Index of the next write position (head); the oldest point sits at (head - count + maxSegments)%len.
  head: number;
}

export function makeTrailRing(maxSegments: number): TrailRing {
  return {
    maxSegments,
    px: new Float64Array(maxSegments),
    py: new Float64Array(maxSegments),
    count: 0,
    head: 0,
  };
}

export function resetTrailRing(ring: TrailRing): void {
  ring.count = 0;
  ring.head = 0;
}

// Push a point into the ring, dropping the oldest beyond maxSegments. Allocation-free.
export function pushTrailPoint(ring: TrailRing, x: number, y: number): void {
  ring.px[ring.head] = x;
  ring.py[ring.head] = y;
  ring.head = (ring.head + 1) % ring.maxSegments;
  if (ring.count < ring.maxSegments) ring.count += 1;
}

// One reusable SpawnState per pool slot (so the spawn draw path allocates nothing). Allocated once at
// warmup; tests can ignore this and pass their own. Bundling it with the spec keeps the emitter solve
// allocation-free across spawns.
export function makeSpawnScratch(): SpawnState {
  return makeSpawnState();
}

// Pooled per-particle trail rings for an emitter that declares a TrailSpec, one ring per slot, allocated
// once. Returns null when the emitter has no trail (the common case), so the solve skips trail work.
export function makeTrailRings(capacity: number, trail: TrailSpec | null): TrailRing[] | null {
  if (trail === null) return null;
  const rings: TrailRing[] = new Array<TrailRing>(capacity);
  for (let i = 0; i < capacity; i += 1) rings[i] = makeTrailRing(trail.maxSegments);
  return rings;
}
