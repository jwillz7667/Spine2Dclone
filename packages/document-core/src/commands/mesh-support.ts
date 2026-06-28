import type { RGBA } from '@marionette/format/types';
import type { CommandContext } from '../command/command';
import { CommandTargetMissingError, MeshTopologyLockedError } from '../command/errors';
import type { MeshAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';

// Shared types and guards for the WP-2.1 mesh-edit commands. Geometry (vertices/triangles/uvs/edges) is
// computed EDITOR-side (triangulation, marching-squares, Douglas-Peucker need the source bitmap and a
// triangulation library that must not enter document-core/runtime-core); these commands receive the
// already-computed arrays as data and are the document-mutation layer only.

// The fields GenerateMeshFromRegion supplies to build an UNWEIGHTED mesh from a region (the swap keeps
// the region's `path`, so it is not repeated here). `vertices` is the flat [x,y,...] slot-bone-space
// stream; `bones` is omitted (unweighted, per format section 6). `edges` is the optional wireframe.
export interface MeshInit {
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly hullLength: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
  readonly edges?: readonly number[];
  readonly vertices: readonly number[];
}

// The full geometry an auto grid-fill / auto perimeter-trace recomputes for an existing mesh (interior
// vertices + triangulation, editor-computed). `edges` is optional; when omitted the command CLEARS the
// wireframe, because the regenerated topology invalidates any prior edge indices.
export interface MeshAutoFill {
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly hullLength: number;
  readonly vertices: readonly number[];
  readonly edges?: readonly number[];
}

// Require an existing MESH attachment at (slotId, name); otherwise a typed CommandTargetMissingError (the
// attachment is absent or is a region/preserved attachment). The returned entity is a frozen value copy
// (getAttachment hand-out), so reading its arrays for a memento is safe.
export function requireMesh(
  ctx: CommandContext,
  kind: string,
  slotId: SlotId,
  name: string,
): MeshAttachmentEntity {
  const att = ctx.mutate.getAttachment(slotId, name);
  if (att === undefined || att.kind !== 'mesh') {
    throw new CommandTargetMissingError(kind, `${slotId}/${name}`);
  }
  return att;
}

// Topology-lock guard (TASK-2.1.8): require an existing mesh AND reject the edit when the mesh is
// WEIGHTED (its `bones` manifest is present) or carries deform keyframes. Add/Delete vertex and the
// auto-fill commands change vertex count/order, which would silently misalign the weighted encoding
// (WP-2.3) and deform offset arrays (WP-2.9). The weight check is LIVE today (a weighted mesh fires the
// lock); the deform check is INERT until WP-2.9 adds deform tracks to the model (there is no deform state
// to scan yet), and is wired here so it activates the moment that state exists. Thrown BEFORE any
// mutation, so a locked edit changes nothing. MOVE vertex does not call this (count/order stable).
export function assertTopologyEditable(
  ctx: CommandContext,
  kind: string,
  slotId: SlotId,
  name: string,
): MeshAttachmentEntity {
  const mesh = requireMesh(ctx, kind, slotId, name);
  if (mesh.bones !== undefined) {
    throw new MeshTopologyLockedError(slotId, name, 'weighted');
  }
  if (hasDeformKeyframes()) {
    throw new MeshTopologyLockedError(slotId, name, 'deformed');
  }
  return mesh;
}

// Whether the model holds any deform keyframe for this attachment. WP-2.9 introduces deform timelines;
// until then no deform state exists, so this is constant false. Kept as a seam so TASK-2.1.8's deform
// half of the lock activates by editing ONLY this function once the deform model lands.
function hasDeformKeyframes(): boolean {
  return false;
}
