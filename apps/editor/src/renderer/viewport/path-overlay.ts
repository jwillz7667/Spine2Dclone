import { Container, Graphics } from 'pixi.js';
import { pathWorldVertices, type PathEditTarget } from './path-edit';
import { flattenPathSpline, pathControlHandles, pathHandleTethers } from './path-overlay-geometry';

// Editor-only path-edit chrome (PP-D11): the sampled spline polyline, the anchor-to-handle tethers, and the
// draggable control-point handles (square anchors, round Bezier handles) for the path the tool is editing.
// Lives in the overlay layer (never part of the exported scene) and draws in WORLD coordinates, since the
// overlay container is inside the camera-transformed world; stroke widths and handle sizes divide by the
// zoom so chrome stays a constant pixel size on screen (the mesh-overlay convention). The geometry math is
// the pure path-overlay-geometry module fed the WORLD control points; this layer never duplicates it. One
// pooled Graphics is cleared and redrawn per refresh, and refresh is event-driven (document revision,
// slot/point selection, tool, zoom), never per idle frame, so the render loop allocates nothing.

const SPLINE_COLOR = 0x62c4ff;
const TETHER_COLOR = 0x8a8a8a;
const ANCHOR_COLOR = 0xffc247;
const HANDLE_COLOR = 0xffffff;
const SELECTED_COLOR = 0xff5a5a;
const SPLINE_WIDTH_PX = 1.5;
const TETHER_WIDTH_PX = 1;
const ANCHOR_HALF_PX = 4;
const HANDLE_RADIUS_PX = 3.5;
const SELECTED_SCALE = 1.4;

export class PathEditOverlay {
  readonly container: Container;
  private readonly graphics: Graphics;
  private zoom = 1;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  // Record the camera zoom used to keep chrome constant-pixel-size. The caller re-refreshes after a zoom
  // change (the overlay does not retain the target; it owns pixels, not state).
  applyZoom(zoom: number): void {
    this.zoom = zoom;
  }

  // Redraw for the current edit target (null clears, e.g. tool inactive or no editable path). The selected
  // control-point index is guarded implicitly against the current count (an index past the last control
  // point never matches a drawn handle), so a stale selection after an undo renders as no selection.
  refresh(target: PathEditTarget | null, selectedPoint: number | null): void {
    const g = this.graphics;
    g.clear();
    if (target === null) return;

    const world = pathWorldVertices(target);
    const closed = target.path.closed;

    // Anchor-to-handle tethers first (thin, behind), so the spline and handles read on top.
    const tethers = pathHandleTethers(world, closed);
    if (tethers.length > 0) {
      for (const tether of tethers) {
        g.moveTo(tether.anchor.x, tether.anchor.y).lineTo(tether.handle.x, tether.handle.y);
      }
      g.stroke({ width: TETHER_WIDTH_PX / this.zoom, color: TETHER_COLOR, alpha: 0.7 });
    }

    // The sampled spline polyline. flattenPathSpline already wraps a closed spline's final sample back onto
    // control point 0, so the stroke closes without an extra segment.
    const spline = flattenPathSpline(world, closed);
    if (spline.length >= 2) {
      g.moveTo(spline[0]!.x, spline[0]!.y);
      for (let i = 1; i < spline.length; i += 1) {
        g.lineTo(spline[i]!.x, spline[i]!.y);
      }
      g.stroke({ width: SPLINE_WIDTH_PX / this.zoom, color: SPLINE_COLOR, alpha: 0.9 });
    }

    // Control-point handles on top: square anchors, round Bezier handles, the selected one larger/accented.
    const handles = pathControlHandles(world);
    for (const handle of handles) {
      const selected = selectedPoint !== null && selectedPoint === handle.index;
      const color = selected
        ? SELECTED_COLOR
        : handle.role === 'anchor'
          ? ANCHOR_COLOR
          : HANDLE_COLOR;
      const grow = selected ? SELECTED_SCALE : 1;
      if (handle.role === 'anchor') {
        const half = (ANCHOR_HALF_PX * grow) / this.zoom;
        g.rect(handle.point.x - half, handle.point.y - half, half * 2, half * 2).fill({
          color,
          alpha: 1,
        });
      } else {
        const radius = (HANDLE_RADIUS_PX * grow) / this.zoom;
        g.circle(handle.point.x, handle.point.y, radius).fill({ color, alpha: 0.95 });
      }
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
