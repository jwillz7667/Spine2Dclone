import { describe, expect, it } from 'vitest';
import { gridFill, interiorGridPoints, boundsOf } from './grid-fill';
import type { Point } from './point';

// A 100x100 axis-aligned square hull (CCW).
const SQUARE: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('boundsOf', () => {
  it('computes the axis-aligned bounding box', () => {
    expect(boundsOf(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  });
});

describe('interiorGridPoints', () => {
  it('produces more vertices as the cell size shrinks', () => {
    const coarse = interiorGridPoints(SQUARE, 50);
    const fine = interiorGridPoints(SQUARE, 20);
    const finer = interiorGridPoints(SQUARE, 10);
    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(finer.length).toBeGreaterThan(fine.length);
  });

  it('keeps only points strictly inside the hull', () => {
    const pts = interiorGridPoints(SQUARE, 25);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(100);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(100);
    }
  });

  it('returns nothing for a non-positive cell size', () => {
    expect(interiorGridPoints(SQUARE, 0)).toEqual([]);
    expect(interiorGridPoints(SQUARE, -5)).toEqual([]);
  });
});

describe('gridFill', () => {
  it('emits a valid manifold: every triangle index is in range of the vertex array', () => {
    const result = gridFill(SQUARE, 25);
    expect(result.hullLength).toBe(4);
    expect(result.vertices.length).toBeGreaterThanOrEqual(4);
    expect(result.triangles.length % 3).toBe(0);
    for (const idx of result.triangles) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(result.vertices.length);
    }
    // The combined vertices are hull-first.
    expect(result.vertices.slice(0, 4)).toEqual(SQUARE);
  });

  it('is deterministic for the same hull and cell size', () => {
    const a = gridFill(SQUARE, 20);
    const b = gridFill(SQUARE, 20);
    expect(b.vertices).toEqual(a.vertices);
    expect(b.triangles).toEqual(a.triangles);
  });

  it('clips interior vertices to a non-convex (L-shaped) hull', () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 60 },
      { x: 0, y: 60 },
    ];
    const result = gridFill(lShape, 10);
    // No interior grid vertex falls in the cut-out (x > 20 and y > 20).
    for (const v of result.vertices.slice(lShape.length)) {
      expect(v.x > 20 && v.y > 20).toBe(false);
    }
    for (const idx of result.triangles) {
      expect(idx).toBeLessThan(result.vertices.length);
    }
  });
});
