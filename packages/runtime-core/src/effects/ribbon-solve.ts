import type { RibbonTrailLayer } from '@marionette/format/types';
import {
  evalLifeCurveNumber,
  evalLifeCurveRgbInto,
  prepareLifeCurveNumber,
  prepareLifeCurveRgb,
} from './life-curve';
import type { PreparedLifeCurveNumber, PreparedLifeCurveRgb } from './life-curve';
import { makeTrailRing, pushTrailPoint } from './pool';
import type { TrailRing } from './pool';

// The RibbonTrailLayer SOLVE (phase-3-vfx-particles.md section 8.6, WP-3.3): a triangle-strip ribbon
// following a logical anchor resolved at trigger time. PixiJS-free, deterministic (a pure function of
// the recorded anchor path). The ribbon records anchor positions into a pooled ring buffer (one point
// per frame when the anchor has moved >= segmentSpacing), then builds a strip: at each recorded point,
// two vertices offset perpendicular to the local direction by 0.5 * width, where width/color/alpha come
// from the over-LENGTH curves sampled at k/maxSegments (head = 0, tail = 1). The renderer reads the
// vertex buffer directly; the ring buffer and the vertex buffer are pre-allocated and never grown.

// A ribbon prepared for allocation-free stepping. Over-length curve tables are built once. The point
// ring and the vertex buffers are sized to maxSegments and never reallocated.
export interface PreparedRibbon {
  readonly layer: RibbonTrailLayer;
  readonly widthOverLength: PreparedLifeCurveNumber;
  readonly alphaOverLength: PreparedLifeCurveNumber;
  readonly colorOverLength: PreparedLifeCurveRgb;
  readonly spacingSq: number;
}

// One ribbon instance: the recorded-point ring and the solved strip geometry. Two vertices per recorded
// point (the strip left/right edges). The buffers hold maxSegments points worth of geometry.
export interface RibbonInstance {
  readonly prepared: PreparedRibbon;
  readonly ring: TrailRing;
  // Strip vertices, 2 per point: [leftX, leftY, rightX, rightY] interleaved as x/y pairs. Length =
  // maxSegments * 2 * 2 (two vertices, each x and y). The renderer reads vertexCount * 2 vertices.
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  // Per-vertex render attributes (width is implicit in the offset; expose color/alpha for the renderer).
  readonly vAlpha: Float64Array;
  readonly vR: Float64Array;
  readonly vG: Float64Array;
  readonly vB: Float64Array;
  // The number of strip points currently solved (== ring.count after a buildRibbonStrip call).
  vertexCount: number;
}

export function prepareRibbon(layer: RibbonTrailLayer): PreparedRibbon {
  return {
    layer,
    widthOverLength: prepareLifeCurveNumber(layer.widthOverLength),
    alphaOverLength: prepareLifeCurveNumber(layer.alphaOverLength),
    colorOverLength: prepareLifeCurveRgb(layer.colorOverLength),
    spacingSq: layer.segmentSpacing * layer.segmentSpacing,
  };
}

export function makeRibbonInstance(prepared: PreparedRibbon): RibbonInstance {
  const max = prepared.layer.maxSegments;
  // Two vertices per recorded point.
  const vCount = max * 2;
  return {
    prepared,
    ring: makeTrailRing(max),
    vx: new Float64Array(vCount),
    vy: new Float64Array(vCount),
    vAlpha: new Float64Array(vCount),
    vR: new Float64Array(vCount),
    vG: new Float64Array(vCount),
    vB: new Float64Array(vCount),
    vertexCount: 0,
  };
}

// Record the per-frame anchor position (section 8.4: the anchor is sampled ONCE per frame and held
// across all sub-steps, so the ribbon records at most one point per frame). Push only when the anchor
// has moved >= segmentSpacing from the last recorded point (or when empty). Allocation-free.
export function recordRibbonPoint(instance: RibbonInstance, x: number, y: number): void {
  const ring = instance.ring;
  if (ring.count === 0) {
    pushTrailPoint(ring, x, y);
    return;
  }
  const last = (ring.head - 1 + ring.maxSegments) % ring.maxSegments;
  const dx = x - ring.px[last]!;
  const dy = y - ring.py[last]!;
  if (dx * dx + dy * dy >= instance.prepared.spacingSq) pushTrailPoint(ring, x, y);
}

