import type { WeightDab } from '@marionette/document-core';
import { distanceToSegment } from '@marionette/document-core';
import type { Point } from './point';

// PURE WEIGHT-BRUSH model for the weight-paint tool (WP-2.4, TASK-2.4.x). Given the mesh vertex positions
// (bone-local space, the same coordinates the deformed-but-setup mesh sits in), a circular brush, and the
// active bone, compute the WeightDab[] that PaintWeightStrokeCommand consumes: which vertices the brush
// touches and the per-vertex weight delta after radial falloff. The COMMAND owns the heavy lifting
// (introducing the active bone, redistributing the other influences, capping to 4, normalizing, and the
// sign of `subtract`); this module is the editor-side geometry that decides coverage + falloff and the
// magnitude of the move. It reuses document-core's distanceToSegment for the falloff metric so the editor
// brush and the binding math share one notion of distance. No DOM, no document access, fully deterministic.

// One mesh vertex the brush operates on: its index in the mesh vertex array and its bone-local position.
export interface BrushVertex {
  readonly index: number;
  readonly position: Point;
}

export type BrushMode = 'add' | 'subtract' | 'smooth';

// Radial falloff inside a brush of `radius`: a smooth Hermite (smoothstep) easing from 1 at the center to
// 0 at the rim, so a stroke feathers instead of producing a hard disc. Distance >= radius is 0 (untouched);
// a non-positive radius collapses to "only the exact-center point at full strength". Deterministic.
export function brushFalloff(distance: number, radius: number): number {
  if (radius <= 0) return distance <= 0 ? 1 : 0;
  if (distance >= radius) return 0;
  const t = 1 - distance / radius; // 1 at center, 0 at rim
  return t * t * (3 - 2 * t); // smoothstep
}

// The neighbor-average target a `smooth` dab moves a vertex's active-bone weight toward. The editor passes
// the active bone's current weight per vertex and the mesh adjacency; smooth nudges each covered vertex's
// weight toward the mean of its neighbors' weights. Returned as a map index -> target so brushDab can form
// the signed delta. Kept separate (and optional) so add/subtract need no adjacency.
export function neighborAverageWeights(
  currentWeights: ReadonlyMap<number, number>,
  adjacency: ReadonlyMap<number, readonly number[]>,
): Map<number, number> {
  const targets = new Map<number, number>();
  for (const [index, neighbors] of adjacency) {
    if (neighbors.length === 0) {
      targets.set(index, currentWeights.get(index) ?? 0);
      continue;
    }
    let sum = 0;
    for (const n of neighbors) sum += currentWeights.get(n) ?? 0;
    targets.set(index, sum / neighbors.length);
  }
  return targets;
}

// Options for a single brush dab. `currentWeights` is the active bone's CURRENT weight per vertex index
// (0 where the active bone is not yet an influence); brushDab uses it to clamp add at 1 and subtract at 0
// so a dab never asks for an impossible delta, and (for smooth) to size the move toward `smoothTargets`.
// `smoothTargets` (the neighbor averages from neighborAverageWeights) is required only for mode 'smooth'.
export interface BrushDabOptions {
  readonly vertices: readonly BrushVertex[];
  readonly center: Point;
  readonly radius: number;
  readonly strength: number; // 0..1, the maximum weight delta at the brush center
  readonly mode: BrushMode;
  readonly currentWeights: ReadonlyMap<number, number>;
  readonly smoothTargets?: ReadonlyMap<number, number>;
}

// Compute the WeightDab[] for one brush dab. A vertex is touched when it lies within `radius` of `center`
// (point-to-point distance, measured via distanceToSegment with a degenerate point "segment" so the editor
// and binding share one metric). The magnitude is strength * falloff; vertices outside the radius are
// omitted entirely (no zero dabs), so out-of-radius vertices are left untouched by the command.
//
// Per mode (the deltaWeight is always the MAGNITUDE of the move toward the goal; the command applies the
// sign of `subtract`):
//   - add:     deltaWeight = strength * falloff, clamped so current + delta does not exceed 1.
//   - subtract: deltaWeight = strength * falloff, clamped so it does not drive current below 0
//               (PaintWeightStrokeCommand negates a subtract dab internally).
//   - smooth:  deltaWeight = (neighborTarget - current) * strength * falloff, the signed step toward the
//              neighbor average, which reduces local variance (covered vertices move toward their mean).
export function brushDab(options: BrushDabOptions): WeightDab[] {
  const { vertices, center, radius, strength, mode, currentWeights, smoothTargets } = options;
  const dabs: WeightDab[] = [];
  for (const v of vertices) {
    const distance = distanceToSegment(
      v.position.x,
      v.position.y,
      center.x,
      center.y,
      center.x,
      center.y,
    );
    const falloff = brushFalloff(distance, radius);
    if (falloff <= 0) continue; // outside the brush: untouched
    const current = currentWeights.get(v.index) ?? 0;
    let delta: number;
    if (mode === 'smooth') {
      const target = smoothTargets?.get(v.index) ?? current;
      delta = (target - current) * strength * falloff;
    } else if (mode === 'add') {
      delta = Math.min(strength * falloff, 1 - current); // never past full weight
    } else {
      delta = Math.min(strength * falloff, current); // subtract: never below zero (command negates)
    }
    if (delta === 0) continue; // no-op at this vertex (already saturated): omit
    dabs.push({ vertexIndex: v.index, deltaWeight: delta });
  }
  return dabs;
}

// RGB triple in [0, 1], the per-bone weight heat-map color.
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// Heat-map color for a weight in [0, 1]: COLD (blue) at 0 through cyan/green/yellow to HOT (red) at 1, the
// standard weight-painting ramp. A four-stop blue -> cyan -> green/yellow -> red interpolation; the weight
// is clamped to [0, 1] first so out-of-range inputs saturate at the ends. Pure and deterministic.
export function heatColor(weight: number): Rgb {
  const w = weight < 0 ? 0 : weight > 1 ? 1 : weight;
  // Four segments across [0, 0.25, 0.5, 0.75, 1] mapping to blue, cyan, green, yellow, red.
  if (w < 0.25) return lerp({ r: 0, g: 0, b: 1 }, { r: 0, g: 1, b: 1 }, w / 0.25);
  if (w < 0.5) return lerp({ r: 0, g: 1, b: 1 }, { r: 0, g: 1, b: 0 }, (w - 0.25) / 0.25);
  if (w < 0.75) return lerp({ r: 0, g: 1, b: 0 }, { r: 1, g: 1, b: 0 }, (w - 0.5) / 0.25);
  return lerp({ r: 1, g: 1, b: 0 }, { r: 1, g: 0, b: 0 }, (w - 0.75) / 0.25);
}

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}
