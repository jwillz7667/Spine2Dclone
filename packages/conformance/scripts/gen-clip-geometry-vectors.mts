import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClippingAttachment } from '@marionette/format/types';
import { clipTriangleList, makeClipBuffers, prepareClipping } from '@marionette/runtime-core';

// Generator for the clip-geometry cross-language golden vector (PP-B2, ADR-0012 section 3). It runs the
// runtime-core Sutherland-Hodgman clipper over a fixed set of (polygon, triangle-list) inputs and records the
// expected output rings (positions + barycentrics), the convexity decision, and the per-ring source triangle.
// Unity C# and Godot GDScript load this file and assert their own clipper reproduces it (positions/bary within
// the VERTEX tolerance; ringCount, per-ring vertexCount and sourceTri and the convexity flag EXACT). A TS
// regeneration test (clip-geometry-vectors.test.ts) recomputes and asserts the committed values still match,
// so the file cannot silently drift from the implementation. Regenerating is a deliberate, reviewed act:
//
//   PATH="$HOME/.nvm/versions/node/v22.13.1/bin:$PATH" pnpm --filter @marionette/conformance tsx \
//     scripts/gen-clip-geometry-vectors.mts

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

interface CaseInput {
  readonly name: string;
  readonly polygon: number[];
  readonly triVerts: number[];
  readonly triIndices: number[];
}

// The committed input cases. The polygon is given directly in world space (identity bone), so it is passed as
// both the clip attachment's vertices (for prepareClipping's convexity/ear-clip decision) and the world
// polygon (for clipTriangleList). Cases cover: a triangle wholly inside a convex polygon, wholly outside, a
// straddling triangle, the same straddle against a reversed-winding (CW) polygon, a triangle across a concave
// L-shape notch, and a two-triangle input against a convex polygon.
const CASES: CaseInput[] = [
  {
    name: 'convex-square-inside',
    polygon: [0, 0, 2, 0, 2, 2, 0, 2],
    triVerts: [0.5, 0.5, 1.5, 0.5, 1, 1.5],
    triIndices: [0, 1, 2],
  },
  {
    name: 'convex-square-outside',
    polygon: [0, 0, 2, 0, 2, 2, 0, 2],
    triVerts: [3, 3, 4, 3, 3, 4],
    triIndices: [0, 1, 2],
  },
  {
    name: 'convex-square-straddle',
    polygon: [0, 0, 2, 0, 2, 2, 0, 2],
    triVerts: [1, 1, 3, 1, 1, 3],
    triIndices: [0, 1, 2],
  },
  {
    name: 'convex-square-cw-straddle',
    polygon: [0, 0, 0, 2, 2, 2, 2, 0],
    triVerts: [1, 1, 3, 1, 1, 3],
    triIndices: [0, 1, 2],
  },
  {
    name: 'concave-L-across-notch',
    polygon: [0, 0, 4, 0, 4, 1, 1, 1, 1, 4, 0, 4],
    triVerts: [0.5, 0.5, 3.5, 0.5, 0.5, 3.5],
    triIndices: [0, 1, 2],
  },
  {
    name: 'convex-square-two-triangles',
    polygon: [0, 0, 3, 0, 3, 3, 0, 3],
    triVerts: [-1, -1, 2, -1, 2, 2, -1, 2],
    triIndices: [0, 1, 2, 0, 2, 3],
  },
];

function toCase(input: CaseInput) {
  const clip: ClippingAttachment = {
    type: 'clipping',
    end: 'end',
    vertices: input.polygon,
    color: WHITE,
  };
  const prepared = prepareClipping(clip);
  const worldPolygon = new Float64Array(input.polygon);
  const buffers = makeClipBuffers();
  const result = clipTriangleList(
    prepared,
    worldPolygon,
    new Float64Array(input.triVerts),
    input.triIndices,
    buffers,
  );

  const rings = [];
  let base = 0;
  for (let r = 0; r < result.ringCount; r += 1) {
    const count = buffers.ringVertexCount[r]!;
    const positions: number[] = [];
    const bary: number[] = [];
    for (let v = 0; v < count; v += 1) {
      positions.push(buffers.positions[(base + v) * 2]!, buffers.positions[(base + v) * 2 + 1]!);
      bary.push(
        buffers.bary[(base + v) * 3]!,
        buffers.bary[(base + v) * 3 + 1]!,
        buffers.bary[(base + v) * 3 + 2]!,
      );
    }
    rings.push({ sourceTri: buffers.ringSourceTri[r]!, vertexCount: count, positions, bary });
    base += count;
  }

  return {
    name: input.name,
    polygon: input.polygon,
    convex: prepared.convex,
    triVerts: input.triVerts,
    triIndices: input.triIndices,
    expected: { ringCount: result.ringCount, rings },
  };
}

const doc = {
  note:
    'Clip-geometry cross-language golden vectors (PP-B2, ADR-0012 section 3). THE corpus that runtime-core ' +
    '(TS), Marionette.Runtime.Core (C#), and the GDScript runtime MUST all reproduce for the Sutherland-Hodgman ' +
    'triangle clip. Each case gives a clip polygon (world space, also used as the local polygon for the ' +
    'convexity/ear-clip decision) and a triangle-list input; `expected` is the clipped output the runtime-core ' +
    'clipper produces: ringCount, and per ring the sourceTri index, vertexCount, flat positions, and per-vertex ' +
    'barycentrics (with respect to the source triangle). A native runtime loads this file and asserts its ' +
    'clipper reproduces every ring: positions and barycentrics within the VERTEX tolerance, and ringCount, ' +
    'vertexCount, sourceTri, and the convex flag EXACT. Generated FROM runtime-core by ' +
    'scripts/gen-clip-geometry-vectors.mts and drift-guarded by clip-geometry-vectors.test.ts.',
  cases: CASES.map(toCase),
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'cross-language', 'clip-geometry-vectors.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
process.stdout.write(`wrote ${outPath} (${doc.cases.length} cases)\n`);