// Read the k-th recorded point from the head (k = 0 is the most recent point, the head of the trail),
// writing its (x, y) into the passed out object's fields. The ring stores points oldest-to-newest; the
// head is the most recent. Pure index math, allocation-free.
function ringPointFromHead(ring: TrailRing, k: number, out: { x: number; y: number }): void {
  // The most recent point is at (head - 1); k steps back from there.
  const idx = (ring.head - 1 - k + ring.maxSegments * 2) % ring.maxSegments;
  out.x = ring.px[idx]!;
  out.y = ring.py[idx]!;
}

// Scratch points reused across buildRibbonStrip calls so the geometry build allocates nothing.
const scratchA = { x: 0, y: 0 };
const scratchB = { x: 0, y: 0 };

// Build the triangle-strip geometry from the recorded ring (section 8.6). For the k-th point from the
// head, width = eval(widthOverLength, k / maxSegments); the two strip vertices are offset perpendicular
// to the local direction (toward the next point) by 0.5 * width. Color/alpha-over-length sample the
// same k / maxSegments parameter. Writes into the pre-allocated vertex buffers; allocation-free. Sets
// vertexCount = ring.count (the number of strip points). With fewer than two points the strip is empty
// (a single point has no direction), so vertexCount stays the point count but geometry is degenerate.
export function buildRibbonStrip(instance: RibbonInstance): void {
  const { ring, prepared } = instance;
  const count = ring.count;
  instance.vertexCount = count;
  if (count === 0) return;
  const maxSegments = prepared.layer.maxSegments;

  for (let k = 0; k < count; k += 1) {
    ringPointFromHead(ring, k, scratchA);
    // Local direction: toward the next point along the trail (the older neighbor), falling back to the
    // previous neighbor at the tail so every point has a defined tangent.
    let dirX: number;
    let dirY: number;
    if (k + 1 < count) {
      ringPointFromHead(ring, k + 1, scratchB);
      dirX = scratchA.x - scratchB.x;
      dirY = scratchA.y - scratchB.y;
    } else if (k - 1 >= 0) {
      ringPointFromHead(ring, k - 1, scratchB);
      dirX = scratchB.x - scratchA.x;
      dirY = scratchB.y - scratchA.y;
    } else {
      // Single-point ribbon: no direction. Use +x so the perpendicular is well-defined (degenerate).
      dirX = 1;
      dirY = 0;
    }
    const len = Math.hypot(dirX, dirY);
    // Perpendicular (rotate dir by +90 deg): (-dirY, dirX), normalized. Zero-length falls back to +y.
    let nx: number;
    let ny: number;
    if (len > 0) {
      nx = -dirY / len;
      ny = dirX / len;
    } else {
      nx = 0;
      ny = 1;
    }
    const lengthParam = k / maxSegments;
    const halfWidth = 0.5 * evalLifeCurveNumber(prepared.widthOverLength, lengthParam);
    const alpha = evalLifeCurveNumber(prepared.alphaOverLength, lengthParam);

    const left = k * 2;
    const right = left + 1;
    instance.vx[left] = scratchA.x + nx * halfWidth;
    instance.vy[left] = scratchA.y + ny * halfWidth;
    instance.vx[right] = scratchA.x - nx * halfWidth;
    instance.vy[right] = scratchA.y - ny * halfWidth;
    instance.vAlpha[left] = alpha;
    instance.vAlpha[right] = alpha;
    evalLifeCurveRgbInto(
      prepared.colorOverLength,
      lengthParam,
      instance.vR,
      instance.vG,
      instance.vB,
      left,
    );
    evalLifeCurveRgbInto(
      prepared.colorOverLength,
      lengthParam,
      instance.vR,
      instance.vG,
      instance.vB,
      right,
    );
  }
}
