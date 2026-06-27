import { computeContentHash, CURRENT_FORMAT_VERSION, validateDocument } from '@marionette/format';
import type {
  Animation,
  Attachment,
  Bone,
  BoneTimelines,
  RegionAttachment,
  Skin,
  SkeletonDocument,
  Slot,
  SlotTimelines,
} from '@marionette/format/types';
import { DocumentInvariantError, ExportValidationError } from '../command/errors';
import type {
  AnimationEntity,
  AttachmentEntity,
  BoneTimelineSet,
  KeyframeEntity,
  SlotTimelineSet,
} from '../model/doc-state';
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

// Project a rotate keyframe to the format shape `{ time, value: { angle }, curve }`. The `in` narrowing
// is the export-boundary fail-loud check: a mis-shaped value is corrupt internal state (a command bug).
function rotateKeyframes(channel: readonly KeyframeEntity[]): NonNullable<BoneTimelines['rotate']> {
  return channel.map((kf) => {
    if (!('angle' in kf.value)) {
      throw new DocumentInvariantError('a rotate keyframe carries a non-rotate value');
    }
    return { time: kf.time, value: { angle: kf.value.angle }, curve: kf.curve };
  });
}

// Project a vec2 channel (translate/scale/shear) to `{ time, value: { x, y }, curve }`.
function vec2Keyframes(
  channel: readonly KeyframeEntity[],
): NonNullable<BoneTimelines['translate']> {
  return channel.map((kf) => {
    if (!('x' in kf.value)) {
      throw new DocumentInvariantError('a translate/scale/shear keyframe carries a non-vec2 value');
    }
    return { time: kf.time, value: { x: kf.value.x, y: kf.value.y }, curve: kf.curve };
  });
}

// Project a slot color channel to `{ time, value: { color }, curve }`.
function colorKeyframes(channel: readonly KeyframeEntity[]): NonNullable<SlotTimelines['color']> {
  return channel.map((kf) => {
    if (!('color' in kf.value)) {
      throw new DocumentInvariantError('a color keyframe carries a non-color value');
    }
    const { r, g, b, a } = kf.value.color;
    return { time: kf.time, value: { color: { r, g, b, a } }, curve: kf.curve };
  });
}

// Project a bone timeline set, emitting only the non-empty channels (the format channels are optional;
// an empty channel is OMITTED rather than emitted as undefined or [], per exactOptionalPropertyTypes and
// the slot/bone export style).
function boneTimelinesToFormat(set: BoneTimelineSet): BoneTimelines {
  return {
    ...(set.rotate.length > 0 ? { rotate: rotateKeyframes(set.rotate) } : {}),
    ...(set.translate.length > 0 ? { translate: vec2Keyframes(set.translate) } : {}),
    ...(set.scale.length > 0 ? { scale: vec2Keyframes(set.scale) } : {}),
    ...(set.shear.length > 0 ? { shear: vec2Keyframes(set.shear) } : {}),
  };
}

function slotTimelinesToFormat(set: SlotTimelineSet): SlotTimelines {
  return {
    ...(set.attachment.length > 0
      ? { attachment: set.attachment.map((frame) => ({ time: frame.time, name: frame.name })) }
      : {}),
    ...(set.color.length > 0 ? { color: colorKeyframes(set.color) } : {}),
  };
}

// Project one animation entity to the format Animation, resolving BoneId/SlotId to current names and
// dropping bone/slot entries whose every channel is empty. Phase 2 (ADR-0004) made the format Animation
// `{ duration, bones, slots, ik, transform, deform }`; the document-core model does not yet author
// ik/transform/deform timelines (they land with WP-2.6/2.7/2.9), so empty records are emitted to satisfy
// the now-required keys. When those WPs add the model entities, this projects them here.
function animationToFormat(
  animation: AnimationEntity,
  boneIdToName: ReadonlyMap<string, string>,
  slotIdToName: ReadonlyMap<string, string>,
): Animation {
  const bones: Record<string, BoneTimelines> = {};
  for (const [boneId, set] of animation.bones) {
    const timelines = boneTimelinesToFormat(set);
    if (Object.keys(timelines).length === 0) continue;
    bones[resolveName(boneId, boneIdToName, 'animation bone')] = timelines;
  }
  const slots: Record<string, SlotTimelines> = {};
  for (const [slotId, set] of animation.slots) {
    const timelines = slotTimelinesToFormat(set);
    if (Object.keys(timelines).length === 0) continue;
    slots[resolveName(slotId, slotIdToName, 'animation slot')] = timelines;
  }
  return { duration: animation.duration, bones, slots, ik: {}, transform: {}, deform: {} };
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
  const slotIdToName = new Map<string, string>();
  for (const slot of orderedSlots) slotIdToName.set(slot.id, slot.name);
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

  // Animations are name-keyed on disk (the record key is the animation name) and order-insignificant.
  // model.animations() is id-sorted (deterministic); a duplicate name cannot be represented in the
  // record, so it is corrupt internal state surfaced here (fail loud), matching bone/slot name uniqueness.
  const animations: Record<string, Animation> = {};
  for (const animation of model.animations()) {
    if (animation.name in animations) {
      throw new DocumentInvariantError(`animation name "${animation.name}" is not unique`);
    }
    animations[animation.name] = animationToFormat(animation, boneIdToName, slotIdToName);
  }

  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones,
    slots,
    skins,
    // Phase 2 (ADR-0004): the format requires these arrays. The model does not yet author constraints
    // (WP-2.6/2.7 add the entities); empty arrays satisfy the contract and round-trip losslessly until
    // then. extraSkins already round-trips non-default skins verbatim.
    ikConstraints: [],
    transformConstraints: [],
    animations,
    atlas: preserved.atlas,
  };
  const withHash: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

  const report = validateDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new ExportValidationError(report);
  }
  return report.document;
}
