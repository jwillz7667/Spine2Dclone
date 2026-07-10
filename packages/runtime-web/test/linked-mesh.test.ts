import { describe, expect, it } from 'vitest';
import type {
  LinkedMeshAttachment,
  MeshAttachment,
  SkeletonDocument,
} from '@marionette/format/types';
import { resolveRenderMesh, SkeletonView } from '@marionette/runtime-web';

// A linked mesh (ADR-0009 section 2) reuses a PARENT mesh's geometry but carries its own atlas region and
// color. These tests prove runtime-web resolves the source geometry through resolveRenderMesh (mirroring
// runtime-core) and builds a regular mesh display from it, with the linked mesh's own render properties.

const baseMesh: MeshAttachment = {
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

const linkedMesh: LinkedMeshAttachment = {
  type: 'linkedmesh',
  path: 'skinBTex',
  parent: 'base',
  timelines: true,
  width: 40,
  height: 40,
  color: { r: 0.5, g: 0.25, b: 0.75, a: 1 },
};

// One bone, one slot 'limb' whose active attachment is the LINKED mesh; the parent mesh 'base' lives on the
// same slot (a linked mesh resolves its parent on the SAME slot).
function linkedDoc(): SkeletonDocument {
  return {
    formatVersion: '0.4.0',
    name: 'linked',
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
    skins: [{ name: 'default', attachments: { limb: { base: baseMesh, skinB: linkedMesh } } }],
    ikConstraints: [],
    transformConstraints: [],
    events: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'baseTex',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
            {
              name: 'skinBTex',
              x: 64,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
}

describe('runtime-web linked meshes', () => {
  it('resolves a linked mesh to the parent geometry with its own path and color', () => {
    const resolved = resolveRenderMesh(linkedDoc(), 'default', 'limb', linkedMesh);

    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe(baseMesh); // parent geometry
    expect(resolved!.path).toBe('skinBTex'); // linked mesh's own region
    expect(resolved!.color).toBe(linkedMesh.color); // linked mesh's own color

    // A plain mesh resolves to itself.
    const plain = resolveRenderMesh(linkedDoc(), 'default', 'limb', baseMesh);
    expect(plain!.source).toBe(baseMesh);
    expect(plain!.path).toBe('baseTex');
  });

  it('renders the linked-mesh slot as a mesh using the parent vertex count and its own tint', () => {
    const view = new SkeletonView();
    view.sync(linkedDoc());
    const scene = view.describe();

    const limb = scene.meshes.find((m) => m.slot === 'limb');

    expect(limb).toBeDefined();
    expect(limb!.attachment).toBe('skinB');
    // Vertex count is the PARENT mesh's (4), proving the display uses the resolved source geometry.
    expect(limb!.vertexCount).toBe(4);
    // Tint is the LINKED mesh's own color (0.5, 0.25, 0.75) x white slot color, packed.
    expect(limb!.tint).toBe((0x80 << 16) | (0x40 << 8) | 0xbf);

    view.destroy();
  });
});
