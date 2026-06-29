import { describe, expect, it } from 'vitest';
import { triangulate } from './triangulate';
import { MeshError } from './mesh-error';
import type { Point } from './point';

// A unit square hull wound CCW (image-Y-down or math-Y-up: triangulate normalizes winding internally).
const QUAD: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('triangulate', () => {
  it('triangulates a convex n-gon into exactly n-2 triangles', () => {
    // A regular hexagon (convex), so ear-clipping yields 6 - 2 = 4 triangles.
    const hexagon: Point[] = [];
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      hexagon.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    const tris = triangulate(hexagon);
    expect(tris.length).toBe((6 - 2) * 3);
    // Every index references a real hull vertex.
    for (const idx of tris) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(hexagon.length);
    }
  });

  it('is deterministic: a quad-plus-center fan triangulates identically across runs', () => {
    const center: Point[] = [{ x: 0.5, y: 0.5 }];
    const first = triangulate(QUAD, center);
    const second = triangulate(QUAD, center);
    const third = triangulate(QUAD, center);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('fans a quad-plus-center into 4 triangles over 5 vertices', () => {
    const tris = triangulate(QUAD, [{ x: 0.5, y: 0.5 }]);
    // Quad alone -> 2 triangles; inserting the interior center splits the containing triangle into 3,
    // for 2 - 1 + 3 = 4 triangles total.
    expect(tris.length).toBe(4 * 3);
    const centerIndex = 4; // [...hull(0..3), center(4)]
    // The center vertex participates in three triangles (the fan around it).
    const centerUses = tris.filter((i) => i === centerIndex).length;
    expect(centerUses).toBe(3);
    // All indices are in range of the 5-vertex combined array.
    for (const idx of tris) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(5);
    }
  });

  it('produces a valid quad triangulation (2 triangles, all hull indices)', () => {
    const tris = triangulate(QUAD);
    expect(tris.length).toBe(2 * 3);
    for (const idx of tris) expect(idx).toBeLessThan(4);
  });

  it('throws MeshError on a degenerate (fewer than 3 points) hull', () => {
    expect(() =>
      triangulate([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toThrowError(MeshError);
    try {
      triangulate([{ x: 0, y: 0 }]);
    } catch (error) {
      expect(error).toBeInstanceOf(MeshError);
      expect((error as MeshError).code).toBe('degenerate');
    }
  });

  it('throws MeshError with code collinear on a fully collinear hull', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    try {
      triangulate(line);
      throw new Error('expected triangulate to throw on collinear input');
    } catch (error) {
      expect(error).toBeInstanceOf(MeshError);
      expect((error as MeshError).code).toBe('collinear');
    }
  });
});
