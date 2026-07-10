// The pure fit-to-viewport math shared by the two GL previews (PP-D8). Given a content bounding box in
// world/scene pixels and the current canvas size, it returns the uniform scale and translation that centers
// the content in the viewport with a pixel padding. The GL stage writes the result onto its content
// container's transform; keeping the math here (pixi-free) means resize/fit behavior is unit-tested in the
// node env, and both previews (particle bounds, slot grid size) share one code path so they cannot drift.

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface FitTransform {
  // Uniform scale applied to content (screenX = worldX * scale + offsetX).
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

// The largest scale is capped so a tiny piece of content (a single particle, a 1x1 grid) is not blown up to
// fill the panel, which would look broken; content smaller than this renders at 1:1, centered.
const MAX_FIT_SCALE = 4;

// Fit `bounds` into a `viewportWidth` x `viewportHeight` canvas with `padding` px inset on every side. A
// degenerate (zero or negative area, or a non-finite) box, or a non-positive viewport, yields scale 1
// centered on the box center, so the caller never divides by zero or produces NaN.
export function fitBounds(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0,
): FitTransform {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const availWidth = viewportWidth - 2 * padding;
  const availHeight = viewportHeight - 2 * padding;

  const canScale =
    Number.isFinite(contentWidth) &&
    Number.isFinite(contentHeight) &&
    contentWidth > 0 &&
    contentHeight > 0 &&
    availWidth > 0 &&
    availHeight > 0;

  const scale = canScale
    ? Math.min(MAX_FIT_SCALE, availWidth / contentWidth, availHeight / contentHeight)
    : 1;

  return {
    scale,
    offsetX: viewportWidth / 2 - centerX * scale,
    offsetY: viewportHeight / 2 - centerY * scale,
  };
}

// Fit a content box anchored at the origin (0,0)..(width,height): the slot grid's pixel extent. A convenience
// over fitBounds for the common top-left-origin case.
export function fitSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 0,
): FitTransform {
  return fitBounds(
    { minX: 0, minY: 0, maxX: width, maxY: height },
    viewportWidth,
    viewportHeight,
    padding,
  );
}
