import type { Attachment, Skin } from '@marionette/format';
import type { Diagnostics } from '../diagnostics';
import { asRecord, ptr, readRequiredString, readStringArrayField, type JsonRecord } from '../read';
import { convertAttachment } from './attachments';

// Convert the Spine 4.x `skins` array. Each entry is { name, attachments, bones, ik, transform, path }:
// `attachments` maps slot name -> attachment name -> attachment; `bones` is the skin-scoped bone list;
// ik/transform/path are skin-scoped constraint-name lists, which our format merges into a single
// `constraints` list. A `physics` skin-scope list (Spine 4.2) is surfaced as unsupported (we do not
// convert physics constraints) rather than referenced. The document must contain a skin named "default";
// convertDocument injects an empty one when the input has none, so this converter never fabricates it.
export function convertSkins(skins: readonly unknown[], base: string, diag: Diagnostics): Skin[] {
  const out: Skin[] = [];
  for (const [index, raw] of skins.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    if (name === undefined) continue;

    const attachments = convertSkinAttachments(rec, path, diag);
    const bones = readStringArrayField(rec, 'bones', path, diag);
    const constraints = readSkinConstraints(rec, path, diag);

    const skin: Skin = {
      name,
      attachments,
      ...(bones.length > 0 ? { bones } : {}),
      ...(constraints.length > 0 ? { constraints } : {}),
    };
    out.push(skin);
  }
  return out;
}

function convertSkinAttachments(
  rec: JsonRecord,
  base: string,
  diag: Diagnostics,
): Record<string, Record<string, Attachment>> {
  const attachments: Record<string, Record<string, Attachment>> = {};
  const attachmentsValue = rec['attachments'];
  if (attachmentsValue === undefined) return attachments;
  const attachmentsRec = asRecord(attachmentsValue, ptr(base, 'attachments'), diag);
  if (attachmentsRec === undefined) return attachments;

  for (const [slotName, slotValue] of Object.entries(attachmentsRec)) {
    const slotPath = ptr(ptr(base, 'attachments'), slotName);
    const slotRec = asRecord(slotValue, slotPath, diag);
    if (slotRec === undefined) continue;
    const slotAttachments: Record<string, Attachment> = {};
    for (const [attachmentName, attachmentValue] of Object.entries(slotRec)) {
      const attachment = convertAttachment(
        attachmentName,
        attachmentValue,
        ptr(slotPath, attachmentName),
        diag,
      );
      if (attachment !== undefined) slotAttachments[attachmentName] = attachment;
    }
    attachments[slotName] = slotAttachments;
  }
  return attachments;
}

// Merge the skin-scoped ik/transform/path constraint-name lists into one `constraints` list (our format's
// single scoping list). A `physics` list is surfaced as unsupported and its names are not scoped.
function readSkinConstraints(rec: JsonRecord, base: string, diag: Diagnostics): string[] {
  const constraints = [
    ...readStringArrayField(rec, 'ik', base, diag),
    ...readStringArrayField(rec, 'transform', base, diag),
    ...readStringArrayField(rec, 'path', base, diag),
  ];
  if (rec['physics'] !== undefined) {
    diag.warn(
      'physics-constraint',
      ptr(base, 'physics'),
      'skin-scoped physics constraints are not converted',
    );
  }
  return constraints;
}
