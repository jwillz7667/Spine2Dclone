// The 2D point the editor-side mesh authoring utilities pass around (TASK-2.1.x). A plain { x, y } in the
// slot-bone coordinate space the mesh commands expect (vertices are a flat [x, y, ...] stream there). A
// search of the editor renderer found no shared Point/Vec2 value type to reuse (runtime-core's Mat2x3 is a
// matrix, not a point), so this small local type is the canonical shape for these pure modules. Kept
// dependency-free so triangulate / marching-squares / grid-fill / weight-brush all share one vocabulary.
export interface Point {
  readonly x: number;
  readonly y: number;
}

// Flatten an ordered point list into the [x0, y0, x1, y1, ...] stream the mesh commands consume.
export function flattenPoints(points: readonly Point[]): number[] {
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x, p.y);
  }
  return flat;
}
