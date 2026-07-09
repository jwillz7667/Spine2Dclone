import type { AttachmentEntity, MeshAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import type { DocumentReadModel } from '../model/read-model';

// Shared linked-mesh resolution for the PP-D10 authoring commands (CreateLinkedMesh, UnlinkMesh). It mirrors
// the format validator's resolveGeometrySource (validate/mesh.ts) over the LIVE model: a linked mesh reuses a
// PARENT mesh's geometry, resolved by walking the parent chain (a linked mesh may point at another linked
// mesh) within the SAME slot across skins until it reaches a real mesh, a missing/non-geometry attachment, or
// a cycle. The default skin's name is 'default' (its attachments live on model.attachments); a named skin is
// resolved by name.

export const DEFAULT_SKIN_NAME = 'default';

// Look up an attachment by (skin name, slot, attachment name) in the live model. The default skin reads the
// slot's default attachments; a named skin reads its own attachment map. Returns undefined when the skin,
// slot, or attachment does not resolve.
export function attachmentInSkin(
  model: DocumentReadModel,
  skinName: string,
  slotId: SlotId,
  attachmentName: string,
): AttachmentEntity | undefined {
  if (skinName === DEFAULT_SKIN_NAME) return model.getAttachment(slotId, attachmentName);
  const skin = model.skins().find((s) => s.name === skinName);
  return skin?.attachments.get(slotId)?.get(attachmentName);
}

// The outcome of walking a (linked-)mesh parent chain: the root mesh, or why it failed.
export type GeometrySource =
  | { readonly kind: 'mesh'; readonly mesh: MeshAttachmentEntity }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'cycle' };

// Walk the parent chain from (skinName, slotId, attachmentName) to the root mesh, mirroring the format's
// resolveGeometrySource exactly (same slot; skin follows the linked mesh's `skin ?? currentSkin`; a revisited
// node is a cycle). The walk is bounded by the visited set. Callers start it at the attachment they are
// resolving (a linked mesh being created starts at its PARENT; an unlink starts at the linked mesh itself).
export function resolveGeometrySource(
  model: DocumentReadModel,
  skinName: string,
  slotId: SlotId,
  attachmentName: string,
): GeometrySource {
  const visited = new Set<string>();
  let currentSkin = skinName;
  let currentName = attachmentName;
  for (;;) {
    const key = `${currentSkin} ${currentName}`;
    if (visited.has(key)) return { kind: 'cycle' };
    visited.add(key);
    const attachment = attachmentInSkin(model, currentSkin, slotId, currentName);
    if (attachment === undefined) return { kind: 'missing' };
    if (attachment.kind === 'mesh') return { kind: 'mesh', mesh: attachment };
    if (attachment.kind !== 'linkedmesh') return { kind: 'invalid' };
    currentSkin = attachment.skin ?? currentSkin;
    currentName = attachment.parent;
  }
}
