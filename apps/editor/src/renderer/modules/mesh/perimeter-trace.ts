import type { MeshAutoFill } from '@marionette/document-core';
import { traceAlphaSilhouette, type AlphaMask } from './marching-squares';
import { simplifyClosed } from './douglas-peucker';
import { gridFill } from './grid-fill';
import { flattenPoints, type Point } from './point';

// AUTO PERIMETER-TRACE geometry (TASK-2.1.6): compose marching-squares (silhouette hull) + Douglas-Peucker
// (simplify the hull to its corners) + grid-fill (interior vertices + triangulation) into the MeshAutoFill
// the AutoPerimeterTraceMesh command consumes. Pure and deterministic end to end: a fully transparent mask
// throws MeshError('emptyMask') from the trace; a hull that simplifies below 3 points throws
// MeshError('degenerate') from triangulate. The caller (the mesh tool) supplies the alpha mask of the
// trimmed region plus the pixel -> UV / pixel -> bone-local mappings (the region's size and placement live
// editor-side; this module stays a pure geometry function of its inputs).

// How the trace turns a PIXEL coordinate (marching-squares output, image space, y-down) into the two
// spaces the mesh needs: a UV in [0,1] over the region texture, and a vertex position in bone-local space
// (the same space region attachments place into). Both are simple linear maps the editor builds from the
// region's width/height and placement; passed in as functions so this module never imports placement math.
export interface PixelMapping {
  readonly toUv: (p: Point) => Point; // pixel-center -> texture UV in [0,1]
  readonly toLocal: (p: Point) => Point; // pixel-center -> bone-local position
}

export interface PerimeterTraceOptions {
  readonly threshold: number; // alpha cutoff 0..255 for "opaque"
  readonly simplifyTolerance: number; // Douglas-Peucker tolerance in PIXELS
  readonly cellSize: number; // interior grid spacing in PIXELS (grid-fill runs in pixel space)
}

// Trace, simplify, grid-fill, and triangulate a sprite's alpha silhouette into a MeshAutoFill. The hull is
// the simplified silhouette; the interior is the clipped grid; UVs and vertices are the mapped hull +
// interior points (same index order, hull first). `edges` is the hull perimeter wireframe (consecutive
// hull indices), which the command stores as the editor wireframe.
export function perimeterTrace(
  mask: AlphaMask,
  mapping: PixelMapping,
  options: PerimeterTraceOptions,
): MeshAutoFill {
  // 1. Silhouette contour in pixel space (throws emptyMask on a transparent sprite).
  const contour = traceAlphaSilhouette(mask, options.threshold);
  // 2. Simplify to the real corners. The contour is a closed ring (its first point is not repeated), so
  //    simplifyClosed splits it at its two farthest corners and simplifies each arc; this avoids the
  //    spurious mid-edge corner an open simplify would force-keep at the ring's seam.
  const hullPixels = simplifyClosed(contour, options.simplifyTolerance);
  // 3. Grid-fill the interior and triangulate, all in pixel space (the metric the cell size and tolerance
  //    are expressed in). The result's vertex order is [...hull, ...interior].
  const fill = gridFill(hullPixels, options.cellSize);
  // 4. Map the combined vertices into UV and bone-local space, preserving index order so triangles stay
  //    valid against both the uvs and the vertices stream.
  const uvs: number[] = [];
  const localPoints: Point[] = [];
  for (const v of fill.vertices) {
    const uv = mapping.toUv(v);
    uvs.push(uv.x, uv.y);
    localPoints.push(mapping.toLocal(v));
  }
  return {
    uvs,
    triangles: fill.triangles,
    hullLength: fill.hullLength,
    vertices: flattenPoints(localPoints),
    edges: hullPerimeterEdges(fill.hullLength),
  };
}

// The closed wireframe over the hull vertices: edges (0,1),(1,2),...,(h-1,0) as a flat index pair stream,
// matching the AutoPerimeterTraceMesh `edges` shape (the seed example wired the hull ring as the wireframe).
function hullPerimeterEdges(hullLength: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i < hullLength; i += 1) {
    edges.push(i, (i + 1) % hullLength);
  }
  return edges;
}
