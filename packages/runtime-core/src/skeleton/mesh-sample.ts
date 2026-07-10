import type {
  Attachment,
  LinkedMeshAttachment,
  MeshAttachment,
  RGBA,
  Sequence,
  SkeletonDocument,
} from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../math/affine';
import type { Mat2x3 } from '../math/affine';
import { applyDeform, solveSkin, solveSkinUnweighted } from '../solve';
import { findSegmentIndex, segmentComponent, segmentFraction } from './curve';
import type { Pose } from './pose';
import type { PreparedDeformChannel, PreparedTrack } from './prepared';
import { AnimationNotFoundError, getPreparedAnimation } from './sample';

// Why a mesh attachment could not be sampled. `not-found` = no attachment under (skin, slot, name);
// `not-a-mesh` = the attachment exists but is a different kind (region/clipping/...). A discriminated
// typed error (never a bare string) so a caller can branch on the reason and report the exact triple.
export type MeshAttachmentErrorReason = 'not-found' | 'not-a-mesh';

export class MeshAttachmentError extends Error {
  readonly reason: MeshAttachmentErrorReason;
  readonly skinName: string;
  readonly slotName: string;
  readonly attachmentName: string;

  constructor(
    reason: MeshAttachmentErrorReason,
    skinName: string,
    slotName: string,
    attachmentName: string,
  ) {
    super(`mesh attachment ${reason}: ${skinName}/${slotName}/${attachmentName}`);
    this.name = 'MeshAttachmentError';
    this.reason = reason;
    this.skinName = skinName;
    this.slotName = slotName;
    this.attachmentName = attachmentName;
  }
}

// Skin a mesh into world space using the pose's CURRENT bone world matrices (solve-order step 5, before
// deform). It assumes the pose's world pass is current (e.g. just after sampleSkeleton). Weighted
// meshes (those carrying a `bones` gather manifest) skin through pose.world directly: pose.world is the
// packed per-bone world matrices indexed by GLOBAL bone index, and the weighted vertex stream stores
// global bone indices (ADR-0002), so no separate gather buffer is needed. Unweighted meshes ride a
// single slot bone, whose world matrix is read from pose.world at slotBoneIndex. Writes 2 world-space
// lanes per logical vertex into `out` (sized >= 2 * vertexCount by the caller) and returns the vertex
// count. Allocation-free for the weighted path; the unweighted path reads one 6-tuple per call.
export function skinMeshInto(
  mesh: MeshAttachment,
  pose: Pose,
  slotBoneIndex: number,
  out: Float32Array,
): number {
  const vertexCount = mesh.uvs.length / 2;
  const weighted = mesh.bones !== undefined && mesh.bones.length > 0;
  if (weighted) {
    solveSkin(mesh, pose.world, out);
  } else {
    const offset = slotBoneIndex * MAT2X3_STRIDE;
    const w = pose.world;
    const slotBoneWorld: Mat2x3 = [
      w[offset]!,
      w[offset + 1]!,
      w[offset + 2]!,
      w[offset + 3]!,
      w[offset + 4]!,
      w[offset + 5]!,
    ];
    solveSkinUnweighted(mesh, slotBoneWorld, out);
  }
  return vertexCount;
}

