import { Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { MeshAttachment } from '@marionette/format/types';

// Mesh attachment rendering (WP-2.11 renderer slice; handoff section 8.5). A mesh attachment renders as
// a PixiJS Mesh whose geometry is built ONCE per scene: the uvs and triangles are constant per document
// (the runtime never re-triangulates, phase-2-rigging.md WP-2.1), and only the position buffer changes
// per frame. The positions are the runtime-core solve output (skinMeshInto / sampleMeshVertices) written
// IN PLACE into the geometry's live Float32Array, so a steady-state animated frame allocates nothing:
// write the lanes, mark the buffer dirty, done.
//
// Space convention: the solve emits WORLD-space vertex positions, so the Mesh display object keeps an
// identity local transform (unlike the sprite path, which decomposes the bone world matrix onto the
// sprite). Both land in the same world coordinates the host camera maps to the screen.
//
// UV convention: mesh uvs are normalized [0, 1] over the attachment's texture (the resolver returns a
// frame-cropped view onto the atlas page, region-textures.ts). PixiJS v8 maps mesh geometry uvs through
// texture.textureMatrix when the texture has a non-trivial frame (BatchableMesh), so the same uvs are
// correct for the 1x1 white placeholder and for a real frame-cropped atlas texture.

// One mesh attachment bound to its live display object. `positions` is the geometry's OWN position
// buffer (2 world-space lanes per vertex): the per-frame solve writes into it directly, then
// markMeshPositionsDirty uploads it. `texture` is the host-resolved region texture or null (placeholder).
export interface MeshDisplay {
  readonly mesh: MeshAttachment;
  readonly texture: Texture | null;
  readonly display: Mesh;
  readonly positions: Float32Array;
  readonly vertexCount: number;
}

// Build the display object for one mesh attachment. Runs at scene build only (never per frame): it
// allocates the geometry buffers (positions zeroed; the first render fills them from the solve) and the
// Mesh. The caller owns adding it to a layer and destroying it on scene teardown; the TEXTURE is a view
// over the host's atlas page and must never be destroyed here (region-textures.ts lifecycle).
export function createMeshDisplay(mesh: MeshAttachment, texture: Texture | null): MeshDisplay {
  const vertexCount = mesh.uvs.length / 2;
  const geometry = new MeshGeometry({
    positions: new Float32Array(vertexCount * 2),
    uvs: Float32Array.from(mesh.uvs),
    indices: Uint32Array.from(mesh.triangles),
  });
  const display = new Mesh({ geometry, texture: texture ?? Texture.WHITE });
  display.visible = false;
  return { mesh, texture, display, positions: geometry.positions, vertexCount };
}

// Mark the position buffer dirty after the solve wrote new lanes, so the renderer re-uploads it. This is
// the whole per-frame GPU-side cost of a deforming mesh: one buffer update, zero allocation.
export function markMeshPositionsDirty(entry: MeshDisplay): void {
  entry.display.geometry.getBuffer('aPosition').update();
}
