import { describe, expect, it } from 'vitest';
import { traceAlphaSilhouette, type AlphaMask } from './marching-squares';
import { simplifyClosed } from './douglas-peucker';
import { MeshError } from './mesh-error';
import { boundsOf } from './grid-fill';

// Build a width x height mask with a filled opaque rectangle [x0..x1] x [y0..y1] (inclusive) inside a
// transparent margin.
function rectMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): AlphaMask {
  const alpha = new Uint8Array(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      alpha[y * width + x] = 255;
    }
  }
  return { width, height, alpha };
}

describe('traceAlphaSilhouette', () => {
  it('traces a filled rectangle inside transparent margins to a rectangular contour within a pixel', () => {
    // A 5x4 opaque block (cols 2..6, rows 2..5) inside a 10x10 transparent image.
    const mask = rectMask(10, 10, 2, 2, 6, 5);
    const contour = traceAlphaSilhouette(mask, 128);
    expect(contour.length).toBeGreaterThan(3);
    // The traced contour's bounding box equals the opaque block's pixel extent (within a pixel).
    const b = boundsOf(contour);
    expect(b.minX).toBe(2);
    expect(b.minY).toBe(2);
    expect(b.maxX).toBe(6);
    expect(b.maxY).toBe(5);
    // Simplifying the closed contour's dense edge samples collapses the rectangle to its 4 corners.
    const corners = simplifyClosed(contour, 0.5);
    expect(corners.length).toBe(4);
    const cb = boundsOf(corners);
    expect(cb).toEqual(b);
  });

  it('handles a single opaque pixel as a one-point contour', () => {
    const mask = rectMask(5, 5, 2, 2, 2, 2);
    const contour = traceAlphaSilhouette(mask, 128);
    expect(contour).toEqual([{ x: 2, y: 2 }]);
  });

  it('respects the alpha threshold', () => {
    const alpha = new Uint8Array(9).fill(100);
    const mask: AlphaMask = { width: 3, height: 3, alpha };
    // Threshold above the fill value: nothing is opaque.
    expect(() => traceAlphaSilhouette(mask, 150)).toThrowError(MeshError);
    // Threshold below the fill value: the whole 3x3 is opaque, so a contour exists.
    expect(traceAlphaSilhouette(mask, 50).length).toBeGreaterThan(0);
  });

  it('throws MeshError(emptyMask) on a fully transparent mask', () => {
    const mask: AlphaMask = { width: 4, height: 4, alpha: new Uint8Array(16) };
    try {
      traceAlphaSilhouette(mask, 0);
      throw new Error('expected emptyMask');
    } catch (error) {
      expect(error).toBeInstanceOf(MeshError);
      expect((error as MeshError).code).toBe('emptyMask');
    }
  });
});
