import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/io';
import { withinTolerance, WORLD_BASIS, WORLD_TRANSLATION } from '../src/compare/tolerance';
import type { Affine } from '../src/schema/fixture';

// The INDEPENDENT analytic oracle for the PP-B6 path solve (ADR-0013), mirroring oracle.test.ts. It checks
// the FIRST generation of the committed rig-path-follow and rig-path-spacing fixtures against hand-computed,
// closed-form world transforms, so the fixtures are checked against an independent source rather than merely
// frozen. A mismatch means the generation is WRONG, not merely different.
//
// Both rigs use STRAIGHT segments with evenly spaced Bezier control points, so each curve's arc length is
// LINEAR in the parameter t and a point at arc length s is a closed-form position on the segment (the
// constant-speed LUT collapses to the identity on a linear-arc-length curve). Every expected affine below is
// computed WITHOUT the solver: literal rotation/scale matrices and hand-placed positions.

const SQRT2 = Math.SQRT2;

// A closed-form world affine [a, b, c, d, tx, ty] for a bone at world rotation `angleDeg`, world scale
// (sx, sy), and world position (px, py). Matches compose() with shear 0: the X column is the rotated axis
// scaled by sx, the Y column the perpendicular scaled by sy. Independent of runtime-core (uses raw cos/sin).
function expectedAffine(angleDeg: number, sx: number, sy: number, px: number, py: number): Affine {
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy, px, py];
}

function boneAffine(fixtureId: string, time: number, boneName: string): Affine {
  const fixture = loadFixture(fixtureId);
  const sample = fixture.samples.find((s) => s.time === time);
  if (sample === undefined) throw new Error(`no fixture sample at t=${time} in ${fixtureId}`);
  const affine = sample.bones[boneName];
  if (affine === undefined) throw new Error(`no bone "${boneName}" at t=${time} in ${fixtureId}`);
  return affine;
}

function expectAffine(actual: Affine, expected: Affine, label: string): void {
  for (let lane = 0; lane < 4; lane += 1) {
    expect(
      withinTolerance(actual[lane]!, expected[lane]!, WORLD_BASIS),
      `${label} basis lane ${lane}: got ${actual[lane]}, expected ${expected[lane]}`,
    ).toBe(true);
  }
  for (let lane = 4; lane < 6; lane += 1) {
    expect(
      withinTolerance(actual[lane]!, expected[lane]!, WORLD_TRANSLATION),
      `${label} translation lane ${lane}: got ${actual[lane]}, expected ${expected[lane]}`,
    ).toBe(true);
  }
}

describe('rig-path-follow analytic oracle (ADR-0013, independent of the solver)', () => {
  // The path is the open diagonal (0,0) -> (300,300); a bone at arc-length fraction f is at (300f, 300f)
  // and the tangent angle is 45 degrees everywhere. pc_tangent (percent position, animated 0 -> 1) sweeps
  // t0 across the samples; the fraction at time t is clamp(t, 0, 1).
  for (const time of [0, 0.25, 0.5, 0.75, 1, 1.25]) {
    it(`places pc_tangent's t0 on the diagonal at t=${time}`, () => {
      const f = Math.min(Math.max(time, 0), 1);
      expectAffine(
        boneAffine('rig-path-follow', time, 't0'),
        expectedAffine(45, 1, 1, 300 * f, 300 * f),
        `t0@${time}`,
      );
    });
  }

  it('chain mode: c0 points at c1 (45 degrees) at (0,0), c1 tangents at (150/sqrt2, 150/sqrt2)', () => {
    // pc_chain: fixed position 0, spacing 150 (arc length). c0 at s=0 -> (0,0); c1 at s=150 -> (150/sqrt2,
    // 150/sqrt2). c0 points at c1 (the diagonal, 45 deg); c1 is the last bone and falls back to the tangent.
    const c1x = 150 / SQRT2;
    expectAffine(boneAffine('rig-path-follow', 0, 'c0'), expectedAffine(45, 1, 1, 0, 0), 'c0@0');
    expectAffine(
      boneAffine('rig-path-follow', 0, 'c1'),
      expectedAffine(45, 1, 1, c1x, c1x),
      'c1@0',
    );
  });

  it('chainScale mode: s0 scales X to span the gap (scaleX 2), s1 at (200/sqrt2, 200/sqrt2)', () => {
    // pc_chainscale: fixed position 0, spacing 200. s0 at (0,0) points at s1 (45 deg) with scaleX =
    // distance(s0,s1)/naturalWorldLength = 200/100 = 2. s1 (last) is scaleX 1 at (200/sqrt2, 200/sqrt2).
    const s1x = 200 / SQRT2;
    expectAffine(boneAffine('rig-path-follow', 0, 's0'), expectedAffine(45, 2, 1, 0, 0), 's0@0');
    expectAffine(
      boneAffine('rig-path-follow', 0, 's1'),
      expectedAffine(45, 1, 1, s1x, s1x),
      's1@0',
    );
  });
});

