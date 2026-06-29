import { describe, expect, it } from 'vitest';
import { hash32, makePrng, nextU32 } from '@marionette/runtime-core';
import { buildEffectsFixture } from '../src/build-effects-fixture';
import { compareEffectsFixtures } from '../src/compare/compare-effects';
import { loadEffectsFixture, loadEffectsRig, loadEffectsSampleSpec } from '../src/io';
import { LANDED_EFFECT_IDS } from '../src/registry';

// The runtime-core side of the Phase 3 particle conformance gate (WP-3.10, conformance-and-ci.md B.2).
// It is the effects-track analogue of phase2-rigs.test.ts: for every LANDED effect id it asserts the
// committed fixture validates (Law 3), that regenerating it in memory from runtime-core reproduces it
// within tolerance (integer-EXACT + float-epsilon, the drift tripwire), that the committed sample steps
// equal the sample-spec snapshotSteps (the single source of sampling, A.4), that the integer PRNG stream
// is locked against the WP-3.1 golden vector, and that motion is non-vacuous (particles actually spawn /
// move / a ribbon grows / a sprite rotates between steps). The byte-exact lock is the separate
// toolchain-pinned CI gate (A.6); this tolerance-based check is deliberately Node-agnostic so it is not
// flaky off the pin. The six Phase 2 skeleton rigs are untouched (separate test, separate corpus).

// The first nextU32 draws of the layer-0 stream the golden vector locks, recomputed independently here
// so the test does not merely echo the fixture: hash32(seed, 0) seeds the per-layer stream (section 8.3).
function expectedPrngStreamHead(seed: number, len: number): number[] {
  const state = makePrng(hash32(seed, 0) >>> 0);
  const head: number[] = [];
  for (let i = 0; i < len; i += 1) head.push(nextU32(state));
  return head;
}

