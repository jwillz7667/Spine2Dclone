import { InvalidViewportError, ZeroContentFitError } from './errors';

// A world-space rectangle to frame in the output image.
export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// How the world is framed into the output image: 'content' fits the drawn geometry's world AABB
// (padded, aspect-preserved, letterboxed); an explicit rect frames exactly that world rectangle.
export type FitMode = 'content' | WorldRect;

// The output image size (pixels) and the framing rule.
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly fit: FitMode;
}

// The pinned padding fraction for fit:'content': each side of the content AABB is padded by this fraction
// of the AABB's larger extent, so the framed geometry never touches the image edge. Pinned and tested.
export const CONTENT_PAD_FRACTION = 0.05;

// A degenerate content extent (a single point, or an axis-aligned line) has zero width or height. Framing
// it with a zero-size rect divides by zero, so we floor each extent at this world size. Pinned.
const MIN_CONTENT_EXTENT = 1;

// The affine world -> image mapping: image = world * scale + offset, uniform scale (aspect preserved),
// content centered in the viewport (letterbox). y is NOT flipped: world coordinates are used directly, as
// the runtime-web player applies world matrices straight onto y-down Pixi display objects.
export interface WorldToImage {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function projectX(t: WorldToImage, worldX: number): number {
  return worldX * t.scale + t.offsetX;
}

export function projectY(t: WorldToImage, worldY: number): number {
  return worldY * t.scale + t.offsetY;
}

// Accumulates the world-space axis-aligned bounding box of every drawn vertex. Empty until a point is
// added; `rect()` throws ZeroContentFitError when nothing was drawn (there is no content to frame).
export class WorldBounds {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  add(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }

  get isEmpty(): boolean {
    return this.maxX < this.minX;
  }

  paddedRect(): WorldRect {
    if (this.isEmpty) throw new ZeroContentFitError();
    const rawW = this.maxX - this.minX;
    const rawH = this.maxY - this.minY;
    const pad = CONTENT_PAD_FRACTION * Math.max(rawW, rawH);
    const w = Math.max(rawW + 2 * pad, MIN_CONTENT_EXTENT);
    const h = Math.max(rawH + 2 * pad, MIN_CONTENT_EXTENT);
    // Keep the content centered when a dimension was floored to MIN_CONTENT_EXTENT.
    const cx = (this.minX + this.maxX) / 2;
    const cy = (this.minY + this.maxY) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
}

// Resolve the world -> image transform for the viewport. For fit:'content' the caller passes the
// accumulated world bounds; for an explicit rect the bounds are ignored. Validates the viewport size.
export function resolveWorldToImage(viewport: Viewport, bounds: WorldBounds): WorldToImage {
  if (
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new InvalidViewportError(
      `viewport width/height must be positive integers, received ${viewport.width} x ${viewport.height}`,
    );
  }

  const rect = viewport.fit === 'content' ? bounds.paddedRect() : viewport.fit;
  if (rect.w <= 0 || rect.h <= 0) {
    throw new InvalidViewportError(
      `fit rect must have positive width and height, received ${rect.w} x ${rect.h}`,
    );
  }

  const scale = Math.min(viewport.width / rect.w, viewport.height / rect.h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const offsetX = viewport.width / 2 - cx * scale;
  const offsetY = viewport.height / 2 - cy * scale;
  return { scale, offsetX, offsetY };
}
