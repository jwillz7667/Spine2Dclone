import type { KeyframeId } from '../document';
import { clamp } from './timeline-math';

// Pure keyframe hit-testing and marquee (box) selection for the dopesheet (WP-1.6, TASK-1.6.2 / 1.6.3).
// Operates on already-laid-out diamonds in SCREEN space, so it is independent of scroll/zoom and is the
// unit-tested acceptance surface: box-select must capture exactly the diamonds intersecting the marquee.

export interface LaidOutKey {
  readonly id: KeyframeId;
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

// L1 (Manhattan) distance. Keyframes render as diamonds, and a diamond of half-extent r is exactly the
// set { p : l1(p, center) <= r }, so the diamond metric is the natural hit shape.
function l1(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// The keyframe whose diamond (half-extent `radius`) contains the point and is nearest to it, or null.
// Nearest-wins makes overlapping diamonds resolve deterministically; equal distances keep the earlier
// list entry (the lower-drawn key), which matches what the user clicked on top of.
export function hitTestKey(
  keys: readonly LaidOutKey[],
  px: number,
  py: number,
  radius: number,
): KeyframeId | null {
  let bestId: KeyframeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const dist = l1(px, py, key.x, key.y);
    if (dist <= radius && dist < bestDist) {
      bestDist = dist;
      bestId = key.id;
    }
  }
  return bestId;
}

// Every keyframe whose diamond (half-extent `radius`) intersects the marquee rect. Because L1 distance
// is separable, the minimal L1 distance from a diamond center to an axis-aligned rect is the per-axis
// clamp distance, so the diamond intersects the rect iff that distance is within the radius. This is the
// exact box-select set, no tolerance fudge. The rect corners may arrive in any order (drag direction).
export function marqueeSelect(
  keys: readonly LaidOutKey[],
  rect: Rect,
  radius: number,
): KeyframeId[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const selected: KeyframeId[] = [];
  for (const key of keys) {
    const nearestX = clamp(key.x, minX, maxX);
    const nearestY = clamp(key.y, minY, maxY);
    if (l1(key.x, key.y, nearestX, nearestY) <= radius) selected.push(key.id);
  }
  return selected;
}
