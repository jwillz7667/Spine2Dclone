import { Container, Graphics } from 'pixi.js';
import { getTranslation } from '@marionette/runtime-core';
import type { BoneId, DocumentReadModel } from '@marionette/document-core';
import { useSelectionStore } from '../../editor-state/selection-store';
import { worldToScreen, type Camera } from '../camera';
import { solveWorldById } from '../scene-solve';

// Which gizmo handle a screen point hits. 'none' means the point is off the gizmo (the caller then
// falls back to a bone pick / deselect).
export type GizmoHandle = 'move-x' | 'move-y' | 'move-free' | 'rotate' | 'none';

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

// The move/rotate gizmo (handoff 8.3, 10: gizmo feel is a budgeted risk). It draws axis + free move
// handles and a rotate ring on the OVERLAY layer at the selected bone's solved world origin, at a
// constant screen size, and exposes pixel-tolerance hit testing so the select-move tool can route a
// drag to the right channel (MoveBone vs RotateBone). It NEVER mutates the document: it reads the
// selection store and the solved world transform only. The widget is world-axis-aligned (the camera
// never rotates), which keeps both the drawing and the hit test a simple translate from the bone
// origin's screen position.
export class MoveRotateGizmo {
  readonly container: Container;
  private readonly graphics: Graphics;
  // The selected bone's world origin, cached on refresh so hit testing needs no per-event solve.
  private worldOrigin: readonly [number, number] | null = null;

  constructor() {
    this.container = new Container();
    this.container.visible = false;
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.drawHandles();
  }

  // Re-read the selection and the solved world origin, repositioning the gizmo. Called when the model
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
    this.container.position.set(origin[0], origin[1]);
    this.container.visible = true;
  }

  // Keep the handles a constant pixel size regardless of camera zoom: the overlay layer is scaled by
  // the camera zoom, so the gizmo counter-scales by its inverse. Cheap (no allocation), safe per frame.
  applyZoom(zoom: number): void {
    this.container.scale.set(1 / zoom);
  }

  // Classify which handle a screen point hits. Because the widget is world-axis-aligned and constant
  // size, a screen point maps to handle-local pixels by subtracting the bone origin's screen position;
  // the regions below match the drawn geometry. Free (center) wins over the axes, which win over the
  // ring, so overlapping near-center pixels resolve to the most specific handle.
  hitTest(screenX: number, screenY: number, camera: Camera): GizmoHandle {
    if (this.worldOrigin === null || !this.container.visible) return 'none';
    const [cx, cy] = worldToScreen(camera, this.worldOrigin[0], this.worldOrigin[1]);
    const dx = screenX - cx;
    const dy = screenY - cy;

    if (Math.abs(dx) <= FREE_HALF && Math.abs(dy) <= FREE_HALF) return 'move-free';
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
}

function selectedBoneId(): BoneId | null {
  const ids = useSelectionStore.getState().selectedBoneIds;
  return ids.length > 0 ? ids[0]! : null;
}
