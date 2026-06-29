import { parseDocument } from '@marionette/format';
import { effectsDocumentToState, loadEffectsState } from '../effects-model/effects-import';
import type { EffectsState } from '../effects-model/effects-state';
import type {
  Attachment,
  CurveType,
  IkConstraint,
  Skin,
  SkeletonDocument,
  TransformConstraint,
} from '@marionette/format/types';
import { DocumentInvariantError } from '../command/errors';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneEntity,
  BoneTimelineSet,
  DeformKeyframeEntity,
  DeformSkinKey,
  DocState,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  KeyframeValue,
  SkinEntity,
  SlotEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from '../model/doc-state';
import {
  makeAttachmentFrame,
  makeDeformKeyframe,
  makeIkKeyframe,
  makeKeyframe,
  makeTransformKeyframe,
} from '../model/doc-state';
import { defaultSlotSceneState } from '../model/slot-scene';
import type {
  AnimationId,
  BoneId,
  IdFactory,
  IkConstraintId,
  SkinId,
  SlotId,
  TransformConstraintId,
} from '../model/ids';
import { buildLoadedDocument, type Document } from './document';
import type { DocumentEnvironment } from './environment';

// Resolve a validated format document into internal DocState: mint a BoneId per bone (in format order),
// a SlotId per slot (in slots[] order), an IkConstraintId / TransformConstraintId per constraint, a SkinId
// per non-default skin, resolve NAME references to ids, build the editable attachment map from the default
// skin and the named skins, and carry the atlas verbatim. The format validator already guaranteed unique
// names, parent-before-child ordering, slot/attachment resolution, constraint bone/target existence, and
// timeline key resolution, so the resolutions below are total; a failure is corrupt input and throws
// (symmetry with export).
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

// Convert one format attachment to its editable entity (region/mesh promoted, everything else preserved
// verbatim). Shared by the default skin and every named skin so both load identically. Arrays are copied
// so the model never aliases the parsed document; edges/bones stay omitted when absent
// (exactOptionalPropertyTypes).
function attachmentToEntity(attachmentName: string, attachment: Attachment): AttachmentEntity {
  if (attachment.type === 'region') {
    return {
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
    };
  }
  if (attachment.type === 'mesh') {
    return {
      kind: 'mesh',
      name: attachmentName,
      path: attachment.path,
      uvs: attachment.uvs.slice(),
      triangles: attachment.triangles.slice(),
      hullLength: attachment.hullLength,
      width: attachment.width,
      height: attachment.height,
      color: attachment.color,
      vertices: attachment.vertices.slice(),
      ...(attachment.edges !== undefined ? { edges: attachment.edges.slice() } : {}),
      ...(attachment.bones !== undefined ? { bones: attachment.bones.slice() } : {}),
    };
  }
  return { kind: 'preserved', name: attachmentName, value: attachment };
}

// Build a skin's editable attachment map (slotId -> name -> entity) from a format skin's `attachments`
// record (slotName -> attachmentName -> Attachment). A slot with no attachments contributes no entry.
function buildSkinAttachments(
  attachments: Skin['attachments'],
  slotNameToId: ReadonlyMap<string, SlotId>,
): Map<SlotId, Map<string, AttachmentEntity>> {
  const out = new Map<SlotId, Map<string, AttachmentEntity>>();
  for (const [slotName, slotAttachments] of Object.entries(attachments)) {
    const slotId = resolveId(slotName, slotNameToId, 'skin slot');
    const inner = new Map<string, AttachmentEntity>();
    for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
      inner.set(attachmentName, attachmentToEntity(attachmentName, attachment));
    }
    if (inner.size > 0) out.set(slotId, inner);
  }
  return out;
}

function ikConstraintToEntity(
  id: IkConstraintId,
  c: IkConstraint,
  boneNameToId: ReadonlyMap<string, BoneId>,
): IkConstraintEntity {
  return {
    id,
    name: c.name,
    bones: c.bones.map((boneName) => resolveId(boneName, boneNameToId, 'ik constraint bone')),
    target: resolveId(c.target, boneNameToId, 'ik constraint target'),
    mix: c.mix,
    bendPositive: c.bendPositive,
  };
}

