import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW,
  MAX_ZOOM_X,
  MIN_ZOOM_X,
  clampZoomX,
  frameOf,
  panViewByPixels,
  snapToFrame,
  timeOfFrame,
  timeToX,
  visibleTimeRange,
  xToTime,
  zoomXAround,
  type DopesheetView,
} from './timeline-math';

const VIEW: DopesheetView = { scrollX: 140, zoomX: 90, scrollY: 30 };

describe('timeline-math', () => {
  it('xToTime inverts timeToX exactly', () => {
    for (const t of [0, 0.5, 1.2, -0.3, 7.75]) {
      expect(xToTime(VIEW, timeToX(VIEW, t))).toBeCloseTo(t, 12);
    }
    for (const x of [0, 33, -88, 412.5]) {
      expect(timeToX(VIEW, xToTime(VIEW, x))).toBeCloseTo(x, 12);
    }
  });

  it('maps frames at the working rate (round of t*fps)', () => {
    expect(frameOf(0.5, 30)).toBe(15);
    expect(frameOf(1.0, 30)).toBe(30);
    expect(frameOf(0.5, 60)).toBe(30);
    expect(timeOfFrame(15, 30)).toBeCloseTo(0.5, 12);
  });

  it('snaps to the nearest frame and passes through when disabled', () => {
    expect(snapToFrame(0.51, 30, true)).toBeCloseTo(0.5, 12);
    expect(snapToFrame(0.49, 30, true)).toBeCloseTo(0.5, 12);
    expect(snapToFrame(0.51, 30, false)).toBe(0.51);
  });

  it('zoomXAround keeps the time under the anchor fixed and clamps zoom', () => {
    const anchorX = 250;
    for (const factor of [1.3, 0.7, 4, 0.25]) {
      const before = xToTime(VIEW, anchorX);
      const zoomed = zoomXAround(VIEW, anchorX, factor);
      expect(xToTime(zoomed, anchorX)).toBeCloseTo(before, 9);
    }
    expect(zoomXAround({ ...VIEW, zoomX: MAX_ZOOM_X }, anchorX, 10).zoomX).toBe(MAX_ZOOM_X);
    expect(zoomXAround({ ...VIEW, zoomX: MIN_ZOOM_X }, anchorX, 0.01).zoomX).toBe(MIN_ZOOM_X);
  });

  it('clampZoomX bounds the rate', () => {
    expect(clampZoomX(100000)).toBe(MAX_ZOOM_X);
    expect(clampZoomX(0.1)).toBe(MIN_ZOOM_X);
    expect(clampZoomX(90)).toBe(90);
  });

  it('panViewByPixels slides X and floors Y scroll at zero', () => {
    expect(panViewByPixels(VIEW, 10, 5)).toEqual({ scrollX: 150, zoomX: 90, scrollY: 35 });
    expect(panViewByPixels(VIEW, 0, -1000).scrollY).toBe(0);
  });

  it('visibleTimeRange returns the window across the timeline width', () => {
    const [start, end] = visibleTimeRange(DEFAULT_VIEW, 240);
    expect(start).toBeCloseTo(0, 12);
    expect(end).toBeCloseTo(2, 12); // 240px / 120px-per-second
  });
});
