import { parseDocument } from '@marionette/format';
import type { CurveType, Skin, SkeletonDocument } from '@marionette/format/types';
import { DocumentInvariantError } from '../command/errors';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneEntity,
  BoneTimelineSet,
  DocState,
  KeyframeEntity,
  KeyframeValue,
  SlotEntity,
  SlotTimelineSet,
} from '../model/doc-state';
import { makeAttachmentFrame, makeKeyframe } from '../model/doc-state';
import type { AnimationId, BoneId, IdFactory, SlotId } from '../model/ids';
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

  // Animations (WP-1.5) become first-class: mint an AnimationId per animation and a KeyframeId per
  // keyframe/frame, and resolve bone/slot NAME keys to ids. The validator already guaranteed every
  // timeline key resolves (ANIM_BONE_UNKNOWN / ANIM_SLOT_UNKNOWN), so resolveId is total here; a failure
  // is corrupt input and throws (symmetry with export).
  const animations = new Map<AnimationId, AnimationEntity>();
  for (const [animName, animation] of Object.entries(document.animations)) {
    const id = ids.mint('animation');
    const bonesTracks = new Map<BoneId, BoneTimelineSet>();
    for (const [boneName, timelines] of Object.entries(animation.bones)) {
      const boneId = resolveId(boneName, boneNameToId, 'animation bone');
      bonesTracks.set(boneId, loadBoneTimelines(timelines, ids));
    }
    const slotTracks = new Map<SlotId, SlotTimelineSet>();
    for (const [slotName, timelines] of Object.entries(animation.slots)) {
      const slotId = resolveId(slotName, slotNameToId, 'animation slot');
      slotTracks.set(slotId, loadSlotTimelines(timelines, ids));
    }
    animations.set(id, {
      id,
      name: animName,
      duration: animation.duration,
      bones: bonesTracks,
      slots: slotTracks,
    });
  }

  return {
    formatVersion: document.formatVersion,
    name: document.name,
    bones,
    boneOrder,
    slots,
    slotOrder,
    attachments,
    animations,
    preserved: {
      atlas: document.atlas,
      extraSkins,
    },
  };
}

// Mint a KeyframeId per format keyframe (the format value already matches the internal KeyframeValue
// shape by channel; makeKeyframe deep-copies it so the model never aliases the parsed document).
function loadKeyframes(
  frames: ReadonlyArray<{ time: number; value: KeyframeValue; curve: CurveType }> | undefined,
  ids: IdFactory,
): KeyframeEntity[] {
  if (frames === undefined) return [];
  return frames.map((frame) =>
    makeKeyframe(ids.mint('keyframe'), frame.time, frame.value, frame.curve),
  );
}

function loadAttachmentFrames(
  frames: ReadonlyArray<{ time: number; name: string | null }> | undefined,
  ids: IdFactory,
): AttachmentFrameEntity[] {
  if (frames === undefined) return [];
  return frames.map((frame) => makeAttachmentFrame(ids.mint('keyframe'), frame.time, frame.name));
}

function loadBoneTimelines(
  timelines: SkeletonDocument['animations'][string]['bones'][string],
  ids: IdFactory,
): BoneTimelineSet {
  return {
    rotate: loadKeyframes(timelines.rotate, ids),
    translate: loadKeyframes(timelines.translate, ids),
    scale: loadKeyframes(timelines.scale, ids),
    shear: loadKeyframes(timelines.shear, ids),
  };
}

function loadSlotTimelines(
  timelines: SkeletonDocument['animations'][string]['slots'][string],
  ids: IdFactory,
): SlotTimelineSet {
  return {
    color: loadKeyframes(timelines.color, ids),
    attachment: loadAttachmentFrames(timelines.attachment, ids),
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
