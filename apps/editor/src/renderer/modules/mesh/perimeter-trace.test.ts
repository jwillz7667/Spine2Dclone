import { describe, expect, it } from 'vitest';
import { perimeterTrace, type PixelMapping } from './perimeter-trace';
import type { AlphaMask } from './marching-squares';
import type { Point } from './point';

// A filled rectangle [x0..x1] x [y0..y1] inside a transparent margin.
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

// Identity-ish mappings: UV is pixel / imageSize; local is pixel as-is (so the traced hull is in pixel
// coordinates, easy to assert against the silhouette).
function mappings(width: number, height: number): PixelMapping {
  return {
    toUv: (p: Point) => ({ x: p.x / width, y: p.y / height }),
    toLocal: (p: Point) => ({ x: p.x, y: p.y }),
  };
}

describe('perimeterTrace', () => {
  it('traces an opaque rectangle hull within tolerance and triangulates a valid mesh', () => {
    const W = 24;
    const H = 20;
    const mask = rectMask(W, H, 4, 4, 18, 14); // a 15x11 opaque block
    const fill = perimeterTrace(mask, mappings(W, H), {
      threshold: 128,
      simplifyTolerance: 0.5,
      cellSize: 4,
    });

    // The hull (first hullLength vertices, local == pixel here) follows the opaque silhouette: its
    // bounding box matches the block extent within a pixel.
    const hull: Point[] = [];
    for (let i = 0; i < fill.hullLength; i += 1) {
      hull.push({ x: fill.vertices[i * 2]!, y: fill.vertices[i * 2 + 1]! });
    }
    expect(fill.hullLength).toBe(4); // a rectangle simplifies to 4 corners
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    expect(Math.min(...xs)).toBe(4);
    expect(Math.max(...xs)).toBe(18);
    expect(Math.min(...ys)).toBe(4);
    expect(Math.max(...ys)).toBe(14);

    // The triangulation is a valid manifold: indices in range, multiple of 3.
    const vertexCount = fill.vertices.length / 2;
    expect(fill.triangles.length % 3).toBe(0);
    expect(fill.triangles.length).toBeGreaterThan(0);
    for (const idx of fill.triangles) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertexCount);
    }

    // UVs are one (u, v) per vertex, each in [0, 1].
    expect(fill.uvs.length).toBe(fill.vertices.length);
    for (const uv of fill.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }

    // Interior grid vertices were added beyond the 4 hull corners (cellSize 4 over a 15x11 block).
    expect(vertexCount).toBeGreaterThan(fill.hullLength);

    // The hull wireframe edges ring the hull.
    expect(fill.edges).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
  });

  it('is deterministic for the same mask and options', () => {
    const W = 16;
    const H = 16;
    const mask = rectMask(W, H, 3, 3, 12, 12);
    const opts = { threshold: 128, simplifyTolerance: 0.5, cellSize: 3 };
    const a = perimeterTrace(mask, mappings(W, H), opts);
    const b = perimeterTrace(mask, mappings(W, H), opts);
    expect(b.vertices).toEqual(a.vertices);
    expect(b.triangles).toEqual(a.triangles);
    expect(b.uvs).toEqual(a.uvs);
  });

  it('propagates the emptyMask failure from a fully transparent sprite', () => {
    const mask: AlphaMask = { width: 8, height: 8, alpha: new Uint8Array(64) };
    expect(() =>
      perimeterTrace(mask, mappings(8, 8), {
        threshold: 0,
        simplifyTolerance: 0.5,
        cellSize: 2,
      }),
    ).toThrowError();
  });
});