describe('rig-path-spacing analytic oracle (ADR-0013, independent of the solver)', () => {
  // The path is a closed square, side 300, cumulative lengths [300, 600, 900, 1200]. A bone at arc length s
  // is on side 0 (s in [0,300], point (s, 0), tangent 0 deg), side 1 (s in [300,600], point (300, s-300),
  // tangent 90 deg), and so on. Curve selection at exactly s = 300 resolves to side 0's end (t=1), so a bone
  // AT a corner keeps the incoming side's tangent.

  // The world affine of a bone at arc length s (only sides 0 and 1 are reached by these rigs).
  function squarePoint(s: number): Affine {
    if (s <= 300) return expectedAffine(0, 1, 1, s, 0);
    return expectedAffine(90, 1, 1, 300, s - 300);
  }

  it('length mode: bones tile the path at their own lengths (0, 100, 200)', () => {
    for (const time of [0, 0.5, 1]) {
      expectAffine(boneAffine('rig-path-spacing', time, 'l0'), squarePoint(0), `l0@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'l1'), squarePoint(100), `l1@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'l2'), squarePoint(200), `l2@${time}`);
    }
  });

  it('fixed mode: uniform gaps, spacing animated 100 -> 200', () => {
    // spacing at time t is 100 + 100 * clamp(t, 0, 1); bones sit at s = 0, spacing, 2*spacing.
    for (const time of [0, 0.5, 1]) {
      const spacing = 100 + 100 * Math.min(Math.max(time, 0), 1);
      expectAffine(boneAffine('rig-path-spacing', time, 'f0'), squarePoint(0), `f0@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'f1'), squarePoint(spacing), `f1@${time}`);
      expectAffine(
        boneAffine('rig-path-spacing', time, 'f2'),
        squarePoint(2 * spacing),
        `f2@${time}`,
      );
    }
  });

  it('percent mode: gaps are a fraction of total length (0.25 * 1200 = 300)', () => {
    // bones at s = 0, 300, 600 -> corner (0,0), corner (300,0), corner (300,300).
    for (const time of [0, 0.5, 1]) {
      expectAffine(boneAffine('rig-path-spacing', time, 'p0'), squarePoint(0), `p0@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'p1'), squarePoint(300), `p1@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'p2'), squarePoint(600), `p2@${time}`);
    }
  });

  it('proportional mode: natural chain scaled to span the target (gaps 225)', () => {
    // spacing 450 over naturalTotal 200 -> K = 2.25; gaps = 100 * 2.25 = 225. bones at s = 0, 225, 450.
    for (const time of [0, 0.5, 1]) {
      expectAffine(boneAffine('rig-path-spacing', time, 'r0'), squarePoint(0), `r0@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'r1'), squarePoint(225), `r1@${time}`);
      expectAffine(boneAffine('rig-path-spacing', time, 'r2'), squarePoint(450), `r2@${time}`);
    }
  });
});
