import type { AttachmentEntity, BoneEntity, SlotEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { DocumentReadModel } from '../model/read-model';
import type { BoneGeometry } from './create-bone.command';

// Bone copy/paste/duplicate support (PP-D7). A COPIED bone subtree is captured as a plain, document-
// INDEPENDENT value (a BoneSubtreeClip): no internal ids, parent links expressed as INDICES within the
// clip, so it survives arbitrary edits between copy and paste (a source bone deleted after copy does not
// strand the clip) and is safe to hold in the ephemeral clipboard store (never the document, LAW 1). The
// PasteBoneSubtreeCommand (paste-bone-subtree.command.ts) turns a clip into fresh id-minted entities. This
// module owns the two pure pieces worth a unit test: the CAPTURE projection and the unique-name helper.

// One slot riding a captured bone: its value fields (minus its id and its bone reference, both re-minted /
// re-linked on paste) plus its default-skin attachments held VERBATIM. Attachments are addressed by
// (SlotId, name); the paste mints a fresh SlotId, so attachment names never collide and are copied as-is.
// Only the DEFAULT skin's attachments travel with the slot, mirroring the DeleteBone cascade (which also
// removes only the default-skin attachments); named-skin attachments key off the ORIGINAL SlotId and are
// intentionally not duplicated.
export interface ClipSlot {
  readonly name: string;
  readonly color: SlotEntity['color'];
  readonly darkColor: SlotEntity['darkColor'];
  readonly attachment: string | null;
  readonly blendMode: SlotEntity['blendMode'];
  readonly attachments: readonly AttachmentEntity[];
}

// One captured bone: its setup geometry (everything but identity and parent), the index of its parent
// WITHIN the clip (null only for the clip root, whose real parent is outside the captured subtree), and
// the slots riding it. `parentIndex` is always a smaller index than this bone's own (the capture emits in
// boneOrder, parents before children), so a single forward pass rebuilds the tree on paste.
export interface ClipBone {
  readonly geometry: BoneGeometry;
  readonly parentIndex: number | null;
  readonly slots: readonly ClipSlot[];
}

// A captured bone subtree: the bones in pre-order (root first), each with its riding slots. Plain data,
// no internal ids, so it is stable across edits and safe to store in the ephemeral clipboard.
export interface BoneSubtreeClip {
  readonly bones: readonly ClipBone[];
}

// Collect a bone plus all its descendants. boneOrder is parent-before-child, so a single forward pass
// closes over the subtree: a bone joins if its parent is already in the set. Mirrors DeleteBone's walk.
function collectSubtree(ordered: readonly BoneEntity[], root: BoneId): Set<BoneId> {
  const subtree = new Set<BoneId>([root]);
  for (const bone of ordered) {
    if (bone.parent !== null && subtree.has(bone.parent)) subtree.add(bone.id);
  }
  return subtree;
}

// Project a bone's setup transform (everything but identity and parent) into a BoneGeometry value copy,
// the shape CreateBone/PasteBoneSubtree build a new BoneEntity from.
function boneGeometryOf(bone: BoneEntity): BoneGeometry {
  return {
    name: bone.name,
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  };
}

// Project the subtree rooted at `rootId` into a document-independent clip, or null when the root does not
// resolve. Pure: reads only the model's frozen read hand-outs (bones/slots/attachments already return
// deep-frozen value copies, so the clip never aliases live state). The bones are emitted in boneOrder
// (parents before children), which the paste relies on to rebuild the tree with one forward pass.
export function captureBoneSubtree(
  model: DocumentReadModel,
  rootId: BoneId,
): BoneSubtreeClip | null {
  const ordered = model.bones(); // in boneOrder
  if (!ordered.some((bone) => bone.id === rootId)) return null;
  const subtree = collectSubtree(ordered, rootId);

  const members = ordered.filter((bone) => subtree.has(bone.id));
  const clipIndexById = new Map<BoneId, number>();
  members.forEach((bone, index) => clipIndexById.set(bone.id, index));

  const allSlots = model.slots();
  const bones: ClipBone[] = members.map((bone) => {
    // The clip root's real parent is outside the subtree, so it becomes a null parent (re-linked to the
    // paste target). Every other member's parent is in the subtree (that is why the member joined), so it
    // resolves to a clip index.
    const parentIndex =
      bone.id === rootId || bone.parent === null ? null : (clipIndexById.get(bone.parent) ?? null);
    const slots: ClipSlot[] = allSlots
      .filter((slot) => slot.bone === bone.id)
      .map((slot) => ({
        name: slot.name,
        color: slot.color,
        darkColor: slot.darkColor,
        attachment: slot.attachment,
        blendMode: slot.blendMode,
        attachments: model.attachments(slot.id),
      }));
    return { geometry: boneGeometryOf(bone), parentIndex, slots };
  });
  return { bones };
}

// The suffix a duplicate's name carries, matching the repo convention (DuplicateAnimation uses
// `${name}_copy`). A collision disambiguates with an ascending integer: `base_copy`, `base_copy2`, ...
// `taken` accumulates as the caller assigns names within one paste, so sibling copies never collide with
// each other either. Names are unique only for good UX; the format validator is the export-time authority
// (bone/slot name uniqueness is not an internal invariant, so a transient duplicate would still be legal).
export function uniqueDuplicateName(taken: ReadonlySet<string>, base: string): string {
  const first = `${base}_copy`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${base}_copy${n}`)) n += 1;
  return `${base}_copy${n}`;
}
