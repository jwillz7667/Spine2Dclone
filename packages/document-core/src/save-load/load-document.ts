import { parseDocument } from '@marionette/format';
import { effectsDocumentToState, loadEffectsState } from '../effects-model/effects-import';
import type { EffectsState } from '../effects-model/effects-state';
import type {
  Attachment,
  CurveType,
  IkConstraint,
  PathConstraint,
  SequenceMode,
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
  DrawOrderKeyEntity,
  DrawOrderOffsetEntity,
  EventDefEntity,
  EventKeyEntity,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  KeyframeValue,
  PathConstraintEntity,
  SequenceKeyframeEntity,
  SkinEntity,
  SlotEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from '../model/doc-state';
import {
  makeAttachmentFrame,
  makeDeformKeyframe,
  makeDrawOrderKey,
  makeEventDef,
  makeEventKey,
  makeIkKeyframe,
  makeKeyframe,
  makeLinkedMeshAttachment,
  makePathAttachment,
  makeSequenceKeyframe,
  makeTransformKeyframe,
} from '../model/doc-state';
import { defaultSlotSceneState } from '../model/slot-scene';
import type {
  AnimationId,
  BoneId,
  EventDefId,
  IdFactory,
  IkConstraintId,
  PathConstraintId,
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

// Deep-copy and deep-freeze a carried Stage F2 (ADR-0009) value (a keyframe track array or a sequence
// block) so the model neither aliases the parsed document nor exposes a mutable structure. Document-core
// does not author these yet (PP-D10); it carries them verbatim, so a structural clone is exactly right.
function carry<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => carry(item))) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = carry(inner);
    return Object.freeze(out) as T;
  }
  return value;
}

