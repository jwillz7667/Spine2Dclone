import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import type {
  BoundingBoxAttachment,
  ClippingAttachment,
  PointAttachment,
  SkeletonDocument,
  Slot,
} from '@marionette/format/types';
import {
  boundingBoxWorldVerticesForSlot,
  buildPose,
  clipTriangleList,
  computeClippedSlotRange,
  computeWorldTransforms,
  hitTestBoundingBox,
  hitTestPolygon,
  makeClipBuffers,
  prepareClipping,
  resetToSetupPose,
  resolvePointWorld,
  resolvePointWorldForSlot,
  transformUnweightedVerticesInto,
} from '../src';
import type { ClipBuffers, Pose } from '../src';
import { bone } from './rig';

// Unit tests for the PP-B2 non-drawing geometry attachments (ADR-0012): the shared unweighted world
// transform, point resolution, bounding-box hit testing, clip-state resolution, and the Sutherland-Hodgman
// triangle clipper (convex + concave), plus determinism and an allocation probe. The cross-language golden
// vector (clip-geometry) and the two conformance rigs live in @marionette/conformance.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

// A single-triangle index list, hoisted so tests (and the allocation probe) pass the same array instead of
// a fresh literal each call.
const idx = [0, 1, 2];

// A slot with sensible defaults for a driving bone + setup attachment.
function slot(name: string, boneName: string, attachment: string): Slot {
  return { name, bone: boneName, color: { ...WHITE }, attachment, blendMode: 'normal' };
}

// Build a solved static pose (setup pose, world pass) from a document that carries slots + skin attachments.
function solvedPose(doc: SkeletonDocument): Pose {
  const pose = buildPose(doc);
  resetToSetupPose(pose);
  computeWorldTransforms(pose);
  return pose;
}

function clip(end: string, vertices: number[]): ClippingAttachment {
  return { type: 'clipping', end, vertices, color: { ...WHITE } };
}
function box(vertices: number[]): BoundingBoxAttachment {
  return { type: 'boundingbox', vertices };
}
function point(x: number, y: number, rotation: number): PointAttachment {
  return { type: 'point', x, y, rotation };
}

// Reconstruct an output vertex position from its barycentric coordinates and the source triangle corners,
// the invariant a renderer relies on to interpolate UVs/colors of a clipped triangle.
function baryReconstruct(
  bary: readonly [number, number, number],
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): [number, number] {
  return [
    bary[0] * p0[0] + bary[1] * p1[0] + bary[2] * p2[0],
    bary[0] * p0[1] + bary[1] * p1[1] + bary[2] * p2[1],
  ];
}

describe('transformUnweightedVerticesInto', () => {
  it('applies the bone world affine to each local vertex', () => {
    // A bone rotated 90 degrees about the origin: (x, y) -> (-y, x).
    const world = new Float64Array([0, 1, -1, 0, 5, 7]); // a=0,b=1,c=-1,d=0,tx=5,ty=7
    const out = new Float64Array(4);
    const count = transformUnweightedVerticesInto([1, 0, 0, 1], world, 0, out);
    expect(count).toBe(2);
    expect(Array.from(out)).toEqual([5, 8, 4, 7]); // (1,0)->(5,8); (0,1)->(4,7)
  });
});

describe('resolvePointWorld', () => {
  it('composes the local point with the slot bone world (position and rotation add)', () => {
    // Bone rotated 90 degrees (world rotation 90), translated to (10, 20).
    const world = new Float64Array([0, 1, -1, 0, 10, 20]);
    const result = resolvePointWorld(point(2, 0, 15), world, 0);
    expect(result.x).toBeCloseTo(10, 10); // (2,0) rotated 90 -> (0,2), + (10,20) = (10,22)
    expect(result.y).toBeCloseTo(22, 10);
    expect(result.rotationDeg).toBeCloseTo(105, 10); // 15 + 90
  });

  it('resolves for a slot from a solved pose', () => {
    const doc: SkeletonDocument = {
      formatVersion: '0.1.0',
      name: 'point-rig',
      hash: '',
      bones: [bone('root', null, { rotation: 90, x: 10, y: 20 })],
      slots: [slot('anchor', 'root', 'muzzle')],
      skins: [{ name: 'default', attachments: { anchor: { muzzle: point(2, 0, 15) } } }],
      animations: {},
      atlas: { pages: [] },
    };
    const pose = solvedPose(doc);
    const result = resolvePointWorldForSlot(pose, 0, point(2, 0, 15));
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(10, 6);
    expect(result!.y).toBeCloseTo(22, 6);
    expect(result!.rotationDeg).toBeCloseTo(105, 6);
  });
});

