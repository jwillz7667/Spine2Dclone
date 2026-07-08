// Scale-handle geometry (screen px, bone-local frame) and the parent-rotation/scale-invariant scale
// factor math for the gizmo scale handles (PP-D1). Kept out of the PixiJS gizmo and the stateful tool so
// the geometry and the factor math are unit-tested without a renderer or a document. The scale handles
// align to the bone's LOCAL axes (unlike the world-axis-aligned move arrows), which is what makes scale
// intuitive and correct under a rotated or scaled parent: the caller rotates the screen delta into the
// bone-local frame before hit testing, and projects the drag onto the bone's world local-axis directions
// before computing factors.

export type ScaleHandle = 'scale-x' | 'scale-y' | 'scale-uniform';

// Distances/half-extents in SCREEN pixels. The per-axis boxes sit beyond the move arrow tips (AXIS_EXTENT
// is 66) and inside the rotate ring (82); the uniform box sits off-axis in the first quadrant so it never
// overlaps a move axis region.
export const SCALE_AXIS_DIST = 72;
export const SCALE_CORNER = 34;
export const SCALE_HALF = 7;

// Which scale handle a point in the bone-LOCAL frame (screen px, origin at the bone) hits, or null. The
// caller rotates the raw screen delta into the local frame first. Uniform (corner) is tested before the
// per-axis boxes so a near-corner pixel resolves to uniform.
export function scaleHandleAtLocal(lx: number, ly: number): ScaleHandle | null {
  if (within(lx, SCALE_CORNER, SCALE_HALF) && within(ly, SCALE_CORNER, SCALE_HALF)) {
    return 'scale-uniform';
  }
  if (within(lx, SCALE_AXIS_DIST, SCALE_HALF) && within(ly, 0, SCALE_HALF)) return 'scale-x';
  if (within(lx, 0, SCALE_HALF) && within(ly, SCALE_AXIS_DIST, SCALE_HALF)) return 'scale-y';
  return null;
}

function within(value: number, center: number, half: number): boolean {
  return Math.abs(value - center) <= half;
}

// The inputs for one scale-drag frame: the scales at grab, the drag projections onto the bone's world
// local-axis directions (both at grab and now), and the radial distances (for uniform). Projections and
// distances are world-space scalars the caller measures from the bone origin.
export interface ScaleDragInput {
  readonly handle: ScaleHandle;
  readonly startScaleX: number;
  readonly startScaleY: number;
  readonly grabProjX: number;
  readonly grabProjY: number;
  readonly grabDist: number;
  readonly projX: number;
  readonly projY: number;
  readonly dist: number;
}

const EPS = 1e-6;

// The desired local scale for a drag frame. The factor is the current projection over the grab
// projection: the direction is fixed during the drag (changing the bone's own scale never rotates its
// world axis column), so the ratio cancels any parent scale and the direction carries the parent
// rotation. A near-zero grab projection is degenerate (grabbed at the origin along that axis); the factor
// is 1 then, so the drag never divides by zero and simply holds the start scale. A per-axis handle leaves
// the other axis at its start value; uniform scales both by the radial ratio.
export function scaleFromDrag(input: ScaleDragInput): { scaleX: number; scaleY: number } {
  if (input.handle === 'scale-uniform') {
    const factor = ratio(input.dist, input.grabDist);
    return { scaleX: input.startScaleX * factor, scaleY: input.startScaleY * factor };
  }
  if (input.handle === 'scale-x') {
    return {
      scaleX: input.startScaleX * ratio(input.projX, input.grabProjX),
      scaleY: input.startScaleY,
    };
  }
  return {
    scaleX: input.startScaleX,
    scaleY: input.startScaleY * ratio(input.projY, input.grabProjY),
  };
}

function ratio(now: number, grab: number): number {
  return Math.abs(grab) < EPS ? 1 : now / grab;
}
