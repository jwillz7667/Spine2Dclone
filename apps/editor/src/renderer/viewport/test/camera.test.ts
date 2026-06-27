import { describe, expect, it } from 'vitest';
import {
  centerWorldOn,
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Camera,
} from '../camera';

const CAMERA: Camera = { x: 120, y: -40, zoom: 1.5 };

describe('camera math', () => {
  it('screenToWorld inverts worldToScreen', () => {
    const points: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [37, -19],
      [-200.5, 88.25],
    ];
    for (const [wx, wy] of points) {
      const [sx, sy] = worldToScreen(CAMERA, wx, wy);
      const [rx, ry] = screenToWorld(CAMERA, sx, sy);
      expect(rx).toBeCloseTo(wx, 9);
      expect(ry).toBeCloseTo(wy, 9);
    }
  });

  it('panBy translates by the screen delta and leaves zoom untouched', () => {
    const panned = panBy(CAMERA, 25, -10);
    expect(panned).toEqual({ x: 145, y: -50, zoom: 1.5 });

    // A drag moves the content with the cursor: the screen projection of a world point shifts by the
    // same delta.
    const [sx, sy] = worldToScreen(CAMERA, 10, 10);
    const [px, py] = worldToScreen(panned, 10, 10);
    expect(px - sx).toBeCloseTo(25, 9);
    expect(py - sy).toBeCloseTo(-10, 9);
  });

  it('zoomAt keeps the world point under the anchor fixed on a zoom in and a zoom out', () => {
    const anchor: readonly [number, number] = [300, 175];

    for (const factor of [1.25, 0.8, 2, 0.5]) {
      const before = screenToWorld(CAMERA, anchor[0], anchor[1]);
      const zoomed = zoomAt(CAMERA, anchor[0], anchor[1], factor);
      const after = screenToWorld(zoomed, anchor[0], anchor[1]);
      expect(after[0]).toBeCloseTo(before[0], 9);
      expect(after[1]).toBeCloseTo(before[1], 9);
      expect(zoomed.zoom).toBeCloseTo(1.5 * factor, 9);
    }
  });

  it('zoomAt clamps zoom while still pinning the anchor at the bound', () => {
    const anchor: readonly [number, number] = [50, 60];

    const tooFar = zoomAt({ x: 0, y: 0, zoom: MAX_ZOOM }, anchor[0], anchor[1], 4);
    expect(tooFar.zoom).toBe(MAX_ZOOM);
    const tooClose = zoomAt({ x: 0, y: 0, zoom: MIN_ZOOM }, anchor[0], anchor[1], 0.1);
    expect(tooClose.zoom).toBe(MIN_ZOOM);

    // The anchor's world point is still preserved at the clamp bound.
    const cam = { x: 10, y: 20, zoom: MAX_ZOOM };
    const before = screenToWorld(cam, anchor[0], anchor[1]);
    const after = screenToWorld(zoomAt(cam, anchor[0], anchor[1], 10), anchor[0], anchor[1]);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('clampZoom bounds the zoom factor', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });

  it('centerWorldOn frames a world point at a screen point', () => {
    const cam = centerWorldOn(0, 0, 400, 300, 1);
    expect(worldToScreen(cam, 0, 0)).toEqual([400, 300]);

    const cam2 = centerWorldOn(50, -25, 400, 300, 2);
    const [sx, sy] = worldToScreen(cam2, 50, -25);
    expect(sx).toBeCloseTo(400, 9);
    expect(sy).toBeCloseTo(300, 9);
  });
});
