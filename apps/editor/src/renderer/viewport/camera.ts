// Pure viewport camera math (handoff 8.2, 8.3). The camera is ephemeral editor state, never part of
// the document: it maps world space to the viewport's screen space and back. The transform is the
// simple affine screen = world * zoom + (x, y), where (x, y) is the screen-space translation in
// device-independent pixels and zoom is pixels per world unit. This module imports nothing (no Pixi,
// no DOM), so screenToWorld/worldToScreen/zoomAt/panBy are unit-testable without a renderer.

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

// Zoom is clamped to a sane range so a runaway wheel gesture cannot invert (zoom <= 0 would make
// screenToWorld divide by zero) or explode the scene scale.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 64;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number,
): readonly [number, number] {
  return [worldX * camera.zoom + camera.x, worldY * camera.zoom + camera.y];
}

export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
): readonly [number, number] {
  return [(screenX - camera.x) / camera.zoom, (screenY - camera.y) / camera.zoom];
}

// Pan by a screen-space delta (a drag). The content moves with the cursor, so a world point under the
// cursor stays under it for the duration of the drag.
export function panBy(camera: Camera, deltaScreenX: number, deltaScreenY: number): Camera {
  return { x: camera.x + deltaScreenX, y: camera.y + deltaScreenY, zoom: camera.zoom };
}

// Zoom by a multiplicative factor about a screen anchor (scroll-zoom-around-cursor). The world point
// currently under (anchorX, anchorY) is held fixed on screen: it is unprojected with the old zoom and
// re-projected with the clamped new zoom, and the translation is solved so the two coincide. When the
// new zoom hits a clamp bound the anchor is still preserved exactly (the translation uses the clamped
// zoom), the gesture simply stops scaling further.
export function zoomAt(camera: Camera, anchorX: number, anchorY: number, factor: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const [worldX, worldY] = screenToWorld(camera, anchorX, anchorY);
  return { x: anchorX - worldX * zoom, y: anchorY - worldY * zoom, zoom };
}

// Center a world point under a screen point (used to frame the origin when the viewport first sizes).
export function centerWorldOn(
  worldX: number,
  worldY: number,
  screenX: number,
  screenY: number,
  zoom: number,
): Camera {
  const clamped = clampZoom(zoom);
  return { x: screenX - worldX * clamped, y: screenY - worldY * clamped, zoom: clamped };
}
