import { Container, Graphics } from 'pixi.js';
import { getTranslation } from '@marionette/runtime-core';
import type { BoneId, DocumentReadModel } from '@marionette/document-core';
import { useSelectionStore } from '../../editor-state/selection-store';
import { worldToScreen, type Camera } from '../camera';
import { solveWorldById } from '../scene-solve';
import {
  SCALE_AXIS_DIST,
  SCALE_CORNER,
  SCALE_HALF,
  scaleHandleAtLocal,
  type ScaleHandle,
} from './gizmo-scale';

// Which gizmo handle a screen point hits. 'none' means the point is off the gizmo (the caller then
// falls back to a bone pick / deselect). The scale handles align to the bone's local axes, so they are
// classified in the bone-local frame (see hitTest); the move/rotate handles stay world-axis-aligned.
export type GizmoHandle =
  | 'move-x'
  | 'move-y'
  | 'move-free'
  | 'rotate'
  | ScaleHandle
  | 'none';

// Handle geometry in SCREEN pixels: the gizmo container counter-scales the camera zoom so the widget
// stays a constant size, and the hit regions below mirror exactly what drawHandles draws.
const AXIS_LENGTH = 54;
const ARROW = 6;
const AXIS_EXTENT = AXIS_LENGTH + ARROW * 2;
const AXIS_TOLERANCE = 8;
const FREE_HALF = 7;
const RING_RADIUS = 82;
const RING_TOLERANCE = 8;

const X_COLOR = 0xff5a5a;
const Y_COLOR = 0x5ad15a;
const FREE_COLOR = 0xffd166;
const RING_COLOR = 0x5aa0ff;
const SCALE_UNIFORM_COLOR = 0x5ad1d1;

// The move/rotate/scale gizmo (handoff 8.3, 10: gizmo feel is a budgeted risk). It draws axis + free move
// handles and a rotate ring on the OVERLAY layer at the selected bone's solved world origin, at a
// constant screen size, plus per-axis and uniform SCALE handles aligned to the bone's local axes (PP-D1).
// It exposes pixel-tolerance hit testing so the select-move tool can route a drag to the right channel
// (MoveBone vs RotateBone vs ScaleBone). It NEVER mutates the document: it reads the selection store and
// the solved world transform only. The move/rotate widget is world-axis-aligned (the camera never
// rotates), so those hit tests are a simple translate from the bone origin's screen position; the scale
// handles rotate with the bone, so they are drawn in a sub-container rotated by the bone's world rotation
// and hit-tested by rotating the screen delta into that local frame.
export class MoveRotateGizmo {
  readonly container: Container;
  private readonly graphics: Graphics;
  // The scale handles live in their own sub-container rotated to the bone's world rotation, so they track
  // the local axes while the move/rotate handles stay world-aligned in the parent graphics.
  private readonly scaleContainer: Container;
  private readonly scaleGraphics: Graphics;
  // The selected bone's world origin, cached on refresh so hit testing needs no per-event solve.
  private worldOrigin: readonly [number, number] | null = null;
  // The selected bone's world rotation (radians), cached on refresh for the local-frame scale hit test.
  private worldRotation = 0;

  constructor() {
    this.container = new Container();
    this.container.visible = false;
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.scaleContainer = new Container();
    this.scaleGraphics = new Graphics();
    this.scaleContainer.addChild(this.scaleGraphics);
    this.container.addChild(this.scaleContainer);
    this.drawHandles();
    this.drawScaleHandles();
  }

  // Re-read the selection and the solved world transform, repositioning the gizmo. Called when the model
  // revision or the selection changes (not on idle frames), so the solve does not run every frame.
  refresh(model: DocumentReadModel): void {
    const selectedId = selectedBoneId();
    const world = selectedId === null ? undefined : solveWorldById(model).get(selectedId);
    if (selectedId === null || world === undefined) {
      this.worldOrigin = null;
      this.container.visible = false;
      return;
    }
    const origin = getTranslation(world);
    this.worldOrigin = origin;
    // The bone's world rotation is the angle of its world matrix x-axis column (a, b). World -> screen is
    // translate + uniform positive scale (no Y flip), so the screen angle equals the world angle.
    this.worldRotation = Math.atan2(world[1], world[0]);
    this.container.position.set(origin[0], origin[1]);
    this.scaleContainer.rotation = this.worldRotation;
    this.container.visible = true;
  }