describe('Phase 3 effects conformance', () => {
  for (const effectId of LANDED_EFFECT_IDS) {
    describe(effectId, () => {
      it('the committed fixture validates against the effects-fixture schema (Law 3)', () => {
        expect(() => loadEffectsFixture(effectId)).not.toThrow();
      });

      it('regenerating from runtime-core reproduces the committed fixture within tolerance', () => {
        const committed = loadEffectsFixture(effectId);
        const document = loadEffectsRig(effectId);
        const spec = loadEffectsSampleSpec(effectId);

        const regenerated = buildEffectsFixture(document, spec, {
          effectId: committed.effectId,
          rigHash: committed.rigHash,
          specHash: committed.specHash,
          coreVersion: committed.coreVersion,
          toolchain: committed.toolchain,
          generatedBy: committed.generatedBy,
        });

        const report = compareEffectsFixtures(committed, regenerated);
        expect(report.failures).toEqual([]);
        expect(report.ok).toBe(true);
      });

      it('covers exactly the sample-spec snapshotSteps, in order', () => {
        const committed = loadEffectsFixture(effectId);
        const spec = loadEffectsSampleSpec(effectId);
        expect(committed.samples.map((s) => s.step)).toEqual(spec.snapshotSteps);
      });

      it('locks the integer PRNG stream against the WP-3.1 golden vector', () => {
        const committed = loadEffectsFixture(effectId);
        // The committed head must match an independent recomputation (a PRNG change fails this), and it
        // must be non-trivial (more than the seed echoed back).
        const recomputed = expectedPrngStreamHead(committed.seed, committed.prngStreamHead.length);
        expect(committed.prngStreamHead).toEqual(recomputed);
        expect(committed.prngStreamHead.length).toBeGreaterThanOrEqual(1);
      });

      it('every solved float value is finite (no NaN leaves the solve)', () => {
        const committed = loadEffectsFixture(effectId);
        for (const sample of committed.samples) {
          for (const e of sample.emitters) {
            for (const p of e.particles) {
              for (const v of [p.px, p.py, p.rot, p.outScale, p.outR, p.outG, p.outB, p.outAlpha]) {
                expect(Number.isFinite(v)).toBe(true);
              }
            }
          }
          for (const s of sample.sprites) {
            for (const v of [s.rotationDeg, s.scale, s.alpha, s.r, s.g, s.b]) {
              expect(Number.isFinite(v)).toBe(true);
            }
          }
          for (const r of sample.ribbons) {
            for (const v of r.vertices) {
              for (const val of [v.vx, v.vy, v.vAlpha, v.vR, v.vG, v.vB]) {
                expect(Number.isFinite(val)).toBe(true);
              }
            }
          }
        }
      });
    });
  }

  // Non-vacuous-motion checks (WP-3.10 acceptance: particles actually move / spawn between steps). Each
  // landed effect exercises a distinct solve path, so the checks are targeted per effect rather than
  // generic, exactly as phase2-rigs.test.ts adds the FIX-2.* behavioral checks.

  it('effect-coin-burst: 40 particles burst at step 1 and fall under gravity, recycling by end of life', () => {
    const f = loadEffectsFixture('effect-coin-burst');
    const at1 = f.samples.find((s) => s.step === 1);
    const at30 = f.samples.find((s) => s.step === 30);
    const at60 = f.samples.find((s) => s.step === 60);
    expect(at1).toBeDefined();
    expect(at30).toBeDefined();
    expect(at60).toBeDefined();
    // The burst spawns its full count (40) immediately.
    expect(at1!.emitters[0]!.liveCount).toBe(40);
    // Positive gravity pulls particles down (py increases) over time; the mean py at step 30 exceeds
    // that at step 1, proving the integrator advances.
    const meanPy = (sample: typeof at1) =>
      sample!.emitters[0]!.particles.reduce((acc, p) => acc + p.py, 0) /
      sample!.emitters[0]!.particles.length;
    expect(meanPy(at30)).toBeGreaterThan(meanPy(at1));
    // By step 60 (past the shortest lifetimes) some particles have recycled (live count dropped).
    expect(at60!.emitters[0]!.liveCount).toBeLessThan(40);
  });

  it('effect-circle-spawn: rate emission ramps live count up across steps', () => {
    const f = loadEffectsFixture('effect-circle-spawn');
    const at1 = f.samples.find((s) => s.step === 1)!.emitters[0]!.liveCount;
    const at15 = f.samples.find((s) => s.step === 15)!.emitters[0]!.liveCount;
    // A continuous rate emitter spawns over time: more particles are alive at step 15 than at step 1.
    expect(at15).toBeGreaterThan(at1);
    // Every spawned circle position lies within the spawn radius (area-uniform disc, radius 40).
    const at15rows = f.samples.find((s) => s.step === 15)!.emitters[0]!.particles;
    for (const p of at15rows) {
      // The particle has integrated for a few steps, so allow generous slack; the key is it is not far
      // outside the spawn disc + drift (a degenerate shape draw would land hundreds of units away).
      expect(Math.hypot(p.px, p.py)).toBeLessThan(200);
    }
  });

  it('effect-god-rays-sprite: rotation strictly increases and alpha pulses (non-constant)', () => {
    const f = loadEffectsFixture('effect-god-rays-sprite');
    const rots = f.samples.map((s) => s.sprites[0]!.rotationDeg);
    for (let i = 1; i < rots.length; i += 1) {
      expect(rots[i]!).toBeGreaterThan(rots[i - 1]!);
    }
    const alphas = f.samples.map((s) => s.sprites[0]!.alpha);
    const minA = Math.min(...alphas);
    const maxA = Math.max(...alphas);
    expect(maxA).toBeGreaterThan(minA); // the pulse varies alpha over the loop
  });

  it('effect-ribbon-trail: the ribbon grows then caps at maxSegments', () => {
    const f = loadEffectsFixture('effect-ribbon-trail');
    const counts = f.samples.map((s) => s.ribbons[0]!.vertexCount);
    // The ribbon records points as the anchor moves: an early sample has fewer points than a later one.
    expect(counts[0]!).toBeLessThan(counts[counts.length - 1]!);
    // The hard cap (maxSegments = 16) is never exceeded.
    for (const c of counts) expect(c).toBeLessThanOrEqual(16);
    // Two strip vertices per recorded point (section 8.6).
    for (const s of f.samples) {
      expect(s.ribbons[0]!.vertices.length).toBe(s.ribbons[0]!.vertexCount * 2);
    }
  });
});