// Sample a mesh attachment's FINAL world-space vertices at time t (solve-order step 5: skin, then add
// deform). It REUSES a pose that was just produced by sampleSkeleton(document, animationId, t, pose):
// the bone world matrices it reads are that solve's output, so it never re-solves the skeleton. Steps:
// resolve the mesh (typed error if missing or not a mesh), skin it (weighted via pose.world, else the
// slot bone), then sample the (skin, slot, attachment) deform timeline at t into the pose's reused
// scratch and ADD it on top (post-skin, world-space, additive, ADR-0003 section 9). A mesh with no
// deform track is left as the pure skin result. Writes 2 lanes per vertex into `out` and returns the
// vertex count (= uvs.length / 2). Allocation-free in steady state (the deform scratch grows once per
// new larger mesh, keyed on its offset count).
export function sampleMeshVertices(
  document: SkeletonDocument,
  animationId: string,
  t: number,
  pose: Pose,
  skinName: string,
  slotName: string,
  attachmentName: string,
  out: Float32Array,
): number {
  // A plain mesh resolves to itself; a linked mesh (ADR-0009 section 2, ADR-0011 section 1) resolves its
  // geometry through the parent chain and its deform key through the `timelines`-sharing chain.
  const resolved = resolveMeshGeometry(document, skinName, slotName, attachmentName);
  const animation = document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);

  const slotIndex = pose.slotNames.indexOf(slotName);
  const slotBoneIndex = slotIndex >= 0 ? pose.slotBoneIndices[slotIndex]! : -1;
  const vertexCount = skinMeshInto(resolved.geometry, pose, slotBoneIndex, out);

  const prepared = getPreparedAnimation(pose, animation);
  const channel = findDeformChannel(
    prepared.deformChannels,
    resolved.deformSkin,
    resolved.deformSlot,
    resolved.deformName,
  );
  if (channel !== null) {
    // componentCount == 2 * vertexCount (the validated DEFORM_OFFSET_LENGTH invariant), so the lanes
    // sampled here are exactly the lanes applyDeform reads.
    const offsets = ensureDeformScratch(pose, channel.track.componentCount);
    sampleDeformInto(channel.track, t, offsets);
    applyDeform(out, offsets, out, vertexCount);
  }
  return vertexCount;
}

// The geometry mesh to skin plus the (skin, slot, name) key whose deform timeline applies (ADR-0011
// section 1). For a plain mesh this is the identity resolution (itself, its own key); for a linked mesh it
// is the parent-chain geometry root and the `timelines`-sharing deform source.
interface ResolvedMeshGeometry {
  readonly geometry: MeshAttachment;
  readonly deformSkin: string;
  readonly deformSlot: string;
  readonly deformName: string;
}

function lookupAttachment(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): Attachment | undefined {
  const skin = document.skins.find((candidate) => candidate.name === skinName);
  return skin?.attachments[slotName]?.[attachmentName];
}

// The linked-mesh chain is guaranteed acyclic by the validator (LINKED_MESH_CYCLE); this bound is a
// defensive stop so an unvalidated document cannot spin forever (mirroring the solve's other lenience).
const MAX_LINKED_MESH_DEPTH = 256;

function resolveMeshGeometry(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): ResolvedMeshGeometry {
  const attachment = lookupAttachment(document, skinName, slotName, attachmentName);
  if (attachment === undefined) {
    throw new MeshAttachmentError('not-found', skinName, slotName, attachmentName);
  }
  if (attachment.type === 'mesh') {
    return { geometry: attachment, deformSkin: skinName, deformSlot: slotName, deformName: attachmentName };
  }
  if (attachment.type !== 'linkedmesh') {
    throw new MeshAttachmentError('not-a-mesh', skinName, slotName, attachmentName);
  }

  // Deform source: walk while the current node is a linked mesh that SHARES its parent's timelines,
  // stopping at the first node with its own timeline (a real mesh, or a linked mesh with timelines false).
  // The slot is shared across the chain; only the skin and name change per hop.
  let deformSkin = skinName;
  let deformName = attachmentName;
  let deformNode: LinkedMeshAttachment | null = attachment;
  for (let hop = 0; hop < MAX_LINKED_MESH_DEPTH && deformNode !== null && deformNode.timelines; hop += 1) {
    const parentSkin = deformNode.skin ?? deformSkin;
    const parentName = deformNode.parent;
    const parent = lookupAttachment(document, parentSkin, slotName, parentName);
    if (parent === undefined) {
      throw new MeshAttachmentError('not-found', parentSkin, slotName, parentName);
    }
    deformSkin = parentSkin;
    deformName = parentName;
    deformNode = parent.type === 'linkedmesh' ? parent : null;
  }

  // Geometry source: walk the parent chain (regardless of timelines) to the root mesh.
  let geometrySkin = skinName;
  let node: Attachment = attachment;
  for (let hop = 0; hop < MAX_LINKED_MESH_DEPTH && node.type === 'linkedmesh'; hop += 1) {
    const parentSkin = node.skin ?? geometrySkin;
    const parent = lookupAttachment(document, parentSkin, slotName, node.parent);
    if (parent === undefined) {
      throw new MeshAttachmentError('not-found', parentSkin, slotName, node.parent);
    }
    geometrySkin = parentSkin;
    node = parent;
  }
  if (node.type !== 'mesh') {
    // The chain never reached a real mesh (a validator would have rejected this as LINKED_MESH_PARENT_
    // INVALID or _CYCLE); report the origin attachment as not-a-mesh rather than skinning a non-geometry.
    throw new MeshAttachmentError('not-a-mesh', skinName, slotName, attachmentName);
  }
  return { geometry: node, deformSkin, deformSlot: slotName, deformName };
}

