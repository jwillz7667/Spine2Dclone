// Barrel for the platform-agnostic effects solve primitives (phase-3-vfx-particles.md section 8.3,
// WP-3.1). PixiJS-free, math-bridge-free: the contract-first foundation (seeded PRNG + per-particle
// draw order). The emitter solve, sprite-animator/ribbon solve, and EffectSystem land in later WPs
// (3.2 to 3.4) and extend this surface.
export { makePrng, nextU32, nextUnit, drawRange, hash32 } from './prng';
export type { PrngState } from './prng';
export { makeSpawnState, drawParticleInitialState, spawnDrawCount } from './draw-order';
export type { SpawnDrawInputs, SpawnState } from './draw-order';