// Convert one format attachment to its editable entity (region/mesh promoted, everything else preserved
// verbatim). Shared by the default skin and every named skin so both load identically. Arrays are copied
// so the model never aliases the parsed document; edges/bones stay omitted when absent
// (exactOptionalPropertyTypes). A Stage F2 (ADR-0009) region/mesh `sequence` is carried verbatim.
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
      ...(attachment.sequence !== undefined ? { sequence: carry(attachment.sequence) } : {}),
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
      ...(attachment.sequence !== undefined ? { sequence: carry(attachment.sequence) } : {}),
    };
  }
  if (attachment.type === 'linkedmesh') {
    // Stage F2 (ADR-0009 section 2) linked meshes are promoted to editable (PP-D10); the parent/skin refs
    // stay on-disk names (resolved lazily), exactly as the format carries them.
    return makeLinkedMeshAttachment({
      name: attachmentName,
      path: attachment.path,
      parent: attachment.parent,
      skin: attachment.skin,
      timelines: attachment.timelines,
      width: attachment.width,
      height: attachment.height,
      color: attachment.color,
    });
  }
  if (attachment.type === 'path' && attachment.bones === undefined) {
    // Stage F3 (ADR-0011 section 1) UNWEIGHTED path attachments are promoted to editable (PP-D11). The
    // control points ride as a flat [x, y, ...] stream and the arc-length `lengths` table is carried as
    // authored (the command layer recomputes it on every edit). A WEIGHTED path (a `bones` manifest
    // present) has no editing surface yet, so it falls through to the preserved carrier below and
    // round-trips verbatim, exactly like the unweighted-only mesh-promotion convention.
    return makePathAttachment({
      name: attachmentName,
      closed: attachment.closed,
      constantSpeed: attachment.constantSpeed,
      lengths: attachment.lengths.slice(),
      vertices: attachment.vertices.slice(),
    });
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
    // Map the signed format `bend` (ADR-0009) to the model's boolean losslessly (+1 -> true, -1 -> false).
    bendPositive: c.bend > 0,
    softness: c.softness,
    stretch: c.stretch,
    compress: c.compress,
    uniform: c.uniform,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Promote a format path constraint (Stage F3, ADR-0011 section 2) to its editable entity: the `target` is a
// SLOT name resolved to a SlotId (a path lives on a slot), and each `bones` NAME resolves to a BoneId, so a
// rename never breaks the constraint. The validator already guaranteed the references resolve, so resolveId
// is total here.
function pathConstraintToEntity(
  id: PathConstraintId,
  c: PathConstraint,
  boneNameToId: ReadonlyMap<string, BoneId>,
  slotNameToId: ReadonlyMap<string, SlotId>,
): PathConstraintEntity {
  return {
    id,
    name: c.name,
    target: resolveId(c.target, slotNameToId, 'path constraint target slot'),
    bones: c.bones.map((boneName) => resolveId(boneName, boneNameToId, 'path constraint bone')),
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
    local: c.local,
    relative: c.relative,
    ...(c.order !== undefined ? { order: c.order } : {}),
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
      // Stage F2 (ADR-0009 section 5) skin scoping, carried verbatim as on-disk names (PP-D10).
      ...(skin.bones !== undefined ? { bones: carry(skin.bones) } : {}),
      ...(skin.constraints !== undefined ? { constraints: carry(skin.constraints) } : {}),
    });
  }

  // Event definitions (Stage F1, ADR-0008; PP-D9) become first-class: mint an EventDefId per definition,
  // keep the on-disk order as eventOrder, and build the name->id map an animation's event keys resolve
  // against. The validator already guaranteed event name uniqueness (EVENT_NAME_DUPLICATE), so the later
  // resolve is total.
  const eventNameToId = new Map<string, EventDefId>();
  const eventOrder: EventDefId[] = [];
  const events = new Map<EventDefId, EventDefEntity>();
  for (const def of document.events) {
    const id = ids.mint('eventDef');
    eventNameToId.set(def.name, id);
    eventOrder.push(id);
    events.set(
      id,
      makeEventDef(id, def.name, {
        int: def.int,
        float: def.float,
        string: def.string,
        audio:
          def.audio === undefined
            ? undefined
            : { path: def.audio.path, volume: def.audio.volume, balance: def.audio.balance },
      }),
    );
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
  // Path constraints (Stage F3, ADR-0011 section 2; PP-D11): mint a PathConstraintId per constraint, resolve
  // the target SLOT name and bone NAME references to ids, and keep the stored array order (pathConstraintOrder)
  // within the single combined solve-order space. The per-animation path TIMELINE stays carried by constraint
  // NAME (its own id-keyed promotion is PP-D11 slice 2), so no name->id map is threaded to the timelines here.
  const pathConstraintOrder: PathConstraintId[] = [];
  const pathConstraints = new Map<PathConstraintId, PathConstraintEntity>();
  for (const c of document.pathConstraints) {
    const id = ids.mint('pathConstraint');
    pathConstraintOrder.push(id);
    pathConstraints.set(id, pathConstraintToEntity(id, c, boneNameToId, slotNameToId));
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
    // Draw-order and event timelines (Stage F1, PP-D9): mint a KeyframeId per key and resolve NAME
    // references to ids (a draw-order offset's slot to its SlotId, an event key's name to its EventDefId),
    // so a slot/event rename never breaks a key. The validator already guaranteed every reference resolves
    // (ANIM_SLOT_UNKNOWN / ANIM_EVENT_UNKNOWN), so resolveId is total here.
    const drawOrderKeys: DrawOrderKeyEntity[] = animation.drawOrder.map((key) =>
      makeDrawOrderKey(
        ids.mint('keyframe'),
        key.time,
        key.offsets.map(
          (entry): DrawOrderOffsetEntity => ({
            slot: resolveId(entry.slot, slotNameToId, 'draw-order slot'),
            offset: entry.offset,
          }),
        ),
      ),
    );
    const eventKeys: EventKeyEntity[] = animation.events.map((key) =>
      makeEventKey(
        ids.mint('keyframe'),
        key.time,
        resolveId(key.name, eventNameToId, 'animation event'),
        { int: key.int, float: key.float, string: key.string },
      ),
    );
    animations.set(id, {
      id,
      name: animName,
      duration: animation.duration,
      bones: bonesTracks,
      slots: slotTracks,
      ik: ikTracks,
      transform: transformTracks,
      deform: deformTracks,
      drawOrder: drawOrderKeys,
      events: eventKeys,
      // Stage F3 (ADR-0011 section 3) path-constraint timelines, carried verbatim as the on-disk record
      // (constraintName -> frames) until an authoring command lands (PP-D11); deep-frozen so the model
      // never aliases the parsed document.
      path: carry(animation.path),
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
    pathConstraints,
    pathConstraintOrder,
    skins: skinsMap,
    skinOrder,
    events,
    eventOrder,
    // The optional metadata block (fps/imagesPath/audioPath) is copied so the model never aliases the parsed
    // document; only the present fields are kept (exactOptionalPropertyTypes), so a partial block round-trips.
    metadata:
      document.metadata === undefined
        ? undefined
        : {
            ...(document.metadata.fps !== undefined ? { fps: document.metadata.fps } : {}),
            ...(document.metadata.imagesPath !== undefined
              ? { imagesPath: document.metadata.imagesPath }
              : {}),
            ...(document.metadata.audioPath !== undefined
              ? { audioPath: document.metadata.audioPath }
              : {}),
          },
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
  // Every channel (joint and the Stage F2 (ADR-0009 section 4.1) split component tracks) loads as
  // first-class id-keyed keyframes (PP-D10); the format scalar value `{ value }` is a ScalarValue by shape.
  return {
    rotate: loadKeyframes(timelines.rotate, ids),
    translate: loadKeyframes(timelines.translate, ids),
    scale: loadKeyframes(timelines.scale, ids),
    shear: loadKeyframes(timelines.shear, ids),
    translateX: loadKeyframes(timelines.translateX, ids),
    translateY: loadKeyframes(timelines.translateY, ids),
    scaleX: loadKeyframes(timelines.scaleX, ids),
    scaleY: loadKeyframes(timelines.scaleY, ids),
    shearX: loadKeyframes(timelines.shearX, ids),
    shearY: loadKeyframes(timelines.shearY, ids),
  };
}

function loadSlotTimelines(
  timelines: SkeletonDocument['animations'][string]['slots'][string],
  ids: IdFactory,
): SlotTimelineSet {
  // Every channel loads as first-class id-keyed entities (PP-D10): the joint color/attachment channels, the
  // frame-sequence channel, the two-color dark channel, and the Stage F2 (ADR-0009 section 4.2) split
  // rgb/alpha tracks (the format `{ rgb }` / `{ alpha }` values are RgbValue / AlphaValue by shape).
  return {
    color: loadKeyframes(timelines.color, ids),
    attachment: loadAttachmentFrames(timelines.attachment, ids),
    sequence: loadSequenceKeyframes(timelines.sequence, ids),
    dark: loadKeyframes(timelines.dark, ids),
    rgb: loadKeyframes(timelines.rgb, ids),
    alpha: loadKeyframes(timelines.alpha, ids),
  };
}

function loadSequenceKeyframes(
  keys:
    | ReadonlyArray<{ time: number; mode: SequenceMode; index: number; delay: number }>
    | undefined,
  ids: IdFactory,
): SequenceKeyframeEntity[] {
  if (keys === undefined) return [];
  return keys.map((k) =>
    makeSequenceKeyframe(ids.mint('keyframe'), k.time, k.mode, k.index, k.delay),
  );
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
      // Map the signed format `bend` (ADR-0009) to the model's boolean losslessly (+1 -> true, -1 -> false).
      frame.value.bend > 0,
      frame.curve,
      {
        softness: frame.value.softness,
        stretch: frame.value.stretch,
        compress: frame.value.compress,
      },
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
