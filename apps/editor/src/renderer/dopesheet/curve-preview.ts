import { buildBezierTable, evalBezierY } from '@marionette/runtime-core';
import type { CurveType } from '@marionette/format/types';

// The curve-editor preview adapter (WP-1.7, TASK-1.7.3, R1.2). It samples the easing curve as the
// animator sees it, normalized x in [0, 1] mapped to the eased y. The bezier branch goes through
// runtime-core's buildBezierTable/evalBezierY, the SINGLE shared sampler (LAW 4), NOT a re-implementation,
// so the preview equals what sampleSkeleton plays for the same control points. No React, no DOM: this is
// the unit-tested pure adapter the panel renders over.

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

// Sample the easing curve at `sampleCount` evenly spaced x in [0, 1] (inclusive of both endpoints).
// linear is the identity line y = x. stepped holds y = 0 across the whole segment (the start value is
// held) and steps to 1 only at the next keyframe (x = 1), which is the visual of a stepped hold. bezier
// evaluates the eased y through the shared runtime-core sampler; y is unclamped so overshoot/anticipation
// (cy outside [0, 1]) shows in the preview exactly as it samples at solve time.
export function sampleCurve(curve: CurveType, sampleCount: number): CurvePoint[] {
  const count = Math.max(2, sampleCount);
  const last = count - 1;
  const points: CurvePoint[] = [];

  if (curve === 'linear') {
    for (let i = 0; i < count; i += 1) {
      const x = i / last;
      points.push({ x, y: x });
    }
    return points;
  }

  if (curve === 'stepped') {
    for (let i = 0; i < count; i += 1) {
      const x = i / last;
      points.push({ x, y: x >= 1 ? 1 : 0 });
    }
    return points;
  }

  // Build the (x, y) table ONCE for the whole preview, then read the eased y per sample. This is the
  // exact buildBezierTable + evalBezierY pair the solve uses (curve.ts), so the curves cannot diverge.
  const table = buildBezierTable(curve.cx1, curve.cy1, curve.cx2, curve.cy2);
  for (let i = 0; i < count; i += 1) {
    const x = i / last;
    points.push({ x, y: evalBezierY(table, 0, x) });
  }
  return points;
}
