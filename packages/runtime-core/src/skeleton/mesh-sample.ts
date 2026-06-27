import type { MeshAttachment, SkeletonDocument } from '@marionette/format/types';
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
  const mesh = resolveMesh(document, skinName, slotName, attachmentName);
  const animation = document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);

  const slotIndex = pose.slotNames.indexOf(slotName);
  const slotBoneIndex = slotIndex >= 0 ? pose.slotBoneIndices[slotIndex]! : -1;
  const vertexCount = skinMeshInto(mesh, pose, slotBoneIndex, out);

  const prepared = getPreparedAnimation(pose, animation);
  const channel = findDeformChannel(prepared.deformChannels, skinName, slotName, attachmentName);
  if (channel !== null) {
    // componentCount == 2 * vertexCount (the validated DEFORM_OFFSET_LENGTH invariant), so the lanes
    // sampled here are exactly the lanes applyDeform reads.
    const offsets = ensureDeformScratch(pose, channel.track.componentCount);
    sampleDeformInto(channel.track, t, offsets);
    applyDeform(out, offsets, out, vertexCount);
  }
  return vertexCount;
}

function resolveMesh(
  document: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): MeshAttachment {
  const skin = document.skins.find((candidate) => candidate.name === skinName);
  const attachment = skin?.attachments[slotName]?.[attachmentName];
  if (attachment === undefined) {
    throw new MeshAttachmentError('not-found', skinName, slotName, attachmentName);
  }
  if (attachment.type !== 'mesh') {
    throw new MeshAttachmentError('not-a-mesh', skinName, slotName, attachmentName);
  }
  return attachment;
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
