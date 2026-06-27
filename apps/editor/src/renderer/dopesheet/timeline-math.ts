// Pure time<->pixel and time<->frame mapping for the dopesheet (WP-1.6, TASK-1.6.2 / 1.6.4 / 1.6.7).
// No React, no document, no DOM: these are the unit-tested acceptance functions. The dopesheet view is
// a pure pan/zoom of the time axis: zoomX is pixels-per-second, scrollX is the pixel offset of t=0 (the
// screen x of t=0 is -scrollX), and scrollY is the vertical pixel scroll of the track list (section 6
// dopesheetView). timeToX and xToTime are exact inverses for any zoomX > 0.

export type WorkingFps = 30 | 60;

export interface DopesheetView {
  readonly scrollX: number; // pixels; the screen x of t=0 is -scrollX
  readonly zoomX: number; // pixels per second (> 0)
  readonly scrollY: number; // pixels scrolled in the track list (>= 0)
}

export const DEFAULT_ZOOM_X = 120;
export const MIN_ZOOM_X = 16;
export const MAX_ZOOM_X = 4000;

export const DEFAULT_VIEW: DopesheetView = { scrollX: 0, zoomX: DEFAULT_ZOOM_X, scrollY: 0 };

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clampZoomX(zoomX: number): number {
  return clamp(zoomX, MIN_ZOOM_X, MAX_ZOOM_X);
}

export function timeToX(view: DopesheetView, time: number): number {
  return time * view.zoomX - view.scrollX;
}

export function xToTime(view: DopesheetView, x: number): number {
  return (x + view.scrollX) / view.zoomX;
}

// Zoom the time axis around a fixed screen x (the cursor), keeping the time under it stationary. Solves
// timeToX(next, anchorTime) === anchorX for scrollX, so the point under the cursor does not drift.
export function zoomXAround(view: DopesheetView, anchorX: number, factor: number): DopesheetView {
  const anchorTime = xToTime(view, anchorX);
  const zoomX = clampZoomX(view.zoomX * factor);
  const scrollX = anchorTime * zoomX - anchorX;
  return { scrollX, zoomX, scrollY: view.scrollY };
}

// Pan the view by a pixel delta. Horizontal pan slides the time axis; vertical pan scrolls the track
// list and never goes negative (there is nothing above the first track).
export function panViewByPixels(view: DopesheetView, dx: number, dy: number): DopesheetView {
  return { scrollX: view.scrollX + dx, zoomX: view.zoomX, scrollY: Math.max(0, view.scrollY + dy) };
}

// The frame number a time maps to at the working rate (TASK-1.6.7). round(t * fps): frame 15 at 0.5s
// and frame 30 at 1.0s at 30fps.
export function frameOf(time: number, fps: WorkingFps): number {
  return Math.round(time * fps);
}

export function timeOfFrame(frame: number, fps: WorkingFps): number {
  return frame / fps;
}

// Snap a time to the nearest frame at the working rate, with a disable flag (TASK-1.6.4). When disabled
// the time passes through unchanged so a modifier-held drag is frame-free.
export function snapToFrame(time: number, fps: WorkingFps, enabled: boolean): number {
  return enabled ? Math.round(time * fps) / fps : time;
}

// The inclusive time window currently visible across a timeline of `widthPx` pixels (horizontal
// virtualization: only keyframes inside this window are laid out and hit-tested).
export function visibleTimeRange(view: DopesheetView, widthPx: number): readonly [number, number] {
  return [xToTime(view, 0), xToTime(view, widthPx)];
}
