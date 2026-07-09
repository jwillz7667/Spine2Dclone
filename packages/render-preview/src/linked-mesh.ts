import type {
  Attachment,
  LinkedMeshAttachment,
  MeshAttachment,
  RGBA,
  SkeletonDocument,
} from '@marionette/format/types';

// Linked-mesh geometry resolution for rendering (ADR-0009 section 2, ADR-0011 section 1). A `linkedmesh`
// attachment has NO geometry of its own: it reuses a PARENT mesh's uvs, triangles, and vertex/weight stream
// while carrying its OWN atlas region (`path`), color, and size. To draw one, the renderer needs the parent
// chain's ROOT mesh (for uvs + triangles, and to skin the setup pose) but the linked mesh's OWN path and
// color (for the texture and tint).
//
// The WORLD vertex positions are NOT computed here: they come from runtime-core (sampleMeshVertices resolves
// the same chain internally for the animated path, skinMeshInto over the resolved source for the setup
// pose), so this renderer never re-derives the skinning math. This resolver only walks the parent chain to
// find the source geometry, mirroring runtime-core's internal resolveMeshGeometry GEOMETRY walk EXACTLY
// (mesh-sample.ts): parent `parent` on the SAME slot in skin `node.skin ?? currentSkin`, to the first node
// that is a real `mesh`. A linked-mesh render test asserts the world positions this feeds sampleMeshVertices
// match, proving the two resolutions agree. The chain is validator-guaranteed acyclic (LINKED_MESH_CYCLE);
// MAX_DEPTH is a defensive stop mirroring the core walk so an unvalidated document cannot spin forever.

const MAX_DEPTH = 256;

// The mesh geometry to draw plus the linked mesh's own render properties. For a plain mesh, `source` is the
// mesh itself and path/color/width/height are its own. For a linked mesh, `source` is the resolved parent
// root mesh (uvs/triangles/vertices) while path/color/width/height are the linked mesh's own.
export interface ResolvedRenderMesh {
  readonly source: MeshAttachment;
  readonly path: string;
  readonly color: RGBA;
  readonly width: number;
  readonly height: number;
}

function lookup(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): Attachment | undefined {
  const skin = document.skins.find((candidate) => candidate.name === skinName);
  return skin?.attachments[slotName]?.[attachmentName];
}

// Resolve a mesh or linked-mesh attachment to the geometry a renderer skins and the render properties it
// draws with. Returns null when the attachment is missing or is neither a mesh nor a linked mesh (a region /
// point / clipping / boundingbox has no mesh geometry), so the caller can skip it exactly as before.
export function resolveRenderMesh(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): ResolvedRenderMesh | null {
  const attachment = lookup(document, skinName, slotName, attachmentName);
  if (attachment === undefined) return null;
  if (attachment.type === 'mesh') {
    return {
      source: attachment,
      path: attachment.path,
      color: attachment.color,
      width: attachment.width,
      height: attachment.height,
    };
  }
  if (attachment.type !== 'linkedmesh') return null;

  const linked: LinkedMeshAttachment = attachment;
  // Walk the parent chain (in the same slot; skin follows each node's optional `skin`) to the root mesh.
  let currentSkin = skinName;
  let node: Attachment = linked;
  for (let hop = 0; hop < MAX_DEPTH && node.type === 'linkedmesh'; hop += 1) {
    const parentSkin = node.skin ?? currentSkin;
    const parent = lookup(document, parentSkin, slotName, node.parent);
    if (parent === undefined) return null;
    currentSkin = parentSkin;
    node = parent;
  }
  if (node.type !== 'mesh') return null;
  return {
    source: node,
    path: linked.path,
    color: linked.color,
    width: linked.width,
    height: linked.height,
  };
}
