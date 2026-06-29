// The single source of the conformance epsilon / tolerance policy (conformance-and-ci.md A.5,
// WP-V.3). There is no per-runtime tolerance and no other epsilon in the suite; the web harness, the
// compare engine, and the analytic oracle all consume these numbers. Loosening any value to make a
// failing runtime pass is forbidden (A.5); the fix is to fix the runtime.
//
// Why tight-but-nonzero, not bit-exact (A.5, the load-bearing decision of the suite): IEEE-754 f64 is
// not associative; V8, .NET, and GDScript/C++ reorder floating ops differently, may contract a*b+c
// into a fused multiply-add on some targets and not others, and ship different sin/cos/atan2/acos/sqrt
// whose last 1 to 3 ULPs disagree. Even rig-2bone bakes cos/sin of a rotation into the world basis.
// Demanding bit-identity would force a shared software-float library in every runtime for zero product
// value. So parity is asserted with a tolerance set WELL BELOW real-bug magnitude (degrees-vs-radians,
// row-major-vs-column-major, wrong bend direction, missing weight normalization, wrong solve order all
// produce errors of 1e-2 or larger) and WELL ABOVE f64 reordering noise (~1e-15). The band is wide and
// unambiguous, which is exactly why a tight-but-nonzero epsilon works.

export interface Tolerance {
  readonly atol: number;
  readonly rtol: number;
}

// World translation tx, ty (rig units, can be ~1e3): sub-thousandth-pixel; the relative term dominates
// at large coordinates. Skinned/deformed vertex x, y share this class (added with the Phase 2 rigs).
export const WORLD_TRANSLATION: Tolerance = { atol: 1e-4, rtol: 1e-6 };

// World basis a, b, c, d (rotation/scale/shear, near-1 magnitudes): tight absolute term. The IK
// conditioning bound (A.5) justifies 1e-6 here once IK lands; for rig-2bone the basis is a plain
// cos/sin of a rotation, whose cross-runtime noise stays orders of magnitude under 1e-6.
export const WORLD_BASIS: Tolerance = { atol: 1e-6, rtol: 1e-6 };

// Skinned and deformed vertex world positions (Phase 2, plan section 11): coordinates can be hundreds of
// pixels, so the absolute term covers values near zero and the relative term covers large magnitudes.
// The relative term is the plan's pinned 1e-5 (looser than WORLD_TRANSLATION's 1e-6) because a skinned
// position is a weighted SUM of bone-transformed points, so its reordering noise accumulates more than a
// single world translation's; still far below the 1e-2 magnitude of a real skinning/weight/deform bug.
export const VERTEX: Tolerance = { atol: 1e-4, rtol: 1e-5 };

// Slot color r, g, b, a (bounded 0..1): no relative term needed. Locked by the first slotted Phase 2
// rig; carried here so the one tolerance source is complete.
export const COLOR: Tolerance = { atol: 1e-5, rtol: 0 };

// Event floatValue (authored values, low noise). Carried here for completeness; events land in Phase 2.
export const EVENT_FLOAT: Tolerance = { atol: 1e-5, rtol: 1e-6 };

// A pair (actual, expected) matches iff |actual - expected| <= atol + rtol * max(|actual|, |expected|)
// (A.5). The combined absolute + relative band: the absolute term dominates near zero, the relative
// term dominates at large coordinates. This is NOT a blanket epsilon, and the symmetric max() makes
// the relation independent of which value is named "actual".
export function withinTolerance(actual: number, expected: number, tol: Tolerance): boolean {
  const diff = Math.abs(actual - expected);
  return diff <= tol.atol + tol.rtol * Math.max(Math.abs(actual), Math.abs(expected));
}