  // Keep the handles a constant pixel size regardless of camera zoom: the overlay layer is scaled by the
  // camera zoom, so the gizmo counter-scales by its inverse. The scale sub-container inherits this, so its
  // rotation stays independent of the counter-scale. Cheap (no allocation), safe per frame.
  applyZoom(zoom: number): void {
    this.container.scale.set(1 / zoom);
  }

  // Classify which handle a screen point hits. The move/rotate handles are world-axis-aligned and constant
  // size, so a screen point maps to handle-local pixels by subtracting the bone origin's screen position.
  // The scale handles align to the bone's local axes, so the same delta is rotated by the negative world
  // rotation into the local frame before the scale-box test. Priority: free (center), then the local scale
  // handles, then the world move axes, then the ring, so overlapping pixels resolve to the most specific.
  hitTest(screenX: number, screenY: number, camera: Camera): GizmoHandle {
    if (this.worldOrigin === null || !this.container.visible) return 'none';
    const [cx, cy] = worldToScreen(camera, this.worldOrigin[0], this.worldOrigin[1]);
    const dx = screenX - cx;
    const dy = screenY - cy;

    if (Math.abs(dx) <= FREE_HALF && Math.abs(dy) <= FREE_HALF) return 'move-free';

    // Rotate the screen delta into the bone-local frame for the scale boxes (inverse of the world
    // rotation applied to the scale sub-container).
    const cos = Math.cos(this.worldRotation);
    const sin = Math.sin(this.worldRotation);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    const scaleHit = scaleHandleAtLocal(lx, ly);
    if (scaleHit !== null) return scaleHit;

    if (dx >= 0 && dx <= AXIS_EXTENT && Math.abs(dy) <= AXIS_TOLERANCE) return 'move-x';
    if (dy >= 0 && dy <= AXIS_EXTENT && Math.abs(dx) <= AXIS_TOLERANCE) return 'move-y';
    if (Math.abs(Math.hypot(dx, dy) - RING_RADIUS) <= RING_TOLERANCE) return 'rotate';
    return 'none';
  }

  // Static geometry, drawn once: refresh/applyZoom move and scale the container, never the geometry.
  private drawHandles(): void {
    const g = this.graphics;
    g.clear();

    // Rotate ring (outermost) first so the axes and free handle sit visually on top of it.
    g.circle(0, 0, RING_RADIUS).stroke({ width: 2, color: RING_COLOR, alpha: 0.9 });

    // X axis (move-x): shaft along +x with an arrowhead at the tip.
    g.moveTo(0, 0).lineTo(AXIS_LENGTH, 0).stroke({ width: 2, color: X_COLOR, alpha: 0.95 });
    g.poly([AXIS_LENGTH, -ARROW, AXIS_LENGTH + ARROW * 2, 0, AXIS_LENGTH, ARROW]).fill({
      color: X_COLOR,
    });

    // Y axis (move-y): screen-down (+y) per the world layout (world +y is down after mapping).
    g.moveTo(0, 0).lineTo(0, AXIS_LENGTH).stroke({ width: 2, color: Y_COLOR, alpha: 0.95 });
    g.poly([-ARROW, AXIS_LENGTH, 0, AXIS_LENGTH + ARROW * 2, ARROW, AXIS_LENGTH]).fill({
      color: Y_COLOR,
    });

    // Free move handle: a small square at the origin.
    g.rect(-FREE_HALF, -FREE_HALF, FREE_HALF * 2, FREE_HALF * 2).fill({
      color: FREE_COLOR,
      alpha: 0.9,
    });
  }

  // Scale handles (bone-local frame): a per-axis box at each local axis distance and a uniform box in the
  // first quadrant. Drawn once in the local frame; refresh rotates the sub-container to the bone rotation.
  private drawScaleHandles(): void {
    const g = this.scaleGraphics;
    g.clear();
    const box = (x: number, y: number, color: number): void => {
      g.rect(x - SCALE_HALF, y - SCALE_HALF, SCALE_HALF * 2, SCALE_HALF * 2).fill({ color });
    };
    box(SCALE_AXIS_DIST, 0, X_COLOR);
    box(0, SCALE_AXIS_DIST, Y_COLOR);
    box(SCALE_CORNER, SCALE_CORNER, SCALE_UNIFORM_COLOR);
  }
}

function selectedBoneId(): BoneId | null {
  const ids = useSelectionStore.getState().selectedBoneIds;
  return ids.length > 0 ? ids[0]! : null;
}
