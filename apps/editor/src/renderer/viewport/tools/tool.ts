import type { Camera } from '../camera';

// A single pointer sample handed to the active viewport tool. The panel converts the raw DOM pointer
// into BOTH canvas-local screen pixels (for pixel-tolerance gizmo hit testing) and world coordinates
// (for the transform math), and carries the camera so a tool can reproject as needed. Screen and world
// are kept separate because tolerances are in pixels (zoom-independent) while transforms are in world
// units.
export interface ViewportPointer {
  readonly screenX: number;
  readonly screenY: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly camera: Camera;
  // Shift held at the event (WP-2.1: the mesh tool's add-vertex modifier). Carried on the pointer so a
  // tool never reads the DOM event itself, keeping tools unit-testable with plain pointer values.
  readonly shiftKey: boolean;
  // The additive-selection modifier (shift OR cmd/ctrl), for multi-select click and marquee (PP-D1).
  // Precomputed so tools stay decoupled from platform key conventions and unit-testable with plain values.
  readonly additive: boolean;
}

// A viewport tool consumes one pointer gesture (down, then moves, then up). The input router binds the
// gesture to whichever tool was active at pointerdown, so switching tools mid-drag cannot split a
// gesture across two tools.
export interface ViewportTool {
  onPointerDown(pointer: ViewportPointer): void;
  onPointerMove(pointer: ViewportPointer): void;
  onPointerUp(pointer: ViewportPointer): void;
}
