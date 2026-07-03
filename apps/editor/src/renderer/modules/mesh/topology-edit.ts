import { MeshError } from './mesh-error';
import { triangulate } from './triangulate';
import type { Point } from './point';

// Interior-vertex topology edits for an UNWEIGHTED mesh (WP-2.1 TASK-2.1.2, the editor-side geometry the
// AddMeshVertex / DeleteMeshVertex commands consume). Both operations return the FULL replacement
// geometry (uvs, triangles, vertices) because add/delete re-triangulate: the commands capture the prior
// geometry as their undo memento and swap wholesale. MOVE is deliberately absent here: moving a vertex
// never re-triangulates (index stability is what keeps deform offsets and future weights aligned), so
// the move path is MoveMeshVertexCommand alone with no geometry math. The hull-first vertex layout is
// the format invariant (vertices[0 .. hullLength-1] are the hull ring, the rest are interior), which is
// exactly triangulate()'s [...hull, ...interior] index space, so the returned triangle indices line up
// with the returned vertex order by construction.

// The geometry fields a topology edit reads and replaces (the unweighted subset of the mesh entity).
export interface MeshTopology {
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly hullLength: number;
  readonly vertices: readonly number[]; // flat [x, y] pairs in slot-bone space (unweighted)
}

export interface TopologyEditResult {
  readonly uvs: number[];
  readonly triangles: number[];
  readonly vertices: number[];
}

// Barycentric containment tolerance: a point on (or a hair outside) a shared edge still counts as inside
// one of the adjacent triangles, so clicks on wireframe lines resolve instead of falling through.
const EDGE_EPSILON = 1e-9;

// Insert an interior vertex at `point` (slot-bone space). The point must land inside the current mesh
// (some triangle contains it); its uv is the barycentric interpolation of that triangle's uvs, so the
// texture does not shift when the vertex is added. The hull ring is unchanged; the interior set grows by
// one and the whole mesh re-triangulates deterministically.
export function addInteriorVertex(geometry: MeshTopology, point: Point): TopologyEditResult {
  const containing = findContainingTriangle(geometry, point);
  if (containing === null) {
    throw new MeshError(
      'outsideMesh',
      `cannot add a vertex at (${point.x}, ${point.y}): the point is outside every mesh triangle`,
    );
  }

  const [ia, ib, ic] = containing.triangle;
  const { wa, wb, wc } = containing.weights;
  const uvs = geometry.uvs;
  const u = wa * uvs[ia * 2]! + wb * uvs[ib * 2]! + wc * uvs[ic * 2]!;
  const v = wa * uvs[ia * 2 + 1]! + wb * uvs[ib * 2 + 1]! + wc * uvs[ic * 2 + 1]!;

  const vertices = [...geometry.vertices, point.x, point.y];
  return {
    uvs: [...geometry.uvs, u, v],
    triangles: retriangulate(vertices, geometry.hullLength),
    vertices,
  };
}

// Remove the interior vertex at `vertexIndex`. Hull vertices are not deletable (removing one opens the
// polygon; the plan forbids it rather than guessing a repaired outline). Interior removal shrinks the
// vertex and uv arrays in place (indices above shift down by one) and re-triangulates.
export function deleteInteriorVertex(
  geometry: MeshTopology,
  vertexIndex: number,
): TopologyEditResult {
  const vertexCount = geometry.vertices.length / 2;
  if (vertexIndex < 0 || vertexIndex >= vertexCount) {
    throw new MeshError(
      'outsideMesh',
      `cannot delete vertex ${vertexIndex}: the mesh has ${vertexCount} vertices`,
    );
  }
  if (vertexIndex < geometry.hullLength) {
    throw new MeshError(
      'hullVertex',
      `cannot delete hull vertex ${vertexIndex}: removing a hull vertex would open the polygon`,
    );
  }

  const vertices = geometry.vertices.filter((_, lane) => lane >> 1 !== vertexIndex);
  const uvs = geometry.uvs.filter((_, lane) => lane >> 1 !== vertexIndex);
  return {
    uvs,
    triangles: retriangulate(vertices, geometry.hullLength),
    vertices,
  };
}

// Deterministic re-triangulation over the hull-first flat vertex array (the one triangulation seam,
// TASK-2.1.4; the runtime never re-triangulates, it consumes the committed result).
function retriangulate(vertices: readonly number[], hullLength: number): number[] {
  const hull: Point[] = [];
  const interior: Point[] = [];
  for (let i = 0; i < vertices.length / 2; i += 1) {
    const p = { x: vertices[i * 2]!, y: vertices[i * 2 + 1]! };
    if (i < hullLength) hull.push(p);
    else interior.push(p);
  }
  return triangulate(hull, interior);
}

interface ContainingTriangle {
  readonly triangle: readonly [number, number, number];
  readonly weights: { readonly wa: number; readonly wb: number; readonly wc: number };
}

// The first current triangle whose barycentric coordinates contain the point (within EDGE_EPSILON), with
// the weights for uv interpolation, or null when the point is outside the mesh. Degenerate (zero-area)
// triangles cannot contain anything and are skipped.
function findContainingTriangle(geometry: MeshTopology, point: Point): ContainingTriangle | null {
  const { triangles, vertices } = geometry;
  for (let t = 0; t < triangles.length; t += 3) {
    const ia = triangles[t]!;
    const ib = triangles[t + 1]!;
    const ic = triangles[t + 2]!;
    const ax = vertices[ia * 2]!;
    const ay = vertices[ia * 2 + 1]!;
    const bx = vertices[ib * 2]!;
    const by = vertices[ib * 2 + 1]!;
    const cx = vertices[ic * 2]!;
    const cy = vertices[ic * 2 + 1]!;

    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;

    const wa = ((bx - point.x) * (cy - point.y) - (cx - point.x) * (by - point.y)) / area;
    const wb = ((cx - point.x) * (ay - point.y) - (ax - point.x) * (cy - point.y)) / area;
    const wc = 1 - wa - wb;
    if (wa >= -EDGE_EPSILON && wb >= -EDGE_EPSILON && wc >= -EDGE_EPSILON) {
      return { triangle: [ia, ib, ic], weights: { wa, wb, wc } };
    }
  }
  return null;
}
