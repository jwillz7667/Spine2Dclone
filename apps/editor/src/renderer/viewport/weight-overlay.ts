import { Container, Graphics } from 'pixi.js';
import type { Mat2x3 } from '@marionette/runtime-core';
import type { BoneId } from '../document';
import { heatColor } from '../modules/mesh/weight-brush';
import {
  activeBoneWeights,
  weightedVertexWorldPositions,
  type WeightPaintTarget,
} from './weight-paint';

// Editor-only weight-paint chrome (WP-2.4): a dim mesh wireframe, a per-vertex heat square colored by the
// active bone's weight (heatColor: blue 0 -> red 1), and the brush circle at the hover position. Mirrors
// MeshEditOverlay: it lives in the overlay layer (never part of the exported scene), draws in WORLD
// coordinates (the container is inside the camera-transformed world), and folds constant-pixel sizes into the
// draw by dividing by the zoom. Refresh is event-driven (document revision, slot/bone selection, brush
// state, tool, zoom), never per idle frame; the panel gates it to the active weights tool.

const WIRE_COLOR = 0x4a4a55;
const BRUSH_COLOR = 0xffffff;
const WIRE_WIDTH_PX = 1;
const BRUSH_WIDTH_PX = 1.5;
const VERTEX_HALF_PX = 4;

// The brush state the overlay draws: where the cursor is (null = no brush) and its pixel radius.
export interface WeightBrushView {
  readonly hoverWorld: readonly [number, number] | null;
  readonly radiusPx: number;
}

export class WeightPaintOverlay {
  readonly container: Container;
  private readonly graphics: Graphics;
  private zoom = 1;

  constructor() {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  // Record the camera zoom used to keep chrome constant-pixel-size; the caller re-refreshes after a zoom
  // change (the overlay owns pixels, not state).
  applyZoom(zoom: number): void {
    this.zoom = zoom;
  }

  // Redraw for the current weighted target (null clears the mesh chrome, e.g. tool inactive or no weighted
  // mesh) plus the brush circle. The active bone may be null (no bone selected): every vertex then colors as
  // weight 0. The brush circle draws whenever a hover position is present, so the cursor shows even before a
  // stroke opens.
  refresh(
    target: WeightPaintTarget | null,
    worldById: ReadonlyMap<BoneId, Mat2x3>,
    activeBoneId: BoneId | null,
    brush: WeightBrushView,
  ): void {
    const g = this.graphics;
    g.clear();

    if (target !== null) {
      const world = weightedVertexWorldPositions(target, worldById);
      const wireWidth = WIRE_WIDTH_PX / this.zoom;

      // Wireframe: all three edges of every triangle (shared edges draw twice, indistinguishable at 1px and
      // cheaper than deduping per refresh), dim so the heat squares read over it.
      for (let t = 0; t < target.triangles.length; t += 3) {
        const a = target.triangles[t]! * 2;
        const b = target.triangles[t + 1]! * 2;
        const c = target.triangles[t + 2]! * 2;
        g.moveTo(world[a]!, world[a + 1]!)
          .lineTo(world[b]!, world[b + 1]!)
          .lineTo(world[c]!, world[c + 1]!)
          .lineTo(world[a]!, world[a + 1]!);
      }
      g.stroke({ width: wireWidth, color: WIRE_COLOR, alpha: 0.8 });

      // Heat squares: one per vertex, colored by the active bone's weight (0 when no active bone), constant
      // pixel size at any zoom.
      const weights = activeBoneId === null ? null : activeBoneWeights(target, activeBoneId);
      const half = VERTEX_HALF_PX / this.zoom;
      for (let i = 0; i < target.vertexCount; i += 1) {
        const color = rgbToHex(heatColor(weights?.get(i) ?? 0));
        g.rect(world[i * 2]! - half, world[i * 2 + 1]! - half, half * 2, half * 2).fill({
          color,
          alpha: 0.95,
        });
      }
    }

    // Brush circle: the hover position at the pixel radius (stroke only). Drawn last so it sits over the mesh.
    if (brush.hoverWorld !== null) {
      const radius = brush.radiusPx / this.zoom;
      g.circle(brush.hoverWorld[0], brush.hoverWorld[1], radius).stroke({
        width: BRUSH_WIDTH_PX / this.zoom,
        color: BRUSH_COLOR,
        alpha: 0.9,
      });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

// Pack a heatColor RGB triple (each channel in [0, 1]) into a 0xRRGGBB integer for a Pixi fill.
function rgbToHex(rgb: { readonly r: number; readonly g: number; readonly b: number }): number {
  const r = Math.round(rgb.r * 255);
  const g = Math.round(rgb.g * 255);
  const b = Math.round(rgb.b * 255);
  return (r << 16) | (g << 8) | b;
}
