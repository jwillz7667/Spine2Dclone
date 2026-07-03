import { Container, Graphics } from 'pixi.js';
import { meshWorldVertices, type MeshEditTarget } from './mesh-edit';

// Editor-only mesh-edit chrome (WP-2.1): the wireframe (every triangle edge), the hull ring, and the
// vertex handles for the mesh the tool is editing. Lives in the overlay layer (never part of the
// exported scene) and draws in WORLD coordinates, since the overlay container is inside the
// camera-transformed world; stroke widths and handle sizes divide by the zoom so chrome stays a
// constant pixel size on screen (the move-rotate gizmo convention, but per-vertex geometry spans the
// world, so the sizes are folded into the draw instead of counter-scaling the container). Refresh is
// event-driven (document revision, slot/vertex selection, tool, zoom), never per idle frame.

const WIRE_COLOR = 0x62c4ff;
const HULL_COLOR = 0xffc247;
const VERTEX_COLOR = 0xffffff;
const VERTEX_SELECTED_COLOR = 0xff5a5a;
const WIRE_WIDTH_PX = 1;
const HULL_WIDTH_PX = 1.5;
const VERTEX_HALF_PX = 3.5;
const VERTEX_SELECTED_HALF_PX = 5;

export class MeshEditOverlay {
  readonly container: Container;
  private readonly graphics: Graphics;
  private zoom = 1;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  // Record the camera zoom used to keep chrome constant-pixel-size. The caller re-refreshes after a
  // zoom change (the overlay does not retain the target; it owns pixels, not state).
  applyZoom(zoom: number): void {
    this.zoom = zoom;
  }

  // Redraw for the current edit target (null clears, e.g. tool inactive or no editable mesh). The
  // selected vertex index is guarded against the current count, so a stale selection after an undo
  // renders as no selection.
  refresh(target: MeshEditTarget | null, selectedVertex: number | null): void {
    const g = this.graphics;
    g.clear();
    if (target === null) return;

    const world = meshWorldVertices(target);
    const { triangles, hullLength } = target.mesh;
    const wireWidth = WIRE_WIDTH_PX / this.zoom;
    const hullWidth = HULL_WIDTH_PX / this.zoom;

    // Wireframe: all three edges of every triangle. Shared edges draw twice, which is visually
    // indistinguishable at 1px and far cheaper than deduping per refresh.
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]! * 2;
      const b = triangles[t + 1]! * 2;
      const c = triangles[t + 2]! * 2;
      g.moveTo(world[a]!, world[a + 1]!)
        .lineTo(world[b]!, world[b + 1]!)
        .lineTo(world[c]!, world[c + 1]!)
        .lineTo(world[a]!, world[a + 1]!);
    }
    g.stroke({ width: wireWidth, color: WIRE_COLOR, alpha: 0.8 });

    // Hull ring: the first hullLength vertices as a closed loop, drawn over the wireframe.
    if (hullLength >= 2) {
      g.moveTo(world[0]!, world[1]!);
      for (let i = 1; i < hullLength; i += 1) {
        g.lineTo(world[i * 2]!, world[i * 2 + 1]!);
      }
      g.lineTo(world[0]!, world[1]!);
      g.stroke({ width: hullWidth, color: HULL_COLOR, alpha: 0.95 });
    }

    // Vertex handles: squares centered on each vertex, the selected one larger and accented.
    const vertexCount = world.length / 2;
    for (let i = 0; i < vertexCount; i += 1) {
      const selected = selectedVertex !== null && selectedVertex === i;
      const half = (selected ? VERTEX_SELECTED_HALF_PX : VERTEX_HALF_PX) / this.zoom;
      g.rect(world[i * 2]! - half, world[i * 2 + 1]! - half, half * 2, half * 2).fill({
        color: selected ? VERTEX_SELECTED_COLOR : VERTEX_COLOR,
        alpha: selected ? 1 : 0.9,
      });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