describe('hitTestPolygon (even-odd)', () => {
  const square = new Float64Array([0, 0, 4, 0, 4, 4, 0, 4]);

  it('reports inside and outside for a convex polygon', () => {
    expect(hitTestPolygon(square, 4, 2, 2)).toBe(true);
    expect(hitTestPolygon(square, 4, -1, 2)).toBe(false);
    expect(hitTestPolygon(square, 4, 5, 2)).toBe(false);
    expect(hitTestPolygon(square, 4, 2, 5)).toBe(false);
  });

  it('handles a concave (L-shaped) polygon: the notch is outside', () => {
    // L region = {x in [0,4], y in [0,1]} union {x in [0,1], y in [0,4]}; the notch x>1 && y>1 is out.
    const ell = new Float64Array([0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4]);
    expect(hitTestPolygon(ell, 6, 0.5, 0.5)).toBe(true); // corner (in both arms)
    expect(hitTestPolygon(ell, 6, 3, 0.5)).toBe(true); // horizontal arm
    expect(hitTestPolygon(ell, 6, 0.5, 3)).toBe(true); // vertical arm
    expect(hitTestPolygon(ell, 6, 3, 3)).toBe(false); // the notch
  });

  it('is orientation independent (a reversed-winding polygon hits identically)', () => {
    const reversed = new Float64Array([0, 4, 4, 4, 4, 0, 0, 0]); // same square, CW
    expect(hitTestPolygon(reversed, 4, 2, 2)).toBe(true);
    expect(hitTestPolygon(reversed, 4, 5, 5)).toBe(false);
  });
});

describe('bounding-box hit testing over a solved pose', () => {
  function boxRig(boneOverrides: Partial<ReturnType<typeof bone>>): SkeletonDocument {
    return {
      formatVersion: '0.1.0',
      name: 'box-rig',
      hash: '',
      bones: [bone('root', null, boneOverrides)],
      slots: [slot('hit', 'root', 'volume')],
      skins: [
        { name: 'default', attachments: { hit: { volume: box([-1, -1, 1, -1, 1, 1, -1, 1]) } } },
      ],
      animations: {},
      atlas: { pages: [] },
    };
  }

  it('transforms the box to world and hit-tests a world point', () => {
    const pose = solvedPose(boxRig({ x: 10, y: 10 }));
    const boxAttachment = box([-1, -1, 1, -1, 1, 1, -1, 1]);
    const world = new Float64Array(8);
    const count = boundingBoxWorldVerticesForSlot(pose, 0, boxAttachment, world);
    expect(count).toBe(4);
    expect(Array.from(world)).toEqual([9, 9, 11, 9, 11, 11, 9, 11]);

    const scratch = new Float64Array(8);
    expect(hitTestBoundingBox(pose, 0, boxAttachment, 10, 10, scratch)).toBe(true); // center
    expect(hitTestBoundingBox(pose, 0, boxAttachment, 12, 10, scratch)).toBe(false); // outside
  });

  it('respects the bone rotation (a rotated box still hits its rotated interior)', () => {
    const pose = solvedPose(boxRig({ rotation: 45, x: 0, y: 0 }));
    const boxAttachment = box([-1, -1, 1, -1, 1, 1, -1, 1]);
    const scratch = new Float64Array(8);
    expect(hitTestBoundingBox(pose, 0, boxAttachment, 0, 0, scratch)).toBe(true); // center unmoved
    // A corner of the axis-aligned box is now rotated inward; (0.95, 0.95) sits outside the 45deg diamond.
    expect(hitTestBoundingBox(pose, 0, boxAttachment, 0.95, 0.95, scratch)).toBe(false);
  });
});