// The public render-mesh resolution (ADR-0009 section 2, ADR-0011 section 1): the SOURCE geometry a
// renderer skins plus the ORIGIN attachment's own render properties. For a plain mesh `source` is the mesh
// itself and path/color/size/sequence are its own; for a linked mesh `source` is the resolved parent-chain
// root mesh (uvs/triangles/vertices) while path/color/size are the linked mesh's own and `sequence` is
// undefined (a linked mesh never carries one, ADR-0009 section 3). The WORLD positions are NOT here: they
// come from skinMeshInto (setup) / sampleMeshVertices (animated), which resolve the same chain, so a
// renderer never re-derives the skinning math. This is the single public twin of the geometry walk in
// resolveMeshGeometry above; runtime-web and render-preview consume it instead of each keeping a private
// copy (the two used to duplicate this walk). NO PixiJS, NO DOM: pure document lookup, ports to C#/GDScript.
export interface ResolvedRenderMesh {
  readonly source: MeshAttachment;
  readonly path: string;
  readonly color: RGBA;
  readonly width: number;
  readonly height: number;
  readonly sequence: Sequence | undefined;
}

// Resolve a mesh or linked-mesh attachment (the already-resolved object the caller holds while iterating a
// skin, plus the skin/slot that own it) to its render geometry and properties. Returns null ONLY when a
// linked chain fails to reach a real mesh, which a validated document never does (LINKED_MESH_* validators);
// callers skip a null exactly as they skip a non-drawable attachment. Unlike the internal resolveMeshGeometry
// (which throws a MeshAttachmentError for the sampling path), this render accessor is null-returning to match
// the renderers' existing skip-on-missing contract. Allocation-free apart from the returned record.
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
      sequence: attachment.sequence,
    };
  }

  const linked: LinkedMeshAttachment = attachment;
  // Walk the parent chain (same slot; skin follows each node's optional `skin`) to the root mesh, mirroring
  // resolveMeshGeometry's GEOMETRY walk exactly.
  let currentSkin = skinName;
  let node: Attachment = linked;
  for (let hop = 0; hop < MAX_LINKED_MESH_DEPTH && node.type === 'linkedmesh'; hop += 1) {
    const parentSkin = node.skin ?? currentSkin;
    const parent = lookupAttachment(document, parentSkin, slotName, node.parent);
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
    sequence: undefined,
  };
}

function findDeformChannel(
  channels: readonly PreparedDeformChannel[],
  skinName: string,
  slotName: string,
  attachmentName: string,
): PreparedDeformChannel | null {
  for (let i = 0; i < channels.length; i += 1) {
    const channel = channels[i]!;
    if (
      channel.skin === skinName &&
      channel.slot === slotName &&
      channel.attachment === attachmentName
    ) {
      return channel;
    }
  }
  return null;
}

// Interpolate every offset lane of a deform track at t into the reused scratch (component-wise per the
// keyframe curve, with the same single-period clamp as the skeleton sampler). Allocation-free: writes
// into the caller's buffer.
function sampleDeformInto(track: PreparedTrack, t: number, out: Float64Array): void {
  const i = findSegmentIndex(track.times, track.keyCount, t);
  const f = segmentFraction(track, i, t);
  const componentCount = track.componentCount;
  for (let c = 0; c < componentCount; c += 1) {
    out[c] = segmentComponent(track, i, f, c);
  }
}

// Return the pose's deform scratch, growing it only when a larger mesh is sampled than any before (a
// one-time, size-keyed allocation; steady-state sampling reuses the buffer with zero allocation).
function ensureDeformScratch(pose: Pose, length: number): Float64Array {
  const scratch = pose.deformScratch;
  if (scratch.offsets.length < length) {
    scratch.offsets = new Float64Array(length);
  }
  return scratch.offsets;
}
