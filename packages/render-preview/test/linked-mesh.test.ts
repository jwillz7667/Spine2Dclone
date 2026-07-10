import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type {
  LinkedMeshAttachment,
  MeshAttachment,
  SkeletonDocument,
} from '@marionette/format/types';
import { renderFrame, resolveRenderMesh, type AtlasPixelSource } from '@marionette/render-preview';
import { decode, pixelAt } from './helpers';

// A linked mesh (ADR-0009 section 2) reuses a PARENT mesh's geometry (uvs/triangles/vertices) but carries
// its OWN atlas region and color. These tests prove render-preview (a) resolves a linked mesh to the parent
// mesh geometry through resolveRenderMesh (mirroring runtime-core), and (b) draws it as a regular mesh with
// the linked mesh's own texture, not the parent's.

// One bone, one slot 'limb' with TWO attachments: a source mesh 'base' (region 'baseTex') and a linked mesh
// 'skinB' (parent 'base', its OWN region 'skinBTex'). The slot's active attachment is the LINKED mesh.
function linkedMeshDoc(): unknown {
  const baseMesh = {
    type: 'mesh',
    path: 'baseTex',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0],
    hullLength: 4,
    width: 40,
    height: 40,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [-20, -20, 20, -20, 20, 20, -20, 20],
  };
  return {
    formatVersion: '0.4.0',
    name: 'linked-mesh',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 40,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 'limb',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'skinB',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          limb: {
            base: baseMesh,
            skinB: {
              type: 'linkedmesh',
              path: 'skinBTex',
              parent: 'base',
              timelines: true,
              width: 40,
              height: 40,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    events: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 16,
          height: 8,
          regions: [
            {
              name: 'baseTex',
              x: 0,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
            {
              name: 'skinBTex',
              x: 8,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
          ],
        },
      ],
    },
  };
}

// A 16x8 page: left 8x8 green (baseTex), right 8x8 blue (skinBTex).
function twoRegionAtlas(): AtlasPixelSource {
  const rgba = new Uint8Array(16 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const base = (y * 16 + x) * 4;
      const blue = x >= 8;
      rgba[base] = 0;
      rgba[base + 1] = blue ? 0 : 255;
      rgba[base + 2] = blue ? 255 : 0;
      rgba[base + 3] = 255;
    }
  }
  return { pages: new Map([['atlas.png', { width: 16, height: 8, rgba }]]) };
}

describe('render-preview linked meshes', () => {
  it('resolves a linked mesh to the parent geometry with its own path and color', () => {
    const doc: SkeletonDocument = parseDocument(linkedMeshDoc(), { verifyHash: false });

    const base = doc.skins[0]!.attachments.limb!.base as MeshAttachment;
    const linked = doc.skins[0]!.attachments.limb!.skinB as LinkedMeshAttachment;

    const resolved = resolveRenderMesh(doc, 'default', 'limb', linked);
    expect(resolved).not.toBeNull();
    // Geometry is the PARENT mesh (same uvs/triangles/vertices object).
    expect(resolved!.source).toBe(base);
    // But the render path and color are the LINKED mesh's own.
    expect(resolved!.path).toBe('skinBTex');

    // A plain mesh resolves to itself.
    const plain = resolveRenderMesh(doc, 'default', 'limb', base);
    expect(plain!.source).toBe(base);
    expect(plain!.path).toBe('baseTex');
  });

  it('draws the linked mesh with its OWN texture over the parent geometry', () => {
    const png = renderFrame({
      document: linkedMeshDoc(),
      atlas: twoRegionAtlas(),
      viewport: { width: 64, height: 64, fit: 'content' },
      background: { r: 0, g: 0, b: 0, a: 0 },
    }).png;
    const center = pixelAt(decode(png), 32, 32);

    // The interior pixel is BLUE (skinBTex, the linked mesh's own region), not GREEN (the parent's region):
    // proves the linked mesh renders and samples its own texture, not the parent's.
    expect(center.b).toBeGreaterThan(200);
    expect(center.g).toBeLessThan(50);
    expect(center.a).toBe(255);
  });

  it('keeps GREEN / BLUE distinct so the texture assertion is meaningful', () => {
    // Guard against an accidental identical page: render the plain 'base' attachment and confirm it is GREEN.
    const doc = linkedMeshDoc() as { slots: { attachment: string }[] };
    doc.slots[0]!.attachment = 'base';
    const png = renderFrame({
      document: doc,
      atlas: twoRegionAtlas(),
      viewport: { width: 64, height: 64, fit: 'content' },
      background: { r: 0, g: 0, b: 0, a: 0 },
    }).png;
    const center = pixelAt(decode(png), 32, 32);

    expect(center.g).toBeGreaterThan(200);
    expect(center.b).toBeLessThan(50);
  });
});
