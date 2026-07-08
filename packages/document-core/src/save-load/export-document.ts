import { computeContentHash, CURRENT_FORMAT_VERSION, validateDocument } from '@marionette/format';
import type {
  Animation,
  Attachment,
  Bone,
  BoneTimelines,
  DeformTimelines,
  DrawOrderKeyframe,
  EventKeyframe,
  IkConstraint,
  IkFrame,
  Keyframe,
  MeshAttachment,
  RegionAttachment,
  Skin,
  SkeletonDocument,
  Slot,
  SlotTimelines,
  TransformConstraint,
  TransformFrame,
} from '@marionette/format/types';
import { DocumentInvariantError, ExportValidationError } from '../command/errors';
import type {
  AnimationEntity,
  AttachmentEntity,
  BoneTimelineSet,
  DeformKeyframeEntity,
  DeformSkinKey,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  SkinEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from '../model/doc-state';
import type { DocumentReadModel } from '../model/read-model';

// Project the internal model to the format (command-history Section 7.1): resolve id references to names,
// emit boneOrder as bones[] and slotOrder as slots[], materialize the default skin from the editable
// attachments plus the named skins, project the constraints and the ik/transform/deform animation
// timelines, stamp CURRENT_FORMAT_VERSION, then set `hash` LAST via computeContentHash (hash ownership
// lives in packages/format). Finally run validateDocument on its own output so the bone-ordering invariant,
// resolution, and name uniqueness (the export-only D9 contract) are enforced here; an invalid projection
// throws ExportValidationError (LAW 3: fail loudly), never ships silently.
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
  if (att.kind === 'mesh') {
    // Project the editable mesh BACK to the format MeshAttachment, copying the geometry arrays to fresh
    // mutable arrays. `edges`/`bones` are emitted only when present (omitted for an unweighted mesh with
    // no wireframe), per exactOptionalPropertyTypes, so a loaded mesh exports deep-equal.
    const mesh: MeshAttachment = {
      type: 'mesh',
      path: att.path,
      uvs: [...att.uvs],
      triangles: [...att.triangles],
      hullLength: att.hullLength,
      width: att.width,
      height: att.height,
      color: att.color,
      vertices: [...att.vertices],
      ...(att.edges !== undefined ? { edges: [...att.edges] } : {}),
      ...(att.bones !== undefined ? { bones: [...att.bones] } : {}),
    };
    return mesh;
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
// an empty channel is OMITTED rather than emitted as undefined or [], per exactOptionalPropertyTypes).
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

// Project an IK timeline (Keyframe<IkFrame>[]). bendPositive and mix are both carried; the runtime samples
// bendPositive stepped regardless of the curve (ADR-0003 section 7).
function ikFramesToFormat(frames: readonly IkKeyframeEntity[]): Keyframe<IkFrame>[] {
  return frames.map((kf) => ({
    time: kf.time,
    value: { mix: kf.mix, bendPositive: kf.bendPositive },
    curve: kf.curve,
  }));
}

// Project a transform timeline (Keyframe<TransformFrame>[]). Only the present (non-undefined) mix channels
// are emitted, per the format's optional-channel shape (exactOptionalPropertyTypes); an absent channel
// keeps its base value at solve time (ADR-0003).
function transformFramesToFormat(
  frames: readonly TransformKeyframeEntity[],
): Keyframe<TransformFrame>[] {
  return frames.map((kf) => {
    const value: TransformFrame = {
      ...(kf.mixRotate !== undefined ? { mixRotate: kf.mixRotate } : {}),
      ...(kf.mixX !== undefined ? { mixX: kf.mixX } : {}),
      ...(kf.mixY !== undefined ? { mixY: kf.mixY } : {}),
      ...(kf.mixScaleX !== undefined ? { mixScaleX: kf.mixScaleX } : {}),
      ...(kf.mixScaleY !== undefined ? { mixScaleY: kf.mixScaleY } : {}),
      ...(kf.mixShearY !== undefined ? { mixShearY: kf.mixShearY } : {}),
    };
    return { time: kf.time, value, curve: kf.curve };
  });
}

function deformFramesToFormat(
  frames: readonly DeformKeyframeEntity[],
): Keyframe<{ offsets: number[] }>[] {
  return frames.map((kf) => ({
    time: kf.time,
    value: { offsets: [...kf.offsets] },
    curve: kf.curve,
  }));
}

// Project one animation entity to the format Animation, resolving id keys to current names and dropping
// bone/slot entries whose every channel is empty. The ik/transform/deform records are emitted from the
// model's timelines (ADR-0004 made them required format keys).
function animationToFormat(
  animation: AnimationEntity,
  boneIdToName: ReadonlyMap<string, string>,
  slotIdToName: ReadonlyMap<string, string>,
  ikIdToName: ReadonlyMap<string, string>,
  transformIdToName: ReadonlyMap<string, string>,
  skinIdToName: ReadonlyMap<string, string>,
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
  const ik: Record<string, Keyframe<IkFrame>[]> = {};
  for (const [constraintId, frames] of animation.ik) {
    if (frames.length === 0) continue;
    ik[resolveName(constraintId, ikIdToName, 'animation ik constraint')] = ikFramesToFormat(frames);
  }
  const transform: Record<string, Keyframe<TransformFrame>[]> = {};
  for (const [constraintId, frames] of animation.transform) {
    if (frames.length === 0) continue;
    transform[resolveName(constraintId, transformIdToName, 'animation transform constraint')] =
      transformFramesToFormat(frames);
  }
  const deform: DeformTimelines = {};
  for (const [skinKey, bySlot] of animation.deform) {
    const skinName = deformSkinKeyToName(skinKey, skinIdToName);
    const bySlotOut: Record<string, Record<string, Keyframe<{ offsets: number[] }>[]>> = {};
    for (const [slotId, byName] of bySlot) {
      const byNameOut: Record<string, Keyframe<{ offsets: number[] }>[]> = {};
      for (const [attachmentName, frames] of byName) {
        if (frames.length === 0) continue;
        byNameOut[attachmentName] = deformFramesToFormat(frames);
      }
      if (Object.keys(byNameOut).length > 0) {
        bySlotOut[resolveName(slotId, slotIdToName, 'deform slot')] = byNameOut;
      }
    }
    if (Object.keys(bySlotOut).length > 0) deform[skinName] = bySlotOut;
  }
  // Draw-order and event timelines are carried VERBATIM (ADR-0008, PP-D9 owns their authoring). They are
  // REQUIRED format collections, so they always emit (empty when the animation reorders nothing / fires
  // nothing). Arrays are copied so the exported document never aliases the model's frozen arrays.
  const drawOrder: DrawOrderKeyframe[] = animation.drawOrder.map((key) => ({
    time: key.time,
    offsets: key.offsets.map((offset) => ({ slot: offset.slot, offset: offset.offset })),
  }));
  const events: EventKeyframe[] = animation.events.map((key) => ({
    time: key.time,
    name: key.name,
    ...(key.int !== undefined ? { int: key.int } : {}),
    ...(key.float !== undefined ? { float: key.float } : {}),
    ...(key.string !== undefined ? { string: key.string } : {}),
  }));
  return { duration: animation.duration, bones, slots, ik, transform, deform, drawOrder, events };
}

// Resolve a deform skin key to its on-disk name: the literal 'default' passes through; a SkinId resolves
// to that skin's CURRENT name.
function deformSkinKeyToName(
  skinKey: DeformSkinKey,
  skinIdToName: ReadonlyMap<string, string>,
): string {
  return skinKey === 'default' ? 'default' : resolveName(skinKey, skinIdToName, 'deform skin');
}

function ikConstraintToFormat(
  c: IkConstraintEntity,
  boneIdToName: ReadonlyMap<string, string>,
): IkConstraint {
  return {
    name: c.name,
    bones: c.bones.map((boneId) => resolveName(boneId, boneIdToName, 'ik constraint bone')),
    target: resolveName(c.target, boneIdToName, 'ik constraint target'),
    mix: c.mix,
    bendPositive: c.bendPositive,
  };
}

function transformConstraintToFormat(
  c: TransformConstraintEntity,
  boneIdToName: ReadonlyMap<string, string>,
): TransformConstraint {
  return {
    name: c.name,
    bones: c.bones.map((boneId) => resolveName(boneId, boneIdToName, 'transform constraint bone')),
    target: resolveName(c.target, boneIdToName, 'transform constraint target'),
    mixRotate: c.mixRotate,
    mixX: c.mixX,
    mixY: c.mixY,
    mixScaleX: c.mixScaleX,
    mixScaleY: c.mixScaleY,
    mixShearY: c.mixShearY,
    offsetRotation: c.offsetRotation,
    offsetX: c.offsetX,
    offsetY: c.offsetY,
    offsetScaleX: c.offsetScaleX,
    offsetScaleY: c.offsetScaleY,
    offsetShearY: c.offsetShearY,
  };
}

// Materialize a named skin's attachments to the format record, keyed by each owning slot's CURRENT name.
function skinToFormat(skin: SkinEntity, slotIdToName: ReadonlyMap<string, string>): Skin {
  const attachments: Record<string, Record<string, Attachment>> = {};
  for (const [slotId, inner] of skin.attachments) {
    if (inner.size === 0) continue;
    const record: Record<string, Attachment> = {};
    for (const [name, att] of inner) record[name] = attachmentToFormat(att);
    attachments[resolveName(slotId, slotIdToName, 'skin slot')] = record;
  }
  return { name: skin.name, attachments };
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
  const skinIdToName = new Map<string, string>();
  for (const skin of model.skins()) skinIdToName.set(skin.id, skin.name);
  const skins: Skin[] = [
    { name: 'default', attachments: defaultAttachments },
    ...model.skins().map((skin) => skinToFormat(skin, slotIdToName)),
  ];

  // Constraints emit in their stored solve order (ADR-0003: all IK, then all transform).
  const ikIdToName = new Map<string, string>();
  for (const c of model.ikConstraints()) ikIdToName.set(c.id, c.name);
  const transformIdToName = new Map<string, string>();
  for (const c of model.transformConstraints()) transformIdToName.set(c.id, c.name);
  const ikConstraints: IkConstraint[] = model
    .ikConstraints()
    .map((c) => ikConstraintToFormat(c, boneIdToName));
  const transformConstraints: TransformConstraint[] = model
    .transformConstraints()
    .map((c) => transformConstraintToFormat(c, boneIdToName));

  // Animations are name-keyed on disk (the record key is the animation name) and order-insignificant.
  // model.animations() is id-sorted (deterministic); a duplicate name cannot be represented in the
  // record, so it is corrupt internal state surfaced here (fail loud), matching bone/slot name uniqueness.
  const animations: Record<string, Animation> = {};
  for (const animation of model.animations()) {
    if (animation.name in animations) {
      throw new DocumentInvariantError(`animation name "${animation.name}" is not unique`);
    }
    animations[animation.name] = animationToFormat(
      animation,
      boneIdToName,
      slotIdToName,
      ikIdToName,
      transformIdToName,
      skinIdToName,
    );
  }

  // Document-level events and the optional metadata block are carried VERBATIM from preserved content
  // (ADR-0008; PP-D9 owns event-definition authoring). `events` is REQUIRED (empty when the rig defines
  // none); `metadata` is emitted only when present, per exactOptionalPropertyTypes.
  const preserved = model.preserved();
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones,
    slots,
    skins,
    ikConstraints,
    transformConstraints,
    events: preserved.events.map((event) => ({
      name: event.name,
      ...(event.int !== undefined ? { int: event.int } : {}),
      ...(event.float !== undefined ? { float: event.float } : {}),
      ...(event.string !== undefined ? { string: event.string } : {}),
      ...(event.audio !== undefined
        ? {
            audio: {
              path: event.audio.path,
              volume: event.audio.volume,
              balance: event.audio.balance,
            },
          }
        : {}),
    })),
    animations,
    atlas: preserved.atlas,
    ...(preserved.metadata !== undefined ? { metadata: preserved.metadata } : {}),
  };
  const withHash: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

  const report = validateDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new ExportValidationError(report);
  }
  return report.document;
}
