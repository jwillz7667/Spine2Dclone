// The pinned integer / fixed-point counter-rollup evaluation (phase-4 section 5.4.2, WP-4.7 TASK-4.7.6).
// The displayed win-counter value is a CORE cross-runtime deliverable, so its evaluation is pinned here
// (not left to each renderer): a Phase 5 Unity/Godot runtime that reproduces the timeline byte-for-byte
// but evaluates the curve differently still fails conformance (WP-V.5). Every operation is integer with a
// single defined rounding mode (floor toward negative infinity) and a defined fixed-point unit FP = 2^16,
// so the displayed integer at any atMs is identical across TS, C#, and Godot. TS uses BigInt for the
// intermediate products (C#/Godot use i64/long) so a large win amount times the fixed-point progress
// cannot overflow.
//
// runtime-core/slot is PixiJS-free, clock-free, and RNG-free (LAW 1 / INV): this function reads only its
// numeric arguments. Precondition: fromUnits <= toUnits (the rollup is non-decreasing, section 5.4.3), so
// every operand below is non-negative and BigInt truncation toward zero equals floor toward negative
// infinity.

// The closed CurveType enum (owned by runtime-core/slot; format stores the chosen string and validates it
// as a closed enum member, phase-4 section 5.4 / format-contract 15.3).
export type CurveType = 'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutCubic';

// The runtime list of CurveType members (single source for a closed-enum validator/iteration).
export const CURVE_TYPES: readonly CurveType[] = [
  'linear',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutCubic',
];

const FP = 65536n; // 2^16 fixed-point one.

// Map a linear fixed-point progress lf in [0, FP] to an eased fixed-point progress eFP in [0, FP]. All
// integer ops; the easeInOutCubic two-branch cubic is the committed reference (phase-4 section 5.4.2).
function ease(curve: CurveType, lf: bigint): bigint {
  switch (curve) {
    case 'linear':
      return lf;
    case 'easeInQuad':
      return (lf * lf) / FP;
    case 'easeOutQuad': {
      const r = FP - lf;
      return FP - (r * r) / FP;
    }
    case 'easeInOutCubic': {
      // t < 0.5: 4 t^3; t >= 0.5: 1 - (-2t + 2)^3 / 2, all in fixed point. The branch boundary is
      // continuous (both yield FP/2 at lf = FP/2), so the comparison 2*lf < FP is unambiguous.
      if (2n * lf < FP) {
        return (4n * lf * lf * lf) / (FP * FP);
      }
      const r = 2n * FP - 2n * lf;
      return FP - (r * r * r) / (2n * FP * FP);
    }
  }
}

// The pinned rollup value at time atMs (phase-4 section 5.4.2). Returns the displayed integer base-unit
// amount. Clamped to [fromUnits, toUnits] by construction.
export function rollupValueAt(
  fromUnits: number,
  toUnits: number,
  startMs: number,
  endMs: number,
  atMs: number,
  curve: CurveType,
): number {
  if (atMs <= startMs) return fromUnits;
  if (atMs >= endMs) return toUnits;
  // Fixed-point linear progress lf = floor(FP * (atMs - startMs) / (endMs - startMs)) in [0, FP].
  const lf = (FP * BigInt(atMs - startMs)) / BigInt(endMs - startMs);
  const eFP = ease(curve, lf);
  // value = fromUnits + floor((toUnits - fromUnits) * eFP / FP). toUnits >= fromUnits, so non-negative.
  const value = BigInt(fromUnits) + ((BigInt(toUnits) - BigInt(fromUnits)) * eFP) / FP;
  return Number(value);
}
