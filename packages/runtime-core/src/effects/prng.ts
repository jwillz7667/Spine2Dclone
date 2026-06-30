import type { RangeF } from '@marionette/format/types';

// The normative seeded PRNG for the particle solve (phase-3-vfx-particles.md section 8.3, WP-3.1).
// This is OUR own design (LAW 4): the Mulberry32 generator, specified with explicit unsigned-32-bit
// semantics. Determinism for spawn relies on INTEGER arithmetic, which is bit-reproducible across TS,
// C#, and GDScript (unlike the float solve, which uses the epsilon policy). Every operation is masked
// to 32 bits unsigned. No PixiJS, no DOM, no Date.now or Math.random: the stream is a pure function of
// its seed.
//
// Reimplementation notes for native runtimes (the Phase 5 contract):
//   - In C# use `uint` with `unchecked`; `Math.imul(x, y)` equals
//     `unchecked((int)((uint)x * (uint)y))` reinterpreted as uint.
//   - In GDScript mask every intermediate with `& 0xFFFFFFFF`.
//   - The `>>>` operator is a logical (unsigned) shift; reproduce with unsigned types or masking.

// The mutable generator state: a single uint32 carried in a tiny object so callers can advance it in
// place without per-draw allocation (the hot draw path mutates `state.s`, it never reallocates).
export interface PrngState {
  s: number;
}

// Construct a generator state from a uint32 seed. The seed is masked to 32 bits unsigned so any
// caller-supplied integer (including a hash32 output) is normalized to the stream domain.
export function makePrng(seed: number): PrngState {
  return { s: seed >>> 0 };
}

// Advance the state and return the next uint32. State is a single uint32; all ops are uint32
// (mask & 0xFFFFFFFF via `>>> 0`); `Math.imul` is the 32-bit signed-truncating multiply.
export function nextU32(state: PrngState): number {
  state.s = (state.s + 0x6d2b79f5) >>> 0;
  let t = state.s;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}

// A float in [0, 1): exact, since dividing a uint32 by 2^32 is exact in f64. Never returns 1.0.
export function nextUnit(state: PrngState): number {
  return nextU32(state) / 4294967296;
}

// Per-RangeF draw (section 8.3): a constant range (min === max) consumes ZERO draws, so authored
// constants never shift the stream; a non-constant range consumes exactly one draw. This is the only
// place a RangeF is sampled, so the per-particle draw order (draw-order.ts) is exact across runtimes.
export function drawRange(state: PrngState, r: RangeF): number {
  if (r.min === r.max) return r.min;
  return r.min + nextUnit(state) * (r.max - r.min);
}

// Stream seeding: derive an independent uint32 stream seed from two uint32 inputs. Used to mint a
// per-emitter seed `hash32(triggerSeed, layerIndex)` and a per-bundle-item seed
// `hash32(bundleSeed, itemSeedSalt)` (section 8.3). All ops are uint32.
export function hash32(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// The pinned string-to-uint32 derivation that turns a `SpinResult.spinId` (a string) into the uint32
// trigger seed the integer PRNG and hash32 consume (phase-5 entry gate G5.8, phase-3 section 8.3 seed
// provenance). hash32 takes two NUMBERS, but the slot trigger identity is a STRING spinId, so this
// derivation bridges the two: the per-effect trigger seed is `hash32(spinSeed(spinId), effectInstanceIndex)`
// (phase-4 section 7.3 / phase-3 section 8.3). It MUST live in runtime-core (the oracle, INV-2) and be
// committed as a golden vector (phase-5 TASK-5.5.7), because particle emission parity across web, Unity,
// and Godot rests on every runtime deriving the SAME uint32 from the SAME spinId.
//
// Algorithm: FNV-1a (32-bit) over the UTF-8 bytes of `spinId`. FNV-1a is integer-only (xor + a 32-bit
// multiply per byte), so it is bit-reproducible across TS, C#, and GDScript with no float path. Operating
// on UTF-8 BYTES (not UTF-16 code units) pins the derivation for non-ASCII spinIds too. Called once per
// trigger, never per frame, so the one TextEncoder allocation is off the hot path.
//
// Reimplementation notes for native runtimes (the phase-5 contract):
//   - Encode `spinId` as UTF-8 bytes (C#: `Encoding.UTF8.GetBytes`; GDScript: `spin_id.to_utf8_buffer()`).
//   - Seed `h = 0x811c9dc5`; per byte: `h = (h ^ byte) >>> 0; h = imul(h, 0x01000193) >>> 0`.
//   - C#: use `uint` with `unchecked`; GDScript: mask every intermediate with `& 0xFFFFFFFF`.
//   - The 0x01000193 multiply is the 32-bit FNV prime; `Math.imul` is the 32-bit truncating multiply.
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;
const SPIN_SEED_UTF8 = new TextEncoder();

export function spinSeed(spinId: string): number {
  const bytes = SPIN_SEED_UTF8.encode(spinId);
  let h = FNV1A_OFFSET_BASIS >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    h = (h ^ bytes[i]!) >>> 0;
    h = Math.imul(h, FNV1A_PRIME) >>> 0;
  }
  return h >>> 0;
}
