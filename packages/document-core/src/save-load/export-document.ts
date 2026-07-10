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
  LinkedMeshAttachment,
  MeshAttachment,
  PathAttachment,
  PathConstraint,
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
  PathConstraintEntity,
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
      ...(att.sequence !== undefined ? { sequence: att.sequence } : {}),
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
      ...(att.sequence !== undefined ? { sequence: att.sequence } : {}),
    };
    return mesh;
  }
  if (att.kind === 'linkedmesh') {
    // Project the editable linked mesh BACK to the format LinkedMeshAttachment (ADR-0009 section 2). `skin`
    // is emitted only when present (default: the containing skin), per exactOptionalPropertyTypes.
    const linked: LinkedMeshAttachment = {
      type: 'linkedmesh',
      path: att.path,
      parent: att.parent,
      ...(att.skin !== undefined ? { skin: att.skin } : {}),
      timelines: att.timelines,
      width: att.width,
      height: att.height,
      color: att.color,
    };
    return linked;
  }
  if (att.kind === 'path') {
    // Project the editable UNWEIGHTED path BACK to the format PathAttachment (ADR-0011 section 1), copying
    // the control-point and arc-length arrays to fresh mutable arrays. The editable entity is unweighted,
    // so no `bones` manifest is emitted; a weighted path never becomes an editable entity (it stays
    // preserved and exports through the `att.value` fallthrough), so a loaded path exports deep-equal.
    const path: PathAttachment = {
      type: 'path',
      closed: att.closed,
      constantSpeed: att.constantSpeed,
      lengths: [...att.lengths],
      vertices: [...att.vertices],
    };
    return path;
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

// Project a per-component bone channel (translateX/Y, scaleX/Y, shearX/Y) to `{ time, value: { value },
// curve }` (Stage F2, ADR-0009 section 4.1). The `in` narrowing is the export-boundary fail-loud check.
function scalarKeyframes(
  channel: readonly KeyframeEntity[],
): NonNullable<BoneTimelines['translateX']> {
  return channel.map((kf) => {
    if (!('value' in kf.value)) {
      throw new DocumentInvariantError('a per-component bone keyframe carries a non-scalar value');
    }
    return { time: kf.time, value: { value: kf.value.value }, curve: kf.curve };
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

// Project a slot split rgb channel to `{ time, value: { rgb }, curve }` (Stage F2, ADR-0009 section 4.2).
function rgbKeyframes(channel: readonly KeyframeEntity[]): NonNullable<SlotTimelines['rgb']> {
  return channel.map((kf) => {
    if (!('rgb' in kf.value)) {
      throw new DocumentInvariantError('an rgb keyframe carries a non-rgb value');
    }
    const { r, g, b } = kf.value.rgb;
    return { time: kf.time, value: { rgb: { r, g, b } }, curve: kf.curve };
  });
}

// Project a slot split alpha channel to `{ time, value: { alpha }, curve }` (Stage F2, ADR-0009 section 4.2).
function alphaKeyframes(channel: readonly KeyframeEntity[]): NonNullable<SlotTimelines['alpha']> {
  return channel.map((kf) => {
    if (!('alpha' in kf.value)) {
      throw new DocumentInvariantError('an alpha keyframe carries a non-alpha value');
    }
    return { time: kf.time, value: { alpha: kf.value.alpha }, curve: kf.curve };
  });
}

// Project a bone timeline set, emitting only the non-empty channels (the format channels are optional;
// an empty channel is OMITTED rather than emitted as undefined or [], per exactOptionalPropertyTypes).
function boneTimelinesToFormat(set: BoneTimelineSet): BoneTimelines {
  // Every channel projects from its id-keyed keyframes, emitted only when non-empty (the format channels are
  // optional; an empty channel is OMITTED, per exactOptionalPropertyTypes). The Stage F2 (ADR-0009 section
  // 4.1) split components project through scalarKeyframes. A joint channel and its split components never
  // coexist (the format's TIMELINE_COMPONENT_CONFLICT), so at most one form per channel is non-empty.
  return {
    ...(set.rotate.length > 0 ? { rotate: rotateKeyframes(set.rotate) } : {}),
    ...(set.translate.length > 0 ? { translate: vec2Keyframes(set.translate) } : {}),
    ...(set.scale.length > 0 ? { scale: vec2Keyframes(set.scale) } : {}),
    ...(set.shear.length > 0 ? { shear: vec2Keyframes(set.shear) } : {}),
    ...(set.translateX.length > 0 ? { translateX: scalarKeyframes(set.translateX) } : {}),
    ...(set.translateY.length > 0 ? { translateY: scalarKeyframes(set.translateY) } : {}),
    ...(set.scaleX.length > 0 ? { scaleX: scalarKeyframes(set.scaleX) } : {}),
    ...(set.scaleY.length > 0 ? { scaleY: scalarKeyframes(set.scaleY) } : {}),
    ...(set.shearX.length > 0 ? { shearX: scalarKeyframes(set.shearX) } : {}),
    ...(set.shearY.length > 0 ? { shearY: scalarKeyframes(set.shearY) } : {}),
  };
}

function slotTimelinesToFormat(set: SlotTimelineSet): SlotTimelines {
  // Every channel projects from its id-keyed entries, emitted only when non-empty (dropping the internal id):
  // the joint color/attachment/sequence/dark channels, and the Stage F2 (ADR-0009 section 4.2) split
  // rgb/alpha tracks (via rgbKeyframes/alphaKeyframes). The joint `color` and the split `rgb`/`alpha` never
  // coexist (the format's TIMELINE_COMPONENT_CONFLICT).
  return {
    ...(set.attachment.length > 0
      ? { attachment: set.attachment.map((frame) => ({ time: frame.time, name: frame.name })) }
      : {}),
    ...(set.color.length > 0 ? { color: colorKeyframes(set.color) } : {}),
    ...(set.dark.length > 0 ? { dark: colorKeyframes(set.dark) } : {}),
    ...(set.sequence.length > 0
      ? {
          sequence: set.sequence.map((k) => ({
            time: k.time,
            mode: k.mode,
            index: k.index,
            delay: k.delay,
          })),
        }
      : {}),
    ...(set.rgb.length > 0 ? { rgb: rgbKeyframes(set.rgb) } : {}),
    ...(set.alpha.length > 0 ? { alpha: alphaKeyframes(set.alpha) } : {}),
  };
}

// Project an IK timeline (Keyframe<IkFrame>[]). The model's boolean `bendPositive` maps to the signed
// format `bend` losslessly (ADR-0009: true -> +1, false -> -1); the runtime samples it stepped regardless
// of the curve (ADR-0003 section 7). The OPTIONAL F2 depth channels are emitted only when the loaded frame
// carried them (exactOptionalPropertyTypes), so an authored frame stays at the Phase-2 shape.
function ikFramesToFormat(frames: readonly IkKeyframeEntity[]): Keyframe<IkFrame>[] {
  return frames.map((kf) => ({
    time: kf.time,
    value: {
      mix: kf.mix,
      bend: kf.bendPositive ? 1 : -1,
      ...(kf.softness !== undefined ? { softness: kf.softness } : {}),
      ...(kf.stretch !== undefined ? { stretch: kf.stretch } : {}),
      ...(kf.compress !== undefined ? { compress: kf.compress } : {}),
    },
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
  eventIdToName: ReadonlyMap<string, string>,
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
  // Draw-order and event timelines (Stage F1, PP-D9): resolve each key's id references back to CURRENT
  // names (an offset's SlotId to the slot name, an event key's EventDefId to the event name), so a rename
  // is a single-field change with zero cascade. They are REQUIRED format collections, so they always emit
  // (empty when the animation reorders nothing / fires nothing).
  const drawOrder: DrawOrderKeyframe[] = animation.drawOrder.map((key) => ({
    time: key.time,
    offsets: key.offsets.map((entry) => ({
      slot: resolveName(entry.slot, slotIdToName, 'draw-order slot'),
      offset: entry.offset,
    })),
  }));
  const events: EventKeyframe[] = animation.events.map((key) => ({
    time: key.time,
    name: resolveName(key.event, eventIdToName, 'animation event'),
    ...(key.int !== undefined ? { int: key.int } : {}),
    ...(key.float !== undefined ? { float: key.float } : {}),
    ...(key.string !== undefined ? { string: key.string } : {}),
  }));
  // Stage F3 (ADR-0011 section 3): the carried path-constraint timeline record is emitted verbatim (it is
  // already the on-disk shape, keyed by constraint name); REQUIRED, empty ({}) when the animation keys none.
  return {
    duration: animation.duration,
    bones,
    slots,
    ik,
    transform,
    deform,
    drawOrder,
    events,
    path: animation.path,
  };
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
    // The model's boolean maps to the signed format `bend` losslessly (ADR-0009: true -> +1, false -> -1).
    bend: c.bendPositive ? 1 : -1,
    softness: c.softness,
    stretch: c.stretch,
    compress: c.compress,
    uniform: c.uniform,
    ...(c.order !== undefined ? { order: c.order } : {}),
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
    local: c.local,
    relative: c.relative,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Project a path constraint (Stage F3, ADR-0011 section 2) BACK to the format shape: the SLOT target id and
// each bone id resolve to their CURRENT names, so a rename since load emits the current name (LAW 3 fail-loud
// on a dangling id). `order` is emitted only when set (exactOptionalPropertyTypes).
function pathConstraintToFormat(
  c: PathConstraintEntity,
  boneIdToName: ReadonlyMap<string, string>,
  slotIdToName: ReadonlyMap<string, string>,
): PathConstraint {
  return {
    name: c.name,
    target: resolveName(c.target, slotIdToName, 'path constraint target slot'),
    bones: c.bones.map((boneId) => resolveName(boneId, boneIdToName, 'path constraint bone')),
    positionMode: c.positionMode,
    spacingMode: c.spacingMode,
    rotateMode: c.rotateMode,
    position: c.position,
    spacing: c.spacing,
    offsetRotation: c.offsetRotation,
    mixRotate: c.mixRotate,
    mixX: c.mixX,
    mixY: c.mixY,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Materialize a named skin's attachments to the format record, keyed by each owning slot's CURRENT name.
// The Stage F2 (ADR-0009 section 5) scoping lists are carried verbatim (as on-disk names) when present.
function skinToFormat(skin: SkinEntity, slotIdToName: ReadonlyMap<string, string>): Skin {
  const attachments: Record<string, Record<string, Attachment>> = {};
  for (const [slotId, inner] of skin.attachments) {
    if (inner.size === 0) continue;
    const record: Record<string, Attachment> = {};
    for (const [name, att] of inner) record[name] = attachmentToFormat(att);
    attachments[resolveName(slotId, slotIdToName, 'skin slot')] = record;
  }
  return {
    name: skin.name,
    attachments,
    ...(skin.bones !== undefined ? { bones: [...skin.bones] } : {}),
    ...(skin.constraints !== undefined ? { constraints: [...skin.constraints] } : {}),
  };
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
  // Path constraints (Stage F3, ADR-0011 section 2; PP-D11) emit from the promoted model in stored order,
  // resolving the SLOT target and bone ids back to their current names.
  const pathConstraints: PathConstraint[] = model
    .pathConstraints()
    .map((c) => pathConstraintToFormat(c, boneIdToName, slotIdToName));

  // Event definitions (Stage F1, PP-D9) emit in eventOrder; an event key resolves its EventDefId back to the
  // definition's CURRENT name through this map.
  const orderedEventDefs = model.eventDefs();
  const eventIdToName = new Map<string, string>();
  for (const def of orderedEventDefs) eventIdToName.set(def.id, def.name);

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
      eventIdToName,
    );
  }

  // Document-level events emit from the first-class event definitions (Stage F1, PP-D9), in eventOrder;
  // `events` is REQUIRED (empty when the rig defines none). The optional metadata block is emitted only when
  // present, per exactOptionalPropertyTypes. The atlas is still carried from preserved content.
  const metadata = model.metadata();
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones,
    slots,
    skins,
    ikConstraints,
    transformConstraints,
    // Stage F3 (ADR-0011 section 2): the promoted path constraints emit in stored solve order (PP-D11);
    // REQUIRED, empty ([]) when the rig has none.
    pathConstraints,
    events: orderedEventDefs.map((event) => ({
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
    atlas: model.preserved().atlas,
    ...(metadata !== undefined ? { metadata } : {}),
  };
  const withHash: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

  const report = validateDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new ExportValidationError(report);
  }
  return report.document;
}
