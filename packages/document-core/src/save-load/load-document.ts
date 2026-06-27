import { parseDocument } from '@marionette/format';
import type { Skin, SkeletonDocument } from '@marionette/format/types';
import { DocumentInvariantError } from '../command/errors';
import type { AttachmentEntity, BoneEntity, DocState, SlotEntity } from '../model/doc-state';
import type { BoneId, IdFactory, SlotId } from '../model/ids';
import { buildLoadedDocument, type Document } from './document';
import type { DocumentEnvironment } from './environment';

// Resolve a validated format document into internal DocState: mint a BoneId per bone (in format order),
// a SlotId per slot (in slots[] order), resolve NAME references to ids, build the editable attachment
// map from the default skin, and carry the non-default skins / animations / atlas verbatim. The format
// validator already guaranteed unique names, parent-before-child ordering, and slot/attachment
// resolution, so the resolutions below are total; a failure is corrupt input and throws (symmetry with
// export).
function resolveId<T extends string>(
  name: string,
  nameToId: ReadonlyMap<string, T>,
  what: string,
): T {
  const id = nameToId.get(name);
  if (id === undefined) {
    throw new DocumentInvariantError(`${what} references "${name}", which does not exist`);
  }
  return id;
}

function formatToDocState(document: SkeletonDocument, ids: IdFactory): DocState {
  // Bones.
  const boneNameToId = new Map<string, BoneId>();
  const boneOrder: BoneId[] = [];
  for (const bone of document.bones) {
    const id = ids.mint('bone');
    boneNameToId.set(bone.name, id);
    boneOrder.push(id);
  }
  const bones = new Map<BoneId, BoneEntity>();
  document.bones.forEach((bone, index) => {
    const id = boneOrder[index]!;
    bones.set(id, {
      id,
      name: bone.name,
      parent: bone.parent === null ? null : resolveId(bone.parent, boneNameToId, 'bone parent'),
      length: bone.length,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
      shearX: bone.shearX,
      shearY: bone.shearY,
      transformMode: bone.transformMode,
    });
  });

  // Slots (in slots[] order, which becomes slotOrder, the setup-pose draw order).
  const slotNameToId = new Map<string, SlotId>();
  const slotOrder: SlotId[] = [];
  for (const slot of document.slots) {
    const id = ids.mint('slot');
    slotNameToId.set(slot.name, id);
    slotOrder.push(id);
  }
  const slots = new Map<SlotId, SlotEntity>();
  document.slots.forEach((slot, index) => {
    const id = slotOrder[index]!;
    slots.set(id, {
      id,
      name: slot.name,
      bone: resolveId(slot.bone, boneNameToId, 'slot bone'),
      color: slot.color,
      darkColor: slot.darkColor ?? null,
      attachment: slot.attachment,
      blendMode: slot.blendMode,
    });
  });

  // The default skin's attachments become first-class; every OTHER skin round-trips verbatim. The
  // default skin always exists (the validator's SKIN_DEFAULT_MISSING guarantees it).
  const defaultSkin = document.skins.find((skin) => skin.name === 'default');
  const extraSkins: Skin[] = document.skins.filter((skin) => skin.name !== 'default');
  const attachments = new Map<SlotId, Map<string, AttachmentEntity>>();
  if (defaultSkin) {
    for (const [slotName, slotAttachments] of Object.entries(defaultSkin.attachments)) {
      const slotId = resolveId(slotName, slotNameToId, 'default-skin slot');
      const inner = new Map<string, AttachmentEntity>();
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (attachment.type === 'region') {
          inner.set(attachmentName, {
            kind: 'region',
            name: attachmentName,
            path: attachment.path,
            x: attachment.x,
            y: attachment.y,
            rotation: attachment.rotation,
            scaleX: attachment.scaleX,
            scaleY: attachment.scaleY,
            width: attachment.width,
            height: attachment.height,
            color: attachment.color,
          });
        } else {
          inner.set(attachmentName, { kind: 'preserved', name: attachmentName, value: attachment });
        }
      }
      if (inner.size > 0) attachments.set(slotId, inner);
    }
  }

  return {
    formatVersion: document.formatVersion,
    name: document.name,
    bones,
    boneOrder,
    slots,
    slotOrder,
    attachments,
    preserved: {
      animations: document.animations,
      atlas: document.atlas,
      extraSkins,
    },
  };
}

// Load a document from format JSON (command-history Section 7.2). Validates at the boundary via
// packages/format and throws a typed FormatValidationError on malformed input, constructing NO
// Document (LAW 3: fail loudly, do not partially mutate). Runtimes treat the hash as opaque, so
// verifyHash is false; the editor verifies it explicitly on its own load path. Load is NOT a command
// and is NOT undoable: it returns a fresh Document with empty history.
export function loadDocument(json: unknown, env: DocumentEnvironment): Document {
  const document = parseDocument(json, { verifyHash: false });
  const ids = env.createIds();
  const state = formatToDocState(document, ids);
  return buildLoadedDocument(state, ids, env);
}
