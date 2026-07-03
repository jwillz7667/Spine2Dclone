import { describe, expect, it } from 'vitest';
import { MeshError } from './mesh-error';
import {
  addInteriorVertex,
  autoGridFillGeometry,
  deleteInteriorVertex,
  type MeshTopology,
} from './topology-edit';

// TASK-2.1.2: interior add (uv-interpolated, re-triangulated) and interior delete (hull forbidden),
// plus the TASK-2.1.5 uv-preserving grid fill: the pure geometry the AddMeshVertex / DeleteMeshVertex /
// AutoGridFillMesh commands consume.

// A unit quad hull (0,0)-(4,0)-(4,4)-(0,4) with full-region uvs, 2 triangles, no interior points.
function quad(): MeshTopology {
  return {
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    vertices: [0, 0, 4, 0, 4, 4, 0, 4],
  };
}

describe('addInteriorVertex', () => {
  it('appends the vertex, interpolates its uv barycentrically, and re-triangulates', () => {
    const result = addInteriorVertex(quad(), { x: 2, y: 2 });

    expect(result.vertices).toEqual([0, 0, 4, 0, 4, 4, 0, 4, 2, 2]);
    // The quad center's uv is (0.5, 0.5) whichever containing triangle interpolates it.
    expect(result.uvs.slice(8)).toEqual([0.5, 0.5]);
    // A 4-hull with one interior point triangulates to 4 triangles covering the quad.
    expect(result.triangles.length).toBe(12);
    for (const index of result.triangles) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
    }
    // The new vertex participates in the topology (it was not silently dropped).
    expect(result.triangles).toContain(4);
  });

  it('interpolates an off-center uv proportionally', () => {
    const result = addInteriorVertex(quad(), { x: 1, y: 0 });
    // (1, 0) sits a quarter along the bottom edge: uv (0.25, 0).
    expect(result.uvs.slice(8)[0]).toBeCloseTo(0.25, 12);
    expect(result.uvs.slice(8)[1]).toBeCloseTo(0, 12);
  });

  it('is deterministic: the same input yields the identical triangle list', () => {
    const a = addInteriorVertex(quad(), { x: 3, y: 1 });
    const b = addInteriorVertex(quad(), { x: 3, y: 1 });
    expect(a.triangles).toEqual(b.triangles);
  });

  it('rejects a point outside every triangle with the exact typed code', () => {
    expect(() => addInteriorVertex(quad(), { x: 10, y: 10 })).toThrowError(MeshError);
    try {
      addInteriorVertex(quad(), { x: 10, y: 10 });
    } catch (error) {
      expect((error as MeshError).code).toBe('outsideMesh');
    }
  });
});

describe('deleteInteriorVertex', () => {
  it('removes an interior vertex and its uv, then re-triangulates back to the hull topology', () => {
    const withCenter = addInteriorVertex(quad(), { x: 2, y: 2 });
    const geometry: MeshTopology = { ...withCenter, hullLength: 4 };

    const result = deleteInteriorVertex(geometry, 4);
    expect(result.vertices).toEqual([0, 0, 4, 0, 4, 4, 0, 4]);
    expect(result.uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(result.triangles.length).toBe(6); // back to the 2-triangle quad
  });

  it('shifts indices above the removed vertex down by one (add two, delete the first)', () => {
    const one = addInteriorVertex(quad(), { x: 1, y: 1 });
    const two = addInteriorVertex({ ...one, hullLength: 4 }, { x: 3, y: 3 });

    const result = deleteInteriorVertex({ ...two, hullLength: 4 }, 4);
    // The surviving interior vertex (3,3) now sits at index 4.
    expect(result.vertices.slice(8)).toEqual([3, 3]);
    expect(result.triangles).toContain(4);
    expect(Math.max(...result.triangles)).toBe(4);
  });

  it('refuses to delete a hull vertex with the exact typed code', () => {
    try {
      deleteInteriorVertex(quad(), 0);
      expect.unreachable('hull delete must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MeshError);
      expect((error as MeshError).code).toBe('hullVertex');
    }
  });

  it('refuses an out-of-range index with the exact typed code', () => {
    try {
      deleteInteriorVertex(quad(), 9);
      expect.unreachable('out-of-range delete must throw');
    } catch (error) {
      expect((error as MeshError).code).toBe('outsideMesh');
    }
  });
});

describe('autoGridFillGeometry', () => {
  it('keeps the hull ring and its uvs, fills the interior at the cell size, and interpolates uvs', () => {
    const result = autoGridFillGeometry(quad(), 1);

    // The hull is unchanged, first.
    expect(result.vertices.slice(0, 8)).toEqual([0, 0, 4, 0, 4, 4, 0, 4]);
    expect(result.uvs.slice(0, 8)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // A 4x4 quad at cell size 1 has a 3x3 strictly-interior grid.
    expect(result.vertices.length / 2).toBe(4 + 9);
    // Every interior uv is the barycentric interpolation, which for this quad is position / 4.
    for (let i = 4; i < result.vertices.length / 2; i += 1) {
      expect(result.uvs[i * 2]).toBeCloseTo(result.vertices[i * 2]! / 4, 12);
      expect(result.uvs[i * 2 + 1]).toBeCloseTo(result.vertices[i * 2 + 1]! / 4, 12);
    }
    // The triangulation covers hull + interior with in-range indices.
    expect(result.triangles.length).toBeGreaterThan(6);
    for (const index of result.triangles) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(result.vertices.length / 2);
    }
  });

  it('replaces existing interior points instead of accumulating them', () => {
    const withCenter = addInteriorVertex(quad(), { x: 2, y: 2 });
    const result = autoGridFillGeometry({ ...withCenter, hullLength: 4 }, 2);
    // Cell size 2 on the 4x4 quad leaves exactly one strictly-interior sample (2,2).
    expect(result.vertices.length / 2).toBe(5);
    expect(result.vertices.slice(8)).toEqual([2, 2]);
  });

  it('scales vertex count with cell size (smaller cells, more vertices)', () => {
    const coarse = autoGridFillGeometry(quad(), 2);
    const fine = autoGridFillGeometry(quad(), 0.5);
    expect(fine.vertices.length).toBeGreaterThan(coarse.vertices.length);
  });
});
