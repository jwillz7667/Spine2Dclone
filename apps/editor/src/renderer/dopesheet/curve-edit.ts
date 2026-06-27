import type { CurveType } from '@marionette/format/types';
import {
  SetCurveCommand,
  type AnimationId,
  type History,
  type KeyframeId,
  type KeyframeTarget,
} from '../document';

// The curve-editor authoring logic (WP-1.7, TASK-1.7.1 / 1.7.2 / 1.7.4). Pure transforms (clamp, handle
// mapping, presets) plus the thin History wiring for SetCurve (LAW 2). The panel maps pointer pixels to
// normalized coordinates and calls these; it never mutates the document directly. No React, no DOM.

export type BezierCurve = Extract<CurveType, { type: 'bezier' }>;
export type BezierHandle = 'p1' | 'p2';

// Converting linear/stepped to bezier starts from the IDENTITY easing: control points on the line y = x,
// so eased y(nx) == nx and the motion is unchanged until the artist drags a handle. (Controls at 1/3 and
// 2/3 sit on the diagonal, so X(s) == Y(s) for all s.)
export const IDENTITY_BEZIER: BezierCurve = {
  type: 'bezier',
  cx1: 1 / 3,
  cy1: 1 / 3,
  cx2: 2 / 3,
  cy2: 2 / 3,
};

export interface CurvePreset {
  readonly id: string;
  readonly label: string;
  readonly curve: CurveType;
}

// One-click easing presets (TASK-1.7.4): the standard CSS timing-function control points. Every x is
// already within [0, 1], so applying a preset needs no clamp.
export const CURVE_PRESETS: readonly CurvePreset[] = [
  { id: 'linear', label: 'Linear', curve: 'linear' },
  { id: 'ease-in', label: 'Ease In', curve: { type: 'bezier', cx1: 0.42, cy1: 0, cx2: 1, cy2: 1 } },
  {
    id: 'ease-out',
    label: 'Ease Out',
    curve: { type: 'bezier', cx1: 0, cy1: 0, cx2: 0.58, cy2: 1 },
  },
  {
    id: 'ease-in-out',
    label: 'Ease In Out',
    curve: { type: 'bezier', cx1: 0.42, cy1: 0, cx2: 0.58, cy2: 1 },
  },
];

// Clamp a bezier control point's x to [0, 1] at author time (TASK-1.7.2). This is the author-time half of
// the two distinct enforcement points: the command clamps so an artist cannot drag x out of range, and
// the format validator independently rejects a hand-edited document whose cx1/cx2 leave [0, 1] with
// CURVE_BEZIER_X_RANGE on import. y is never clamped, so overshoot/anticipation stays expressible.
export function clampControlX(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// Move one handle of a bezier curve to (nx, ny), returning a new curve with x clamped to [0, 1] and y
// left as given. The untouched handle keeps its current value, so a single-handle drag never disturbs the
// other control point.
export function withHandle(
  curve: BezierCurve,
  handle: BezierHandle,
  nx: number,
  ny: number,
): BezierCurve {
  const x = clampControlX(nx);
  if (handle === 'p1') {
    return { type: 'bezier', cx1: x, cy1: ny, cx2: curve.cx2, cy2: curve.cy2 };
  }
  return { type: 'bezier', cx1: curve.cx1, cy1: curve.cy1, cx2: x, cy2: ny };
}

// Apply a DISCRETE curve change (a type switch or a preset) as exactly ONE undo step. Wrapping the single
// SetCurve in a one-command interaction session makes it a deterministic undo boundary regardless of click
// cadence: endInteraction pushes one entry and sets the session sentinel, so a later same-target SetCurve
// cannot window-merge into it (history Section 5.2, sessions are primary and the time window is only a
// fallback). The bezier-handle DRAG uses its own multi-command session (one undo step, coalesced) and is
// driven directly by the panel via beginInteraction/execute/endInteraction.
export function setKeyframeCurve(
  history: History,
  animationId: AnimationId,
  target: KeyframeTarget,
  keyframeId: KeyframeId,
  curve: CurveType,
): void {
  history.beginInteraction();
  try {
    history.execute(new SetCurveCommand(animationId, target, keyframeId, curve));
  } finally {
    history.endInteraction('Set Curve');
  }
}
