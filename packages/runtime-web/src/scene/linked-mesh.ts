import type {
  Attachment,
  LinkedMeshAttachment,
  MeshAttachment,
  RGBA,
  SkeletonDocument,
} from '@marionette/format/types';

// Linked-mesh geometry resolution for rendering (ADR-0009 section 2, ADR-0011 section 1). A `linkedmesh`
// attachment has NO geometry of its own: it reuses a PARENT mesh's uvs, triangles, and vertex/weight stream
// while carrying its OWN atlas region (`path`), color, and size. To draw one, the renderer builds the mesh
// display's geometry from the parent chain's ROOT mesh (uvs + triangles, and the mesh runtime-core skins at
// setup) but binds the linked mesh's OWN texture and tints with its OWN color.
//
// The WORLD vertex positions are NOT computed here: they come from runtime-core (sampleMeshVertices resolves
// the same chain internally for the animated path, skinMeshInto over the resolved source for setup), so the
// renderer never re-derives the skinning math. This walk mirrors runtime-core's internal resolveMeshGeometry
// GEOMETRY walk EXACTLY (mesh-sample.ts): parent `parent` on the SAME slot in skin `node.skin ?? currentSkin`,
// to the first real `mesh`. It is the twin of packages/render-preview/src/linked-mesh.ts (the two renderers
// resolve identically; the packages cannot share code and runtime-core does not export this resolver). The
// chain is validator-guaranteed acyclic (LINKED_MESH_CYCLE); MAX_DEPTH is a defensive stop.

const MAX_DEPTH = 256;

// The mesh geometry to skin plus the origin attachment's own render properties. For a plain mesh, `source`
// is the mesh itself and path/color/size are its own; for a linked mesh, `source` is the resolved parent
// root mesh while path/color/size are the linked mesh's own.
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

// Resolve a mesh or linked-mesh attachment (identified by its object plus the skin/slot that hold it) to the
// geometry to skin and the render properties to draw with. `attachment` is the already-resolved object (the
// caller has it in hand while iterating a skin); `skinName` is the skin that holds it (the resolution start).
// Returns null only when a linked chain fails to reach a real mesh, which a validated document never does.
export function resolveRenderMesh(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachment: MeshAttachment | LinkedMeshAttachment,
): ResolvedRenderMesh | null {
  if (attachment.type === 'mesh') {
    return {
      source: attachment,
      path: attachment.path,
      color: attachment.color,
      width: attachment.width,
      height: attachment.height,
    };
  }

  const linked: LinkedMeshAttachment = attachment;
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
