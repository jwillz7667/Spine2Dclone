import type { DocumentReadModel } from '../model/read-model';
import { DocumentInvariantError } from './errors';

// Dev/test invariant guard (command-history Section 3.5). Verifies the bone graph, the slot graph, and
// the slot draw order: every parent/bone reference resolves, parents precede children in boneOrder (the
// format invariant the world-pass relies on), slotOrder is a permutation of the slot ids, every
// attachment is owned by an existing slot, and a non-null setup attachment resolves in that slot's
// attachment map. It does NOT check name uniqueness, because that is an export-only contract (D9): a
// transient name collision is a legal internal state. The round-trip harness runs this after every do
// and every undo. A violation is a typed DocumentInvariantError, never a thrown string. Never called
// in a render loop.
export function assertInvariants(model: DocumentReadModel): void {
  const bones = model.bones(); // in boneOrder
  const indexById = new Map<string, number>();
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (bone) indexById.set(bone.id, i);
  }
  for (let i = 0; i < bones.length; i += 1) {
    const bone = bones[i];
    if (!bone || bone.parent === null) continue;
    const parentIndex = indexById.get(bone.parent);
    if (parentIndex === undefined) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" references parent ${bone.parent}, which does not exist`,
      );
    }
    if (parentIndex >= i) {
      throw new DocumentInvariantError(
        `bone "${bone.name}" must appear after its parent (parents precede children)`,
      );
    }
  }

  // Slot graph (WP-1.2): every slot rides an existing bone (a BoneId reference, stable across rename),
  // and slotOrder is a permutation of the slot ids (the draw order lists each slot exactly once).
  const slots = model.slots(); // in slotOrder
  const boneIds = new Set(bones.map((bone) => bone.id));
  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) {
      throw new DocumentInvariantError(`slot ${slot.id} appears more than once in slotOrder`);
    }
    slotIds.add(slot.id);
    if (!boneIds.has(slot.bone)) {
      throw new DocumentInvariantError(
        `slot "${slot.name}" rides bone ${slot.bone}, which does not exist`,
      );
    }

    // Every attachment is owned by this slot (model.attachments only returns a slot's own), and a
    // non-null setup attachment must name one of them.
    const attachmentNames = new Set(model.attachments(slot.id).map((att) => att.name));
    if (slot.attachment !== null && !attachmentNames.has(slot.attachment)) {
      throw new DocumentInvariantError(
        `slot "${slot.name}" sets attachment "${slot.attachment}", which it does not define`,
      );
    }
  }

  // No orphan attachments: every attachment's owning SlotId must be a live slot (the snapshot is the
  // only read surface that enumerates attachments across all slots).
  for (const att of model.snapshot().attachments) {
    if (!slotIds.has(att.slotId)) {
      throw new DocumentInvariantError(
        `attachment "${att.name}" is owned by slot ${att.slotId}, which does not exist`,
      );
    }
  }
}
