import { screenToWorld, type Camera } from './camera';
import type { ViewportPointer, ViewportTool } from './tools/tool';

// Routes raw canvas pointer events to the active viewport tool, in both screen and world coordinates.
// It coexists with the camera controller on the SAME canvas: while Space is held the camera controller
// owns the drag (pan), so this router tracks Space itself and ignores pointer gestures while it is
// down. A gesture is bound to whichever tool was active at pointerdown, so switching tools mid-drag
// cannot split a gesture across two tools. The router holds no document state; the tools do.
export interface ToolInputDeps {
  getCamera(): Camera;
  getActiveTool(): ViewportTool;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function attachToolInput(target: HTMLElement, deps: ToolInputDeps): () => void {
  let spaceHeld = false;
  let active: { pointerId: number; tool: ViewportTool } | null = null;

  const toPointer = (event: PointerEvent): ViewportPointer => {
    const rect = target.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const camera = deps.getCamera();
    const [worldX, worldY] = screenToWorld(camera, screenX, screenY);
    return { screenX, screenY, worldX, worldY, camera };
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && !isTextEntry(event.target)) spaceHeld = true;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') spaceHeld = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Space-drag belongs to the camera controller; only the primary (left) button drives tools.
    if (spaceHeld || event.button !== 0 || active !== null) return;
    const tool = deps.getActiveTool();
    active = { pointerId: event.pointerId, tool };
    target.setPointerCapture(event.pointerId);
    tool.onPointerDown(toPointer(event));
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    active.tool.onPointerMove(toPointer(event));
  };

  const endDrag = (event: PointerEvent): void => {
    if (active === null || event.pointerId !== active.pointerId) return;
    const tool = active.tool;
    active = null;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    tool.onPointerUp(toPointer(event));
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', endDrag);
    target.removeEventListener('pointercancel', endDrag);
  };
}