function transformConstraintToEntity(
  id: TransformConstraintId,
  c: TransformConstraint,
  boneNameToId: ReadonlyMap<string, BoneId>,
): TransformConstraintEntity {
  return {
    id,
    name: c.name,
    bones: c.bones.map((boneName) =>
      resolveId(boneName, boneNameToId, 'transform constraint bone'),
    ),
    target: resolveId(c.target, boneNameToId, 'transform constraint target'),
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

  // The default skin's attachments become first-class; every OTHER skin is promoted to a SkinEntity (WP-2.8;
  // no longer carried verbatim in preserved.extraSkins). The default skin always exists (the validator's
  // SKIN_DEFAULT_MISSING guarantees it).
  const defaultSkin = document.skins.find((skin) => skin.name === 'default');
  const attachments = defaultSkin
    ? buildSkinAttachments(defaultSkin.attachments, slotNameToId)
    : new Map<SlotId, Map<string, AttachmentEntity>>();

  const skinNameToId = new Map<string, SkinId>();
  const skinOrder: SkinId[] = [];
  const skinsMap = new Map<SkinId, SkinEntity>();
  for (const skin of document.skins) {
    if (skin.name === 'default') continue;
    const id = ids.mint('skin');
    skinNameToId.set(skin.name, id);
    skinOrder.push(id);
    skinsMap.set(id, {
      id,
      name: skin.name,
      attachments: buildSkinAttachments(skin.attachments, slotNameToId),
    });
  }

  // Constraints (WP-2.6/2.7): mint an id per constraint, resolve bone/target NAME references to ids, and
  // keep the stored array order as the solve order (ikConstraintOrder / transformConstraintOrder).
  const ikNameToId = new Map<string, IkConstraintId>();
  const ikConstraintOrder: IkConstraintId[] = [];
  const ikConstraints = new Map<IkConstraintId, IkConstraintEntity>();
  for (const c of document.ikConstraints) {
    const id = ids.mint('ikConstraint');
    ikNameToId.set(c.name, id);
    ikConstraintOrder.push(id);
    ikConstraints.set(id, ikConstraintToEntity(id, c, boneNameToId));
  }
  const tcNameToId = new Map<string, TransformConstraintId>();
  const transformConstraintOrder: TransformConstraintId[] = [];
  const transformConstraints = new Map<TransformConstraintId, TransformConstraintEntity>();
  for (const c of document.transformConstraints) {
    const id = ids.mint('transformConstraint');
    tcNameToId.set(c.name, id);
    transformConstraintOrder.push(id);
    transformConstraints.set(id, transformConstraintToEntity(id, c, boneNameToId));
  }

  // The deform skin key resolves 'default' to itself and a named skin to its SkinId, so a deform track
  // survives a skin rename.
  const resolveDeformSkinKey = (skinName: string): DeformSkinKey =>
    skinName === 'default' ? 'default' : resolveId(skinName, skinNameToId, 'deform skin');

  // Animations (WP-1.5, extended in Phase 2) become first-class: mint an AnimationId per animation and a
  // KeyframeId per keyframe/frame, and resolve bone/slot/constraint/skin NAME keys to ids. The validator
  // already guaranteed every timeline key resolves, so resolveId is total here.
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
    const ikTracks = new Map<IkConstraintId, readonly IkKeyframeEntity[]>();
    for (const [constraintName, frames] of Object.entries(animation.ik)) {
      const constraintId = resolveId(constraintName, ikNameToId, 'animation ik constraint');
      ikTracks.set(constraintId, loadIkFrames(frames, ids));
    }
    const transformTracks = new Map<TransformConstraintId, readonly TransformKeyframeEntity[]>();
    for (const [constraintName, frames] of Object.entries(animation.transform)) {
      const constraintId = resolveId(constraintName, tcNameToId, 'animation transform constraint');
      transformTracks.set(constraintId, loadTransformFrames(frames, ids));
    }
    const deformTracks = new Map<
      DeformSkinKey,
      Map<SlotId, Map<string, readonly DeformKeyframeEntity[]>>
    >();
    for (const [skinName, bySlot] of Object.entries(animation.deform)) {
      const skinKey = resolveDeformSkinKey(skinName);
      const slotMap = new Map<SlotId, Map<string, readonly DeformKeyframeEntity[]>>();
      for (const [slotName, byName] of Object.entries(bySlot)) {
        const slotId = resolveId(slotName, slotNameToId, 'deform slot');
        const nameMap = new Map<string, readonly DeformKeyframeEntity[]>();
        for (const [attachmentName, frames] of Object.entries(byName)) {
          nameMap.set(attachmentName, loadDeformFrames(frames, ids));
        }
        slotMap.set(slotId, nameMap);
      }
      deformTracks.set(skinKey, slotMap);
    }
    animations.set(id, {
      id,
      name: animName,
      duration: animation.duration,
      bones: bonesTracks,
      slots: slotTracks,
      ik: ikTracks,
      transform: transformTracks,
      deform: deformTracks,
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
    ikConstraints,
    ikConstraintOrder,
    transformConstraints,
    transformConstraintOrder,
    skins: skinsMap,
    skinOrder,
    // The skeletal SkeletonDocument envelope carries NO slot scene (the slot scene is its own
    // SlotSceneDocument, phase-4 WP-4.4). A skeleton-only load therefore seeds the always-present DEFAULT
    // slot scene; wiring the SlotSceneDocument save/load envelope is a separate change (see report). The
    // in-model slotScene still snapshots and round-trips cleanly through History do/undo.
    slotScene: defaultSlotSceneState(),
    preserved: {
      atlas: document.atlas,
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

function loadIkFrames(
  frames: SkeletonDocument['animations'][string]['ik'][string],
  ids: IdFactory,
): IkKeyframeEntity[] {
  return frames.map((frame) =>
    makeIkKeyframe(
      ids.mint('keyframe'),
      frame.time,
      frame.value.mix,
      frame.value.bendPositive,
      frame.curve,
    ),
  );
}

function loadTransformFrames(
  frames: SkeletonDocument['animations'][string]['transform'][string],
  ids: IdFactory,
): TransformKeyframeEntity[] {
  return frames.map((frame) =>
    makeTransformKeyframe(
      ids.mint('keyframe'),
      frame.time,
      {
        mixRotate: frame.value.mixRotate,
        mixX: frame.value.mixX,
        mixY: frame.value.mixY,
        mixScaleX: frame.value.mixScaleX,
        mixScaleY: frame.value.mixScaleY,
        mixShearY: frame.value.mixShearY,
      },
      frame.curve,
    ),
  );
}

function loadDeformFrames(
  frames: SkeletonDocument['animations'][string]['deform'][string][string][string],
  ids: IdFactory,
): DeformKeyframeEntity[] {
  return frames.map((frame) =>
    makeDeformKeyframe(ids.mint('keyframe'), frame.time, frame.value.offsets, frame.curve),
  );
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

// Load a project's skeleton AND effects library into ONE Document with a single shared id factory and one
// History (WP-3.7 TASK-3.7.6: effect + skeleton edits interleave on one undo stack). Both formats validate
// at the boundary (a typed FormatValidationError / EffectsValidationError on malformed input, constructing
// NO Document, LAW 3); the SAME id factory mints skeletal and effects entities so their ids never collide.
// Like loadDocument, this is NOT a command and NOT undoable: it returns a fresh Document with empty history.
export function loadDocumentWithEffects(
  skeletonJson: unknown,
  effectsJson: unknown,
  env: DocumentEnvironment,
): Document {
  const document = parseDocument(skeletonJson, { verifyHash: false });
  const ids = env.createIds();
  const state = formatToDocState(document, ids);
  const effectsState = loadEffectsState(effectsJson, ids);
  return buildLoadedDocument(state, ids, env, effectsState);
}

// Resolve an already-parsed/loaded EffectsState helper for callers that hold a validated EffectsDocument
// (the conformance / preset paths) and want to seed a Document without re-parsing. Kept here so the load
// seam is the single place that bridges the effects format to the model.
export function effectsStateFromDocument(
  document: Parameters<typeof effectsDocumentToState>[0],
  ids: IdFactory,
): EffectsState {
  return effectsDocumentToState(document, ids);
}
