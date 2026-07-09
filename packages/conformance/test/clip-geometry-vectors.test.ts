import { describe, expect, it } from 'vitest';
import type { ClippingAttachment } from '@marionette/format/types';
import { clipTriangleList, makeClipBuffers, prepareClipping } from '@marionette/runtime-core';
import { VERTEX, withinTolerance } from '../src/compare/tolerance';
import golden from '../src/cross-language/clip-geometry-vectors.json';

// PP-B2 (ADR-0012 section 3) clip-geometry cross-language golden vectors, TS side. It REGENERATES every case
// from runtime-core's Sutherland-Hodgman clipper (the oracle) and asserts the committed golden still matches,
// so the corpus can never silently drift from the implementation. The native runtimes (C#, GDScript) load the
// SAME committed JSON and assert their clipper reproduces it: positions and barycentrics within the VERTEX
// tolerance, and the convex flag, ringCount, per-ring vertexCount, and sourceTri EXACT.

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

describe('clip-geometry cross-language vectors (PP-B2, ADR-0012)', () => {
  for (const testCase of golden.cases) {
    it(`reproduces case "${testCase.name}" from runtime-core`, () => {
      const clip: ClippingAttachment = {
        type: 'clipping',
        end: 'end',
        vertices: testCase.polygon,
        color: WHITE,
      };
      const prepared = prepareClipping(clip);
      expect(prepared.convex).toBe(testCase.convex);

      const worldPolygon = new Float64Array(testCase.polygon);
      const buffers = makeClipBuffers();
      const result = clipTriangleList(
        prepared,
        worldPolygon,
        new Float64Array(testCase.triVerts),
        testCase.triIndices,
        buffers,
      );

      expect(result.ringCount).toBe(testCase.expected.ringCount);

      let base = 0;
      for (let r = 0; r < result.ringCount; r += 1) {
        const expectedRing = testCase.expected.rings[r]!;
        expect(buffers.ringSourceTri[r]).toBe(expectedRing.sourceTri);
        expect(buffers.ringVertexCount[r]).toBe(expectedRing.vertexCount);
        for (let v = 0; v < expectedRing.vertexCount; v += 1) {
          const px = buffers.positions[(base + v) * 2]!;
          const py = buffers.positions[(base + v) * 2 + 1]!;
          expect(withinTolerance(px, expectedRing.positions[v * 2]!, VERTEX)).toBe(true);
          expect(withinTolerance(py, expectedRing.positions[v * 2 + 1]!, VERTEX)).toBe(true);
          for (let b = 0; b < 3; b += 1) {
            const actual = buffers.bary[(base + v) * 3 + b]!;
            expect(withinTolerance(actual, expectedRing.bary[v * 3 + b]!, VERTEX)).toBe(true);
          }
        }
        base += expectedRing.vertexCount;
      }
    });
  }
});