describe('computeClippedSlotRange', () => {
  // Four slots on one bone; the clip slot (index 0) ends at slot "c" (index 2).
  function fourSlotPose(): Pose {
    const doc: SkeletonDocument = {
      formatVersion: '0.1.0',
      name: 'clip-range-rig',
      hash: '',
      bones: [bone('root', null)],
      slots: [
        slot('clipper', 'root', 'poly'),
        slot('a', 'root', 'a_tex'),
        slot('c', 'root', 'c_tex'),
        slot('d', 'root', 'd_tex'),
      ],
      skins: [
        {
          name: 'default',
          attachments: {
            clipper: { poly: clip('c', [0, 0, 1, 0, 1, 1, 0, 1]) },
          },
        },
      ],
      animations: {},
      atlas: { pages: [] },
    };
    return solvedPose(doc);
  }

  it('returns the slots after the clip slot up to and including the end slot in setup order', () => {
    const pose = fourSlotPose();
    const out = new Int32Array(pose.slotCount);
    const count = computeClippedSlotRange(pose, 0, 2, out); // clip slot 0, end slot 2 ("c")
    expect(count).toBe(2);
    expect(Array.from(out.subarray(0, count))).toEqual([1, 2]); // slots a, c
  });

  it('follows the CURRENT draw order, not the setup order', () => {
    const pose = fourSlotPose();
    // Reorder so that render order is [d, clipper, a, c] (draw d first, then clipper at position 1).
    pose.drawOrder.set([3, 0, 1, 2]);
    const out = new Int32Array(pose.slotCount);
    const count = computeClippedSlotRange(pose, 0, 2, out);
    expect(count).toBe(2);
    expect(Array.from(out.subarray(0, count))).toEqual([1, 2]); // positions after clipper up to c
  });

  it('is empty when the end slot is at or before the clip slot in draw order', () => {
    const pose = fourSlotPose();
    const out = new Int32Array(pose.slotCount);
    expect(computeClippedSlotRange(pose, 2, 0, out)).toBe(0); // end before clip
    expect(computeClippedSlotRange(pose, 0, 0, out)).toBe(0); // end == clip
  });
});

describe('prepareClipping', () => {
  it('detects a convex polygon (single piece, no ear triangles)', () => {
    const prepared = prepareClipping(clip('end', [0, 0, 2, 0, 2, 2, 0, 2]));
    expect(prepared.convex).toBe(true);
    expect(prepared.pieceCount).toBe(1);
    expect(prepared.earTriangles.length).toBe(0);
    expect(prepared.maxOutputVerticesPerTri).toBe(3 + 4);
  });

  it('detects a concave polygon and ear-clips it into V-2 triangles', () => {
    const ell = clip('end', [0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4]); // 6 vertices, concave
    const prepared = prepareClipping(ell);
    expect(prepared.convex).toBe(false);
    expect(prepared.pieceCount).toBe(4); // V - 2
    expect(prepared.earTriangles.length).toBe(12); // (V - 2) * 3
    expect(prepared.maxRingsPerTri).toBe(4);
  });
});

