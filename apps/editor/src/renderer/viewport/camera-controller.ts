// Viewport input -> camera actions (handoff 8.3): space-drag to pan, wheel to zoom around the cursor.
// The controller only WRITES to the camera (via the injected actions); it never reads or touches the
// document, so it cannot blur the editor-state / document wall. The actual transform math lives in the
// pure camera module and the store, keeping this file a thin, side-effecting input adapter.

// The subset of camera actions the controller needs (the camera store satisfies this). Injected so
// the controller is decoupled from Zustand and from Pixi.
export interface CameraControls {
  panBy(deltaScreenX: number, deltaScreenY: number): void;
  zoomAt(anchorX: number, anchorY: number, factor: number): void;
  setCursorHint(hint: CameraCursorHint): void;
}

export type CameraCursorHint = 'default' | 'grab' | 'grabbing';

// Wheel zoom feel: factor = exp(-deltaY * sensitivity), so scrolling up (negative deltaY) zooms in and
// the response is smooth and symmetric across zoom in and out.
const ZOOM_SENSITIVITY = 0.001;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Attach pan/zoom handlers to a viewport element and return a detach function. Space-held state is
// tracked on the window (the key can be pressed while the pointer is anywhere); pointer and wheel
// events are bound to the element so cursor coordinates are local to the canvas.
export function attachCameraController(target: HTMLElement, controls: CameraControls): () => void {
  let spaceHeld = false;
  let dragging = false;
  let lastClientX = 0;
  let lastClientY = 0;
  let activePointerId: number | null = null;

  const localPoint = (event: { clientX: number; clientY: number }): readonly [number, number] => {
    const rect = target.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || event.repeat || isTextEntry(event.target)) return;
    spaceHeld = true;
    // Stop Space from scrolling the page / activating a focused control while it is the pan modifier.
    event.preventDefault();
    if (!dragging) controls.setCursorHint('grab');
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    spaceHeld = false;
    if (!dragging) controls.setCursorHint('default');
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!spaceHeld || dragging) return;
    dragging = true;
    activePointerId = event.pointerId;
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    target.setPointerCapture(event.pointerId);
    controls.setCursorHint('grabbing');
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== activePointerId) return;
    controls.panBy(event.clientX - lastClientX, event.clientY - lastClientY);
    lastClientX = event.clientX;
    lastClientY = event.clientY;
  };

  const endDrag = (event: PointerEvent): void => {
    if (event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    controls.setCursorHint(spaceHeld ? 'grab' : 'default');
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const [anchorX, anchorY] = localPoint(event);
    controls.zoomAt(anchorX, anchorY, Math.exp(-event.deltaY * ZOOM_SENSITIVITY));
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);
  // passive:false so preventDefault on wheel actually suppresses page zoom/scroll.
  target.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', endDrag);
    target.removeEventListener('pointercancel', endDrag);
    target.removeEventListener('wheel', onWheel);
  };
}
