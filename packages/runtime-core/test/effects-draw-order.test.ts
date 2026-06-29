import type { SpawnDrawInputs } from '../src/effects/draw-order';
import { describe, expect, it } from 'vitest';
import {
  drawParticleInitialState,
  makeSpawnState,
  spawnDrawCount,
} from '../src/effects/draw-order';
import { makePrng, nextU32 } from '../src/effects/prng';

// WP-3.1: the NORMATIVE per-particle draw order (phase-3-vfx-particles.md section 8.3). The order in
// which a particle consumes PRNG draws for its initial state is the cross-runtime contract; these
// tests pin both the count (the draw-count probe) and that the helper advances the stream by exactly
// that count.

// A non-constant RangeF (consumes a draw) and a constant one (consumes none).
const VARY = { min: 0, max: 1 };
const CONST = { min: 0, max: 0 };

function inputs(overrides: Partial<SpawnDrawInputs>): SpawnDrawInputs {
  return {
    shape: { kind: 'point' },
    lifetime: VARY,
    emissionAngle: VARY,
    startSpeed: VARY,
    startRotation: VARY,
    angularVelocity: VARY,
    startScale: VARY,
    texture: { kind: 'static', region: 'r' },
    ...overrides,
  };
}

// Count how many nextU32 draws `drawParticleInitialState` consumes by comparing the stream position
// against a baseline advanced the same number of times.
function consumedDraws(spec: SpawnDrawInputs): number {
  const probe = makePrng(99);
  drawParticleInitialState(probe, spec, makeSpawnState());
  // Find n such that baseline advanced n then one more equals probe's next output.
  const probeNext = nextU32(probe);
  for (let n = 0; n < 32; n += 1) {
    const baseline = makePrng(99);
    for (let i = 0; i < n; i += 1) nextU32(baseline);
    if (nextU32(baseline) === probeNext) return n;
  }
  throw new Error('could not determine consumed draw count within 32 draws');
}

describe('per-particle draw order', () => {
  it('point shape with all-varying ranges consumes 6 draws (no shape draw, no animated frame)', () => {
    const spec = inputs({});
    expect(spawnDrawCount(spec)).toBe(6);
    expect(consumedDraws(spec)).toBe(6);
  });

  it('line shape adds 1 draw', () => {
    const spec = inputs({ shape: { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 } });
    expect(spawnDrawCount(spec)).toBe(7);
    expect(consumedDraws(spec)).toBe(7);
  });

  it('circle edgeOnly adds 1 draw; full circle adds 2', () => {
    const edge = inputs({ shape: { kind: 'circle', radius: 5, edgeOnly: true } });
    expect(spawnDrawCount(edge)).toBe(7);
    expect(consumedDraws(edge)).toBe(7);

    const full = inputs({ shape: { kind: 'circle', radius: 5, edgeOnly: false } });
    expect(spawnDrawCount(full)).toBe(8);
    expect(consumedDraws(full)).toBe(8);
  });

  it('rect shape adds 2 draws', () => {
    const spec = inputs({ shape: { kind: 'rect', width: 4, height: 6 } });
    expect(spawnDrawCount(spec)).toBe(8);
    expect(consumedDraws(spec)).toBe(8);
  });

  it('constant ranges consume zero draws (a fully constant emitter draws nothing for point)', () => {
    const spec = inputs({
      lifetime: CONST,
      emissionAngle: CONST,
      startSpeed: CONST,
      startRotation: CONST,
      angularVelocity: CONST,
      startScale: CONST,
    });
    expect(spawnDrawCount(spec)).toBe(0);
    expect(consumedDraws(spec)).toBe(0);
  });

  it('animated loop texture adds 1 draw for the starting frame offset; overLife/once add none', () => {
    const loop = inputs({
      texture: { kind: 'animated', regions: ['a', 'b', 'c'], fps: 12, mode: 'loop' },
    });
    expect(spawnDrawCount(loop)).toBe(7);
    expect(consumedDraws(loop)).toBe(7);

    const overLife = inputs({
      texture: { kind: 'animated', regions: ['a', 'b', 'c'], fps: 12, mode: 'overLife' },
    });
    expect(spawnDrawCount(overLife)).toBe(6);
    expect(consumedDraws(overLife)).toBe(6);
  });

  it('decomposes velocity from a constant emission angle (0 deg = +x, ccw positive)', () => {
    // emissionAngle = 0 deg, startSpeed = 10 -> vx = 10, vy = 0.
    const spec = inputs({ emissionAngle: CONST, startSpeed: { min: 10, max: 10 } });
    const state = makePrng(1);
    const out = drawParticleInitialState(state, spec, makeSpawnState());
    expect(out.vx).toBeCloseTo(10, 12);
    expect(out.vy).toBeCloseTo(0, 12);

    // emissionAngle = 90 deg -> vx ~ 0, vy = speed (counter-clockwise positive).
    const spec90 = inputs({
      emissionAngle: { min: 90, max: 90 },
      startSpeed: { min: 5, max: 5 },
    });
    const out90 = drawParticleInitialState(makePrng(1), spec90, makeSpawnState());
    expect(out90.vx).toBeCloseTo(0, 12);
    expect(out90.vy).toBeCloseTo(5, 12);
  });

  it('point shape spawns at the origin (no offset, no draws)', () => {
    const out = drawParticleInitialState(makePrng(3), inputs({}), makeSpawnState());
    expect(out.px).toBe(0);
    expect(out.py).toBe(0);
  });

  it('full-circle spawn is area-uniform (radial histogram flat within 3 percent per bin)', () => {
    const radius = 100;
    const spec = inputs({
      shape: { kind: 'circle', radius, edgeOnly: false },
      lifetime: CONST,
      emissionAngle: CONST,
      startSpeed: CONST,
      startRotation: CONST,
      angularVelocity: CONST,
      startScale: CONST,
    });
    const state = makePrng(55);
    const out = makeSpawnState();
    const bins = 10;
    const counts = new Array<number>(bins).fill(0);
    const samples = 200_000;
    for (let i = 0; i < samples; i += 1) {
      drawParticleInitialState(state, spec, out);
      const r = Math.hypot(out.px, out.py);
      // Equal-AREA annuli: bin by r^2 so a uniform disc fills each bin equally.
      const bin = Math.min(bins - 1, Math.floor(((r * r) / (radius * radius)) * bins));
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
    const expected = samples / bins;
    for (const c of counts) {
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.03);
    }
  });

  it('is deterministic: the same seed and inputs reproduce the same initial state', () => {
    const spec = inputs({ shape: { kind: 'rect', width: 4, height: 6 } });
    const a = drawParticleInitialState(makePrng(2024), spec, makeSpawnState());
    const b = drawParticleInitialState(makePrng(2024), spec, makeSpawnState());
    expect(b).toEqual(a);
  });
});
