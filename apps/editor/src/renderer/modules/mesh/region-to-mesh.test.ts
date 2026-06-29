import { describe, expect, it } from 'vitest';
import {
  regionToMeshInit,
  regionQuadCorners,
  REGION_QUAD_TRIANGLES,
  REGION_QUAD_UVS,
  type RegionSource,
} from './region-to-mesh';

// An untransformed 64x32 region centered at the origin (identity placement).
const REGION: RegionSource = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  width: 64,
  height: 32,
  color: { r: 1, g: 1, b: 1, a: 1 },
};

describe('regionQuadCorners', () => {
  it('places the 4 corners of an identity region as a centered width x height quad', () => {
    expect(regionQuadCorners(REGION)).toEqual([
      { x: -32, y: -16 }, // uv 0,0
      { x: 32, y: -16 }, // uv 1,0
      { x: 32, y: 16 }, // uv 1,1
      { x: -32, y: 16 }, // uv 0,1
    ]);
  });

  it('honors placement translation', () => {
    const corners = regionQuadCorners({ ...REGION, x: 100, y: 50 });
    expect(corners[0]).toEqual({ x: 68, y: 34 });
    expect(corners[2]).toEqual({ x: 132, y: 66 });
  });

  it('rotates the quad 90 degrees about its center', () => {
    const corners = regionQuadCorners({ ...REGION, rotation: 90 });
    // Corner (-32, -16) rotates 90deg CCW (x' = x cos - y sin, y' = x sin + y cos) to (16, -32).
    expect(corners[0]!.x).toBeCloseTo(16, 6);
    expect(corners[0]!.y).toBeCloseTo(-32, 6);
  });
});

describe('regionToMeshInit', () => {
  it('produces the 4 corners, full-region uvs, 2 default triangles, and the region size/color', () => {
    const init = regionToMeshInit(REGION);
    expect(init.hullLength).toBe(4);
    expect(init.uvs).toEqual([...REGION_QUAD_UVS]);
    expect(init.triangles).toEqual([...REGION_QUAD_TRIANGLES]);
    expect(init.width).toBe(64);
    expect(init.height).toBe(32);
    expect(init.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    // The flat vertex stream is the four corners.
    expect(init.vertices).toEqual([-32, -16, 32, -16, 32, 16, -32, 16]);
    // Unweighted: no bones manifest.
    expect('bones' in init).toBe(false);
  });

  it('carries the region color through to the mesh', () => {
    const init = regionToMeshInit({ ...REGION, color: { r: 0.5, g: 0.25, b: 0.1, a: 0.8 } });
    expect(init.color).toEqual({ r: 0.5, g: 0.25, b: 0.1, a: 0.8 });
  });
});
