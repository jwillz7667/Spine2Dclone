import { describe, expect, it } from 'vitest';
import { hash32, makePrng, nextU32, spinSeed } from '../src/effects/prng';
import golden from './golden/spin-seed-fnv1a.json';

// Phase-5 entry gate G5.8: spinSeed(spinId) is the pinned string-to-uint32 derivation that bridges a
// string SpinResult.spinId to the uint32 trigger seed the integer PRNG and hash32 consume. hash32 takes
// two NUMBERS; the slot trigger identity is a STRING; spinSeed is the bridge, so the per-effect trigger
// seed is hash32(spinSeed(spinId), effectInstanceIndex). Because particle emission parity across web,
// Unity, and Godot rests on every runtime deriving the SAME uint32 from the SAME spinId, this is locked
// by a committed golden vector (the WP-5.5 cross-language equivalence anchor, TASK-5.5.7).
describe('spinSeed (FNV-1a-32 over UTF-8, phase-5 G5.8)', () => {
  it('matches the canonical published FNV-1a-32 test vectors (algorithm anchor)', () => {
    // FNV-1a-32 of the empty string is the offset basis 0x811c9dc5; of "a" is 0xe40c292c. These are the
    // published reference values, so a runtime that matches them matches the algorithm, not just our table.
    expect(spinSeed('')).toBe(0x811c9dc5);
    expect(spinSeed('a')).toBe(0xe40c292c);
  });

  it('matches the committed golden vector for every spinId', () => {
    for (const [spinId, expected] of Object.entries(golden.spinSeed)) {
      expect(spinSeed(spinId)).toBe(expected);
    }
  });

  it('locks the full spinId -> trigger-seed bridge: hash32(spinSeed(spinId), 0)', () => {
    for (const [spinId, expected] of Object.entries(golden.triggerSeed0)) {
      expect(hash32(spinSeed(spinId), 0)).toBe(expected);
    }
  });

  it('always returns a uint32 (integer in [0, 2^32))', () => {
    for (const spinId of ['', 'a', 'spin-tumble-cascade', 'é✨', 'x'.repeat(512)]) {
      const v = spinSeed(spinId);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('is deterministic (same string yields the same seed)', () => {
    expect(spinSeed('spin-base-win')).toBe(spinSeed('spin-base-win'));
  });

  it('discriminates spinIds that differ only by one byte (no trivial collisions in the corpus)', () => {
    const ids = Object.keys(golden.spinSeed);
    const seeds = new Set(ids.map((id) => spinSeed(id)));
    expect(seeds.size).toBe(ids.length);
  });

  it('produces a usable PRNG stream when fed through makePrng (the trigger-to-stream path)', () => {
    // The downstream contract: spinSeed -> hash32(seed, idx) -> makePrng -> nextU32 stream. This asserts
    // the bridge plugs into the existing integer PRNG without any float or host-RNG step in between.
    const triggerSeed = hash32(spinSeed('spin-base-win'), 0);
    const a = makePrng(triggerSeed);
    const b = makePrng(triggerSeed);
    for (let i = 0; i < 64; i += 1) {
      expect(nextU32(a)).toBe(nextU32(b));
    }
  });
});
