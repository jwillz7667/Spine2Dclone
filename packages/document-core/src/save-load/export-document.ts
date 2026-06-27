import { computeContentHash, CURRENT_FORMAT_VERSION, validateDocument } from '@marionette/format';
import type {
  Attachment,
  Bone,
  RegionAttachment,
  Skin,
  SkeletonDocument,
  Slot,
} from '@marionette/format/types';
import { DocumentInvariantError, ExportValidationError } from '../command/errors';
import type { AttachmentEntity } from '../model/doc-state';
import type { DocumentReadModel } from '../model/read-model';

// Project the internal model to the format (command-history Section 7.1): resolve BoneId references to
// bone names, emit boneOrder as the ordered bones[] and slotOrder as the ordered slots[], materialize
// the default skin from the editable attachments, carry the preserved non-default skins / animations /
// atlas, stamp CURRENT_FORMAT_VERSION, then set `hash` LAST via computeContentHash from packages/format
// (hash ownership lives there, never duplicated here). Finally run validateDocument on its own output,
// so the bone-ordering invariant, slot/attachment resolution, and name uniqueness (the export-only D9
// contract) are enforced here; an invalid projection throws ExportValidationError (LAW 3: fail loudly),
// never ships silently.
function resolveName(id: string, idToName: ReadonlyMap<string, string>, what: string): string {
  const name = idToName.get(id);
  if (name === undefined) {
    throw new DocumentInvariantError(`${what} references ${id}, which does not exist`);
  }
  return name;
}

function attachmentToFormat(att: AttachmentEntity): Attachment {
  if (att.kind === 'region') {
    const region: RegionAttachment = {
      type: 'region',
      path: att.path,
      x: att.x,
      y: att.y,
      rotation: att.rotation,
      scaleX: att.scaleX,
      scaleY: att.scaleY,
      width: att.width,
      height: att.height,
      color: att.color,
    };
    return region;
  }
  return att.value;
}

export function exportDocument(model: DocumentReadModel): SkeletonDocument {
  const orderedBones = model.bones(); // in boneOrder
  const boneIdToName = new Map<string, string>();
  for (const bone of orderedBones) boneIdToName.set(bone.id, bone.name);

  const bones: Bone[] = orderedBones.map((bone) => ({
    name: bone.name,
    // A dangling parent id is corrupt internal state (a command bug). Fail loudly here rather than
    // silently coercing it to a root, which export is THE place to surface (command-history 7.1).
    parent: bone.parent === null ? null : resolveName(bone.parent, boneIdToName, 'bone parent'),
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  }));

  // Slots emit in slotOrder (the setup-pose draw order). `bone` resolves the BoneId to the bone's
  // current name; darkColor is omitted when null (single-color tint), per exactOptionalPropertyTypes.
  const orderedSlots = model.slots(); // in slotOrder
  const slots: Slot[] = orderedSlots.map((slot) => ({
    name: slot.name,
    bone: resolveName(slot.bone, boneIdToName, 'slot bone'),
    color: slot.color,
    attachment: slot.attachment,
    blendMode: slot.blendMode,
    ...(slot.darkColor !== null ? { darkColor: slot.darkColor } : {}),
  }));

  // The default skin is materialized from the editable attachments, keyed by each slot's CURRENT name.
  // A slot with no attachments contributes no entry (an empty per-slot record is normalized to absent).
  const defaultAttachments: Record<string, Record<string, Attachment>> = {};
  for (const slot of orderedSlots) {
    const atts = model.attachments(slot.id);
    if (atts.length === 0) continue;
    const record: Record<string, Attachment> = {};
    for (const att of atts) record[att.name] = attachmentToFormat(att);
    defaultAttachments[slot.name] = record;
  }
  const preserved = model.preserved();
  const skins: Skin[] = [
    { name: 'default', attachments: defaultAttachments },
    ...preserved.extraSkins,
  ];

  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones,
    slots,
    skins,
    animations: { ...preserved.animations },
    atlas: preserved.atlas,
  };
  const withHash: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

  const report = validateDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new ExportValidationError(report);
  }
  return report.document;
}
