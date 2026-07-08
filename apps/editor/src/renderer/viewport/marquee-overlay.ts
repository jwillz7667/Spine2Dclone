import { Container, Graphics } from 'pixi.js';
import type { MarqueeRect } from '../editor-state/marquee-store';

const STROKE_COLOR = 0x5aa0ff;
const FILL_COLOR = 0x5aa0ff;

// The viewport marquee overlay (PP-D1): a translucent selection rectangle drawn in WORLD space on the
// overlay layer while the select tool drags on empty space. Editor chrome only; it never touches the
// document. The rect comes from the ephemeral marquee store in world coordinates, so the world-transformed
// overlay draws it in the right place at any pan/zoom. The border is counter-scaled by zoom so it stays a
// constant pixel width regardless of camera zoom (mirroring the gizmo).
export class MarqueeOverlay {
  readonly container: Container;
  private readonly graphics: Graphics;
  private zoom = 1;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.container.visible = false;
  }

  applyZoom(zoom: number): void {
    this.zoom = zoom;
  }

  // Redraw the rectangle (or hide when there is no active marquee). Called event-driven from the viewport
  // tick when the marquee store changes, never on idle frames.
  refresh(rect: MarqueeRect | null): void {
    const g = this.graphics;
    g.clear();
    if (rect === null) {
      this.container.visible = false;
      return;
    }
    const x = Math.min(rect.x0, rect.x1);
    const y = Math.min(rect.y0, rect.y1);
    const width = Math.abs(rect.x1 - rect.x0);
    const height = Math.abs(rect.y1 - rect.y0);
    g.rect(x, y, width, height)
      .fill({ color: FILL_COLOR, alpha: 0.12 })
      .stroke({ width: 1 / this.zoom, color: STROKE_COLOR, alpha: 0.9 });
    this.container.visible = true;
  }
}
