import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import { computeGrid } from './grid-lines';

const MINOR_COLOR = 0xffffff;
const MINOR_ALPHA = 0.05;
const MAJOR_ALPHA = 0.12;
const AXIS_X_COLOR = 0xd05a5a; // the horizontal world axis (y = 0), red by convention
const AXIS_Y_COLOR = 0x5ab06a; // the vertical world axis (x = 0), green by convention
const AXIS_ALPHA = 0.55;

// The viewport reference grid: an adaptive minor/major grid plus the world axes, drawn in WORLD
// space BEHIND the content layer so the art always reads above it. Editor chrome only; it never
// appears in exports or playback. One pooled Graphics, redrawn event-driven when the camera or the
// viewport size changes (never per frame), with stroke widths counter-scaled by zoom so lines stay
// hairline-constant on screen at any zoom (mirroring the gizmo/overlays convention).
export class GridOverlay {
  readonly container: Container;
  private readonly graphics: Graphics;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    // The grid is pure chrome: it must never intercept pointer input meant for tools.
    this.container.eventMode = 'none';
  }

  refresh(camera: Camera, screenWidth: number, screenHeight: number): void {
    const g = this.graphics;
    g.clear();
    if (screenWidth <= 0 || screenHeight <= 0 || camera.zoom <= 0) return;

    const grid = computeGrid(camera, screenWidth, screenHeight);
    // World-space extents of the visible screen, so lines span exactly the viewport.
    const minX = (0 - camera.x) / camera.zoom;
    const maxX = (screenWidth - camera.x) / camera.zoom;
    const minY = (0 - camera.y) / camera.zoom;
    const maxY = (screenHeight - camera.y) / camera.zoom;
    const hairline = 1 / camera.zoom;

    for (const pass of [false, true] as const) {
      for (const line of grid.verticals) {
        if (line.major !== pass) continue;
        g.moveTo(line.at, minY).lineTo(line.at, maxY);
      }
      for (const line of grid.horizontals) {
        if (line.major !== pass) continue;
        g.moveTo(minX, line.at).lineTo(maxX, line.at);
      }
      g.stroke({ width: hairline, color: MINOR_COLOR, alpha: pass ? MAJOR_ALPHA : MINOR_ALPHA });
    }

    if (grid.showAxisX) {
      g.moveTo(minX, 0).lineTo(maxX, 0);
      g.stroke({ width: 1.5 * hairline, color: AXIS_X_COLOR, alpha: AXIS_ALPHA });
    }
    if (grid.showAxisY) {
      g.moveTo(0, minY).lineTo(0, maxY);
      g.stroke({ width: 1.5 * hairline, color: AXIS_Y_COLOR, alpha: AXIS_ALPHA });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