describe('clipTriangleList (convex clip polygon)', () => {
  const prepared = prepareClipping(clip('end', [0, 0, 2, 0, 2, 2, 0, 2])); // 2x2 square
  const worldPolygon = new Float64Array([0, 0, 2, 0, 2, 2, 0, 2]);

  it('passes a triangle wholly inside the polygon through unchanged', () => {
    const tri = new Float64Array([0.5, 0.5, 1.5, 0.5, 1, 1.5]);
    const buffers = makeClipBuffers();
    const result = clipTriangleList(prepared, worldPolygon, tri, idx, buffers);
    expect(result.ringCount).toBe(1);
    expect(result.vertexCount).toBe(3);
    expect(Array.from(buffers.positions.subarray(0, 6))).toEqual([0.5, 0.5, 1.5, 0.5, 1, 1.5]);
    // Canonical barycentrics on the three untouched corners.
    expect(Array.from(buffers.bary.subarray(0, 9))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('drops a triangle wholly outside the polygon', () => {
    const tri = new Float64Array([3, 3, 4, 3, 3, 4]);
    const buffers = makeClipBuffers();
    const result = clipTriangleList(prepared, worldPolygon, tri, idx, buffers);
    expect(result.ringCount).toBe(0);
    expect(result.vertexCount).toBe(0);
  });

  it('clips a straddling triangle to the polygon and keeps barycentrics consistent', () => {
    const p0: [number, number] = [1, 1];
    const p1: [number, number] = [3, 1];
    const p2: [number, number] = [1, 3];
    const tri = new Float64Array([...p0, ...p1, ...p2]);
    const buffers = makeClipBuffers();
    const result = clipTriangleList(prepared, worldPolygon, tri, idx, buffers);
    expect(result.ringCount).toBe(1);
    expect(result.vertexCount).toBeGreaterThan(3); // the corner outside the square adds edge crossings

    for (let v = 0; v < result.vertexCount; v += 1) {
      const x = buffers.positions[v * 2]!;
      const y = buffers.positions[v * 2 + 1]!;
      // Every clipped vertex lies within the square (allowing tiny epsilon).
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(2 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(2 + 1e-9);
      // The barycentrics reconstruct the position (the renderer's interpolation invariant).
      const bary: [number, number, number] = [
        buffers.bary[v * 3]!,
        buffers.bary[v * 3 + 1]!,
        buffers.bary[v * 3 + 2]!,
      ];
      const [rx, ry] = baryReconstruct(bary, p0, p1, p2);
      expect(rx).toBeCloseTo(x, 9);
      expect(ry).toBeCloseTo(y, 9);
      expect(bary[0] + bary[1] + bary[2]).toBeCloseTo(1, 9);
    }
  });

  it('produces identical output under a reflected clip polygon (winding reorientation)', () => {
    const reflected = new Float64Array([0, 0, 0, 2, 2, 2, 2, 0]); // same square, CW winding
    const preparedReflected = prepareClipping(clip('end', [0, 0, 0, 2, 2, 2, 2, 0]));
    const tri = new Float64Array([1, 1, 3, 1, 1, 3]);
    const a = makeClipBuffers();
    const b = makeClipBuffers();
    const ra = clipTriangleList(prepared, worldPolygon, tri, [0, 1, 2], a);
    const rb = clipTriangleList(preparedReflected, reflected, tri, [0, 1, 2], b);
    expect(rb.ringCount).toBe(ra.ringCount);
    // Same clipped REGION: every output vertex of b lies inside the square too.
    for (let v = 0; v < rb.vertexCount; v += 1) {
      const x = b.positions[v * 2]!;
      const y = b.positions[v * 2 + 1]!;
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(2 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe('clipTriangleList (concave clip polygon)', () => {
  const ell = clip('end', [0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4]); // L-shape, notch at x>1 && y>1
  const prepared = prepareClipping(ell);
  const worldPolygon = new Float64Array([0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4]);

  it('clips a triangle to the L region, excluding the notch', () => {
    const tri = new Float64Array([0.5, 0.5, 3.5, 0.5, 0.5, 3.5]);
    const buffers = makeClipBuffers();
    const result = clipTriangleList(prepared, worldPolygon, tri, idx, buffers);
    expect(result.ringCount).toBeGreaterThan(0);
    for (let v = 0; v < result.vertexCount; v += 1) {
      const x = buffers.positions[v * 2]!;
      const y = buffers.positions[v * 2 + 1]!;
      // No output vertex is deep in the notch (x > 1 AND y > 1).
      expect(x <= 1 + 1e-6 || y <= 1 + 1e-6).toBe(true);
    }
  });
});

describe('clip determinism and allocation', () => {
  const prepared = prepareClipping(clip('end', [0, 0, 2, 0, 2, 2, 0, 2]));
  const worldPolygon = new Float64Array([0, 0, 2, 0, 2, 2, 0, 2]);
  const tri = new Float64Array([1, 1, 3, 1, 1, 3]);
  const idx = [0, 1, 2]; // hoisted so the allocation probe measures only the clipper, not a literal

  it('is deterministic across two independent clips', () => {
    const a = makeClipBuffers();
    const b = makeClipBuffers();
    const ra = clipTriangleList(prepared, worldPolygon, tri, [0, 1, 2], a);
    const rb = clipTriangleList(prepared, worldPolygon, tri, [0, 1, 2], b);
    expect(rb.ringCount).toBe(ra.ringCount);
    expect(rb.vertexCount).toBe(ra.vertexCount);
    expect(Array.from(a.positions.subarray(0, ra.vertexCount * 2))).toEqual(
      Array.from(b.positions.subarray(0, rb.vertexCount * 2)),
    );
    expect(Array.from(a.bary.subarray(0, ra.vertexCount * 3))).toEqual(
      Array.from(b.bary.subarray(0, rb.vertexCount * 3)),
    );
  });

  it('allocates no heap across repeated clips with reused buffers (allocation probe)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the clip allocation probe requires the worker to run with --expose-gc');
    }
    const buffers: ClipBuffers = makeClipBuffers();
    for (let i = 0; i < 2000; i += 1) clipTriangleList(prepared, worldPolygon, tri, idx, buffers);

    runGc();
    const before = memoryUsage().heapUsed;
    for (let i = 0; i < 100_000; i += 1) {
      clipTriangleList(prepared, worldPolygon, tri, idx, buffers);
    }
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;
    expect(heapGrowth).toBeLessThan(256 * 1024);
  });
});
