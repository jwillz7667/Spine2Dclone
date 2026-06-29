import { describe, expect, it } from 'vitest';
import { drawRange, hash32, makePrng, nextU32, nextUnit } from '../src/effects/prng';
import golden from './golden/effects-prng-mulberry32.json';

// WP-3.1: the normative seeded PRNG (phase-3-vfx-particles.md section 8.3). The golden vector locks
// the integer stream cross-runtime: the first 64 nextU32 outputs for seed 12345 are committed in
// golden/effects-prng-mulberry32.json (THE anchor Unity/Godot must match exactly). hash32 of a few
// known pairs is locked too, since the per-emitter / per-bundle-item seeds derive from it.
describe('effects PRNG (mulberry32)', () => {
  it('matches the committed golden vector for the first 64 nextU32(seed=12345) outputs', () => {
    const state = makePrng(golden.seed);
    const produced: number[] = [];
    for (let i = 0; i < golden.nextU32_first64.length; i += 1) {
      produced.push(nextU32(state));
    }
    expect(produced).toEqual(golden.nextU32_first64);
  });

  it('every nextU32 output is a uint32 (integer in [0, 2^32))', () => {
    const state = makePrng(1);
    for (let i = 0; i < 1000; i += 1) {
      const v = nextU32(state);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('nextUnit stays in [0, 1) and never equals 1.0 across many draws', () => {
    const state = makePrng(987654321);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 200_000; i += 1) {
      const u = nextUnit(state);
      if (u < min) min = u;
      if (u > max) max = u;
    }
    // One pair of assertions over the observed extremes keeps the probe fast while still proving the
    // [0, 1) bound (never 1.0) holds across the run.
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('matches the committed hash32 values for known pairs', () => {
    expect(hash32(0, 0)).toBe(golden.hash32['0,0']);
    expect(hash32(12345, 0)).toBe(golden.hash32['12345,0']);
    expect(hash32(12345, 1)).toBe(golden.hash32['12345,1']);
  });

  it('produces an identical stream for the same seed (determinism)', () => {
    const a = makePrng(42);
    const b = makePrng(42);
    for (let i = 0; i < 256; i += 1) {
      expect(nextU32(a)).toBe(nextU32(b));
    }
  });

  it('normalizes the seed to uint32 (a negative or oversized seed is masked)', () => {
    // makePrng masks with `>>> 0`, so -1 and 0xFFFFFFFF seed the same stream.
    const a = makePrng(-1);
    const b = makePrng(0xffffffff);
    expect(nextU32(a)).toBe(nextU32(b));
  });

  it('drawRange consumes ZERO draws for a constant range and exactly ONE otherwise', () => {
    // A constant range returns min without touching the stream: the next nextU32 is identical to one
    // drawn from a fresh untouched state. This is the stream-shift guard (section 8.3).
    const probe = makePrng(7);
    const baseline = makePrng(7);
    expect(drawRange(probe, { min: 5, max: 5 })).toBe(5);
    expect(nextU32(probe)).toBe(nextU32(baseline));

    // A non-constant range consumes exactly one draw: after it, the stream is one step ahead.
    const probe2 = makePrng(7);
    const baseline2 = makePrng(7);
    drawRange(probe2, { min: 0, max: 10 });
    nextU32(baseline2); // advance baseline by the one draw drawRange consumed
    expect(nextU32(probe2)).toBe(nextU32(baseline2));
  });

  it('drawRange stays within [min, max) for a non-constant range', () => {
    const state = makePrng(123);
    for (let i = 0; i < 10000; i += 1) {
      const v = drawRange(state, { min: 2, max: 8 });
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(8);
    }
  });
});
