import type {
  Attachment,
  BlendMode,
  CurveType,
  RGBA,
  Sequence,
  SequenceMode,
  SkeletonMeta,
  TransformMode,
} from '@marionette/format/types';
import type {
  GridConfig,
  SymbolAnimSet,
  SymbolId,
  TumbleChoreography,
} from '@marionette/format/slot-types';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneEntity,
  DeformKeyframeEntity,
  DrawOrderKeyEntity,
  EventDefEntity,
  EventKeyEntity,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  KeyframeValue,
  PreservedContent,
  SequenceKeyframeEntity,
  SkinEntity,
  SlotEntity,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from './doc-state';
import { cloneCurve, cloneKeyframeValue } from './doc-state';
import type { SlotSceneState } from './slot-scene';
import {
  cloneFeatureFlowGraph,
  cloneGridConfig,
  cloneSceneRefs,
  cloneSymbolAnimSet,
  cloneWinSequenceConfig,
} from './slot-scene';
import type {
  AnimationId,
  BoneId,
  EventDefId,
  IkConstraintId,
  SkinId,
  SlotId,
  TransformConstraintId,
} from './ids';

// The public read surface given to the UI and to commands (command-history Section 3.2). Every
// accessor returns a frozen value copy or a readonly view; no accessor leaks a handle that can mutate
// the model. The only write surface is the Mutator (model/mutator.ts), reachable only from History.
export interface DocumentReadModel {
  // Bumps on every applied mutation (discrete or in-batch). The single source of "something changed".
  readonly revision: number;
  // The document name (a format field; shown in the UI title and resolved at export).
  readonly name: string;
  getBone(id: BoneId): BoneEntity | undefined;
  bones(): readonly BoneEntity[]; // in boneOrder
  // First bone in boneOrder whose name matches, or undefined (command-history D9). Never throws;
  // names are not internally unique, so this is first-match by design.
  findBoneByName(name: string): BoneEntity | undefined;
  getSlot(id: SlotId): SlotEntity | undefined;
  slots(): readonly SlotEntity[]; // in slotOrder (setup-pose draw order)
  // The attachments of one slot (the default skin), or [] when the slot has none. Sorted by name so
  // the order is deterministic for callers that enumerate.
  attachments(slotId: SlotId): readonly AttachmentEntity[];
  getAttachment(slotId: SlotId, name: string): AttachmentEntity | undefined;
  getAnimation(id: AnimationId): AnimationEntity | undefined;
  // All animations, sorted by id (the on-disk record is name-keyed and order-insignificant, so a
  // deterministic enumeration sorts by the stable internal id).
  animations(): readonly AnimationEntity[];
  getIkConstraint(id: IkConstraintId): IkConstraintEntity | undefined;
  // IK constraints in stored solve order (ikConstraintOrder); ALL IK solve before any transform (ADR-0003).
  ikConstraints(): readonly IkConstraintEntity[];
  getTransformConstraint(id: TransformConstraintId): TransformConstraintEntity | undefined;
  // Transform constraints in stored solve order, solved AFTER all IK constraints (ADR-0003).
  transformConstraints(): readonly TransformConstraintEntity[];
  getSkin(id: SkinId): SkinEntity | undefined;
  // The NON-default named skins in skinOrder. The default skin is implicit (its attachments are the
  // editable default-skin attachments reached via attachments()); it is never a SkinEntity.
  skins(): readonly SkinEntity[];
  getEventDef(id: EventDefId): EventDefEntity | undefined;
  // The document-level event definitions in eventOrder (the stable on-disk emission order).
  eventDefs(): readonly EventDefEntity[];
  // First event definition in eventOrder whose name matches, or undefined. Names are unique at export
  // (EVENT_NAME_DUPLICATE, a D9 contract), so this is first-match by design (like findBoneByName).
  findEventDefByName(name: string): EventDefEntity | undefined;
  // The optional skeleton metadata block (fps/imagesPath/audioPath authoring hints), or undefined.
  metadata(): SkeletonMeta | undefined;
  // The slot-scene aggregate (phase-4 WP-4.5 / WP-4.6), read-only and deep-frozen. Always present (a
  // default 5x3 reelStrip scene on a fresh document). The grid, the SymbolId-keyed symbol library, the
  // sequencer / feature-flow / tumble configs, and the scene refs.
  slotScene(): SlotSceneState;
  // The slot grid alone (a convenience over slotScene().grid, mirroring getBone over bones()).
  slotGrid(): GridConfig;
  // The tumble choreography alone (a convenience over slotScene().tumble; WP-4.10), deep-copied.
  slotTumble(): TumbleChoreography;
  // The SymbolAnimSet mapped to one SymbolId, or undefined when the symbol is unmapped.
  getSymbolAnimSet(symbolId: SymbolId): SymbolAnimSet | undefined;
  // The preserved (not-yet-promoted) document body, read-only. After Phase 2 this holds only the atlas.
  preserved(): PreservedContent;
  // Canonical, deterministically-ordered, deep-equality-comparable projection (includes internal ids).
  snapshot(): DocSnapshot;
}

// A plain, JSON-serializable bone projection for snapshots (internal id included).
export interface BoneSnapshot {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
  readonly length: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
  readonly transformMode: TransformMode;
}

// A plain slot projection for snapshots. `bone` is the internal BoneId string (a reference), not the
// bone name, so the snapshot is stable across an unrelated bone rename.
export interface SlotSnapshot {
  readonly id: string;
  readonly name: string;
  readonly bone: string;
  readonly color: RGBA;
  readonly darkColor: RGBA | null;
  readonly attachment: string | null;
  readonly blendMode: BlendMode;
}

// A plain attachment projection for snapshots, keyed by its owning slot. The region and mesh variants
// carry their editable fields (the mesh variant includes the geometry arrays, so a do/undo round-trip
// deep-equal covers a mesh edit); the preserved variant carries the verbatim format value. All three
// round-trip.
export type AttachmentSnapshot =
  | {
      readonly slotId: string;
      readonly kind: 'region';
      readonly name: string;
      readonly path: string;
      readonly x: number;
      readonly y: number;
      readonly rotation: number;
      readonly scaleX: number;
      readonly scaleY: number;
      readonly width: number;
      readonly height: number;
      readonly color: RGBA;
      readonly sequence?: Sequence;
    }
  | {
      readonly slotId: string;
      readonly kind: 'mesh';
      readonly name: string;
      readonly path: string;
      readonly uvs: readonly number[];
      readonly triangles: readonly number[];
      readonly hullLength: number;
      readonly width: number;
      readonly height: number;
      readonly color: RGBA;
      readonly edges?: readonly number[];
      readonly vertices: readonly number[];
      readonly bones?: readonly number[];
      readonly sequence?: Sequence;
    }
  | {
      readonly slotId: string;
      readonly kind: 'linkedmesh';
      readonly name: string;
      readonly path: string;
      readonly parent: string;
      readonly skin?: string;
      readonly timelines: boolean;
      readonly width: number;
      readonly height: number;
      readonly color: RGBA;
    }
  | {
      readonly slotId: string;
      readonly kind: 'path';
      readonly name: string;
      readonly closed: boolean;
      readonly constantSpeed: boolean;
      readonly lengths: readonly number[];
      readonly vertices: readonly number[];
    }
  | {
      readonly slotId: string;
      readonly kind: 'preserved';
      readonly name: string;
      readonly value: Attachment;
    };

// A plain keyframe projection: the internal id, time, value, and curve as value copies (so the snapshot
// never aliases the live model). Keyframes within a channel are listed in strictly ascending time order.
export interface KeyframeSnapshot {
  readonly id: string;
  readonly time: number;
  readonly value: KeyframeValue;
  readonly curve: CurveType;
}

// A plain attachment-frame projection (stepped, no curve), in ascending time order.
export interface AttachmentFrameSnapshot {
  readonly id: string;
  readonly time: number;
  readonly name: string | null;
}

// A plain slot sequence-keyframe projection (PP-D10), value copies in time order.
export interface SequenceKeyframeSnapshot {
  readonly id: string;
  readonly time: number;
  readonly mode: SequenceMode;
  readonly index: number;
  readonly delay: number;
}

// A plain per-bone timeline projection, keyed by the internal BoneId string (a reference, stable across
// a bone rename), with each channel in time order.
export interface BoneTimelineSnapshot {
  readonly boneId: string;
  readonly rotate: readonly KeyframeSnapshot[];
  readonly translate: readonly KeyframeSnapshot[];
  readonly scale: readonly KeyframeSnapshot[];
  readonly shear: readonly KeyframeSnapshot[];
  // Stage F2 (ADR-0009 section 4.1, PP-D10) per-component split tracks, promoted into the snapshot so the
  // round-trip harness deep-compares them (each carries a ScalarValue).
  readonly translateX: readonly KeyframeSnapshot[];
  readonly translateY: readonly KeyframeSnapshot[];
  readonly scaleX: readonly KeyframeSnapshot[];
  readonly scaleY: readonly KeyframeSnapshot[];
  readonly shearX: readonly KeyframeSnapshot[];
  readonly shearY: readonly KeyframeSnapshot[];
}

// A plain per-slot timeline projection, keyed by the internal SlotId string.
export interface SlotTimelineSnapshot {
  readonly slotId: string;
  readonly color: readonly KeyframeSnapshot[];
  readonly attachment: readonly AttachmentFrameSnapshot[];
  readonly sequence: readonly SequenceKeyframeSnapshot[];
  readonly dark: readonly KeyframeSnapshot[];
  // Stage F2 (ADR-0009 section 4.2, PP-D10) split color tracks, promoted into the snapshot so the round-trip
  // harness deep-compares them (rgb carries an RgbValue, alpha an AlphaValue).
  readonly rgb: readonly KeyframeSnapshot[];
  readonly alpha: readonly KeyframeSnapshot[];
}

// Plain IK / transform / deform keyframe projections (WP-2.6/2.7/2.9), value copies in time order.
export interface IkKeyframeSnapshot {
  readonly id: string;
  readonly time: number;
  readonly mix: number;
  readonly bendPositive: boolean;
  readonly curve: CurveType;
}

export interface TransformKeyframeSnapshot {
  readonly id: string;
  readonly time: number;
  readonly mixRotate: number | undefined;
  readonly mixX: number | undefined;
  readonly mixY: number | undefined;
  readonly mixScaleX: number | undefined;
  readonly mixScaleY: number | undefined;
  readonly mixShearY: number | undefined;
  readonly curve: CurveType;
}

export interface DeformKeyframeSnapshot {
  readonly id: string;
  readonly time: number;
  readonly offsets: readonly number[];
  readonly curve: CurveType;
}

// A per-constraint IK timeline projection, keyed by the internal IkConstraintId string.
export interface IkTimelineSnapshot {
  readonly constraintId: string;
  readonly keyframes: readonly IkKeyframeSnapshot[];
}

// A per-constraint transform timeline projection, keyed by the internal TransformConstraintId string.
export interface TransformTimelineSnapshot {
  readonly constraintId: string;
  readonly keyframes: readonly TransformKeyframeSnapshot[];
}

// A per-(skin, slot, attachment) deform timeline projection. `skin` is the DeformSkinKey string ('default'
// or a SkinId), `slotId` the internal slot reference, `attachment` the attachment name.
export interface DeformTimelineSnapshot {
  readonly skin: string;
  readonly slotId: string;
  readonly attachment: string;
  readonly keyframes: readonly DeformKeyframeSnapshot[];
}

// A plain event-timeline key projection (Stage F1): the internal KeyframeId, the time, the referenced
// EventDefId string, and the int/float/string payload overrides (value copies). In time order.
export interface EventKeySnapshot {
  readonly id: string;
  readonly time: number;
  readonly event: string;
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
}

// A plain draw-order offset projection (Stage F1): the referenced SlotId string and the signed offset.
export interface DrawOrderOffsetSnapshot {
  readonly slot: string;
  readonly offset: number;
}

// A plain draw-order key projection (Stage F1): the internal KeyframeId, the time, and the compact offset
// list (in the stored order). In time order.
export interface DrawOrderKeySnapshot {
  readonly id: string;
  readonly time: number;
  readonly offsets: readonly DrawOrderOffsetSnapshot[];
}

// A plain animation projection. `bones`/`slots`/`ik`/`transform` are sorted by their internal id and
// `deform` by (skin, slotId, attachment), so the snapshot is deterministic and stable across renames.
// `drawOrder` and `events` are the timeline order (ascending / non-decreasing time).
export interface AnimationSnapshot {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly bones: readonly BoneTimelineSnapshot[]; // sorted by boneId
  readonly slots: readonly SlotTimelineSnapshot[]; // sorted by slotId
  readonly ik: readonly IkTimelineSnapshot[]; // sorted by constraintId
  readonly transform: readonly TransformTimelineSnapshot[]; // sorted by constraintId
  readonly deform: readonly DeformTimelineSnapshot[]; // sorted by (skin, slotId, attachment)
  readonly drawOrder: readonly DrawOrderKeySnapshot[]; // in time order (strictly ascending)
  readonly events: readonly EventKeySnapshot[]; // in time order (non-decreasing)
  // Stage F3 (ADR-0011, PP-D11) carried path-constraint timeline record, keyed by the on-disk constraint
  // NAME (path is carried verbatim, not id-resolved). Projected into the snapshot so the round-trip harness
  // compares it, mirroring the Stage F2 skin-scoping name lists; empty ({}) when the animation keys none.
  readonly path: AnimationEntity['path'];
}

// A plain event-definition projection (Stage F1): the internal EventDefId, the name, the payload defaults,
// and the optional audio hint (value copies), so a do/undo round-trip deep-equal covers an event edit.
export interface EventDefSnapshot {
  readonly id: string;
  readonly name: string;
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
  readonly audio: { readonly path: string; readonly volume: number; readonly balance: number } | undefined;
}

// A plain IK-constraint projection. `bones`/`target` are internal BoneId strings (references), stable
// across a bone rename.
export interface IkConstraintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly bones: readonly string[];
  readonly target: string;
  readonly mix: number;
  readonly bendPositive: boolean;
  // Stage F2 (ADR-0009 section 1) IK depth fields, promoted to editable by PP-D10 (SetIkDepthParams). Always
  // present (required on the entity); `order` is the OPTIONAL cross-array solve order, emitted only when set.
  readonly softness: number;
  readonly stretch: boolean;
  readonly compress: boolean;
  readonly uniform: boolean;
  readonly order?: number;
}

// A plain transform-constraint projection (all six mix and six offset channels).
export interface TransformConstraintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly bones: readonly string[];
  readonly target: string;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly mixScaleX: number;
  readonly mixScaleY: number;
  readonly mixShearY: number;
  readonly offsetRotation: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetScaleX: number;
  readonly offsetScaleY: number;
  readonly offsetShearY: number;
  // Stage F2 (ADR-0009 section 1.2) local/relative variant flags, promoted to editable by PP-D10
  // (SetTransformConstraintVariants). Always present; `order` is the OPTIONAL solve order, emitted when set.
  readonly local: boolean;
  readonly relative: boolean;
  readonly order?: number;
}

// A plain named-skin projection: its attachments as a flat sorted list (by slotId then name), the same
// shape the default skin uses in DocSnapshot.attachments.
export interface SkinSnapshot {
  readonly id: string;
  readonly name: string;
  readonly attachments: readonly AttachmentSnapshot[];
  // Stage F2 (ADR-0009 section 5, PP-D10) skin-scoping name lists, emitted only when present so an unscoped
  // skin round-trips deep-equal; promoted into the snapshot so the round-trip harness compares them.
  readonly bones?: readonly string[];
  readonly constraints?: readonly string[];
}

// A single symbol-library entry projection, tagged with its SymbolId key. The set is name/value-keyed
// (no internal id), so the snapshot lists each symbol's id string plus its SymbolAnimSet fields.
export interface SymbolAnimSetSnapshot {
  readonly symbolId: string;
  readonly skeletonRef: string;
  readonly idle: string;
  readonly land: string;
  readonly win: string;
  readonly anticipation?: string;
}

// A scene-ref-entry projection (name + content hash), in name order within each ref list.
export interface SceneRefEntrySnapshot {
  readonly name: string;
  readonly hash: string;
}

// A plain, deterministic slot-scene projection (phase-4 WP-4.5 / WP-4.6). The grid is a value copy; the
// symbol library is a list sorted by SymbolId; the sequencer / feature-flow / tumble configs are carried by
// value; the refs are name-sorted lists. So a do/undo round-trip deep-equal covers a SetGridConfig and a
// MapSymbolAnimSet edit. The grid/configs are deeply-frozen format values; the snapshot copies the grid and
// refs (which the commands mutate) and shares the immutable sequencer/feature/tumble values by reference.
export interface SlotSceneSnapshot {
  readonly grid: GridConfig;
  readonly symbols: readonly SymbolAnimSetSnapshot[]; // sorted by symbolId
  readonly winSequencer: SlotSceneState['winSequencer'];
  readonly featureFlows: SlotSceneState['featureFlows'];
  readonly tumble: SlotSceneState['tumble'];
  readonly skeletons: readonly SceneRefEntrySnapshot[]; // refs.skeletons, sorted by name
  readonly vfxPresets: readonly SceneRefEntrySnapshot[]; // refs.vfxPresets, sorted by name
}

// The full internal-state projection the round-trip harness deep-compares (command-history Section
// 3.4). Maps serialize as arrays sorted by id; order-significant arrays (boneOrder, slotOrder) preserve
// order; attachments sort by (slotId, name); animations sort by id with keyframes in time order;
// numbers are verbatim (undo restores stored mementos, so the round-trip is bit-exact, no epsilon).
export interface DocSnapshot {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: readonly BoneSnapshot[]; // sorted by id
  readonly boneOrder: readonly string[]; // order-significant
  readonly slots: readonly SlotSnapshot[]; // sorted by id
  readonly slotOrder: readonly string[]; // order-significant (draw order)
  readonly attachments: readonly AttachmentSnapshot[]; // sorted by (slotId, name)
  readonly animations: readonly AnimationSnapshot[]; // sorted by id
  readonly ikConstraints: readonly IkConstraintSnapshot[]; // sorted by id
  readonly ikConstraintOrder: readonly string[]; // order-significant (solve order)
  readonly transformConstraints: readonly TransformConstraintSnapshot[]; // sorted by id
  readonly transformConstraintOrder: readonly string[]; // order-significant (solve order)
  readonly skins: readonly SkinSnapshot[]; // sorted by id (NON-default named skins)
  readonly skinOrder: readonly string[]; // order-significant
  readonly events: readonly EventDefSnapshot[]; // sorted by id (document-level event definitions)
  readonly eventOrder: readonly string[]; // order-significant (on-disk emission order)
  readonly metadata: SkeletonMeta | undefined; // the optional skeleton metadata block, deep-copied
  readonly slotScene: SlotSceneSnapshot; // the always-present slot-scene aggregate (phase-4)
  readonly preserved: PreservedContent; // verbatim (already deeply immutable)
}

// Project a bone entity to its snapshot shape (a plain value copy).
export function boneToSnapshot(bone: BoneEntity): BoneSnapshot {
  return {
    id: bone.id,
    name: bone.name,
    parent: bone.parent,
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

// Project a slot entity to its snapshot shape (a plain value copy; colors copied so the snapshot never
// aliases the live model).
export function slotToSnapshot(slot: SlotEntity): SlotSnapshot {
  return {
    id: slot.id,
    name: slot.name,
    bone: slot.bone,
    color: { ...slot.color },
    darkColor: slot.darkColor === null ? null : { ...slot.darkColor },
    attachment: slot.attachment,
    blendMode: slot.blendMode,
  };
}

// Project one attachment to its snapshot shape, tagged with its owning slot id.
export function attachmentToSnapshot(slotId: SlotId, att: AttachmentEntity): AttachmentSnapshot {
  if (att.kind === 'region') {
    return {
      slotId,
      kind: 'region',
      name: att.name,
      path: att.path,
      x: att.x,
      y: att.y,
      rotation: att.rotation,
      scaleX: att.scaleX,
      scaleY: att.scaleY,
      width: att.width,
      height: att.height,
      color: { ...att.color },
      ...(att.sequence !== undefined ? { sequence: att.sequence } : {}),
    };
  }
  if (att.kind === 'mesh') {
    return {
      slotId,
      kind: 'mesh',
      name: att.name,
      path: att.path,
      uvs: att.uvs.slice(),
      triangles: att.triangles.slice(),
      hullLength: att.hullLength,
      width: att.width,
      height: att.height,
      color: { ...att.color },
      vertices: att.vertices.slice(),
      ...(att.edges !== undefined ? { edges: att.edges.slice() } : {}),
      ...(att.bones !== undefined ? { bones: att.bones.slice() } : {}),
      ...(att.sequence !== undefined ? { sequence: att.sequence } : {}),
    };
  }
  if (att.kind === 'linkedmesh') {
    return {
      slotId,
      kind: 'linkedmesh',
      name: att.name,
      path: att.path,
      parent: att.parent,
      ...(att.skin !== undefined ? { skin: att.skin } : {}),
      timelines: att.timelines,
      width: att.width,
      height: att.height,
      color: { ...att.color },
    };
  }
  if (att.kind === 'path') {
    return {
      slotId,
      kind: 'path',
      name: att.name,
      closed: att.closed,
      constantSpeed: att.constantSpeed,
      lengths: att.lengths.slice(),
      vertices: att.vertices.slice(),
    };
  }
  return { slotId, kind: 'preserved', name: att.name, value: att.value };
}

// Project one keyframe to its snapshot shape (value and curve deep-copied).
function keyframeToSnapshot(kf: KeyframeEntity): KeyframeSnapshot {
  return {
    id: kf.id,
    time: kf.time,
    value: cloneKeyframeValue(kf.value),
    curve: cloneCurve(kf.curve),
  };
}

function attachmentFrameToSnapshot(frame: AttachmentFrameEntity): AttachmentFrameSnapshot {
  return { id: frame.id, time: frame.time, name: frame.name };
}

function sequenceKeyframeToSnapshot(k: SequenceKeyframeEntity): SequenceKeyframeSnapshot {
  return { id: k.id, time: k.time, mode: k.mode, index: k.index, delay: k.delay };
}

function ikKeyframeToSnapshot(kf: IkKeyframeEntity): IkKeyframeSnapshot {
  return {
    id: kf.id,
    time: kf.time,
    mix: kf.mix,
    bendPositive: kf.bendPositive,
    curve: cloneCurve(kf.curve),
  };
}

function transformKeyframeToSnapshot(kf: TransformKeyframeEntity): TransformKeyframeSnapshot {
  return {
    id: kf.id,
    time: kf.time,
    mixRotate: kf.mixRotate,
    mixX: kf.mixX,
    mixY: kf.mixY,
    mixScaleX: kf.mixScaleX,
    mixScaleY: kf.mixScaleY,
    mixShearY: kf.mixShearY,
    curve: cloneCurve(kf.curve),
  };
}

function deformKeyframeToSnapshot(kf: DeformKeyframeEntity): DeformKeyframeSnapshot {
  return { id: kf.id, time: kf.time, offsets: kf.offsets.slice(), curve: cloneCurve(kf.curve) };
}

function eventKeyToSnapshot(key: EventKeyEntity): EventKeySnapshot {
  return {
    id: key.id,
    time: key.time,
    event: key.event,
    int: key.int,
    float: key.float,
    string: key.string,
  };
}

function drawOrderKeyToSnapshot(key: DrawOrderKeyEntity): DrawOrderKeySnapshot {
  return {
    id: key.id,
    time: key.time,
    offsets: key.offsets.map((entry) => ({ slot: entry.slot, offset: entry.offset })),
  };
}

// Project an event definition to its snapshot shape (payload defaults and audio hint deep-copied so the
// snapshot never aliases the live entity).
export function eventDefToSnapshot(def: EventDefEntity): EventDefSnapshot {
  return {
    id: def.id,
    name: def.name,
    int: def.int,
    float: def.float,
    string: def.string,
    audio:
      def.audio === undefined
        ? undefined
        : { path: def.audio.path, volume: def.audio.volume, balance: def.audio.balance },
  };
}

// Project an animation entity to its snapshot shape: bones/slots/ik/transform sorted by their internal id,
// deform sorted by (skin, slotId, attachment), each channel a value copy in time order. Keyframe arrays
// are already time-sorted in the model.
export function animationToSnapshot(animation: AnimationEntity): AnimationSnapshot {
  const bones: BoneTimelineSnapshot[] = [];
  for (const [boneId, set] of animation.bones) {
    bones.push({
      boneId,
      rotate: set.rotate.map(keyframeToSnapshot),
      translate: set.translate.map(keyframeToSnapshot),
      scale: set.scale.map(keyframeToSnapshot),
      shear: set.shear.map(keyframeToSnapshot),
      translateX: set.translateX.map(keyframeToSnapshot),
      translateY: set.translateY.map(keyframeToSnapshot),
      scaleX: set.scaleX.map(keyframeToSnapshot),
      scaleY: set.scaleY.map(keyframeToSnapshot),
      shearX: set.shearX.map(keyframeToSnapshot),
      shearY: set.shearY.map(keyframeToSnapshot),
    });
  }
  bones.sort((a, b) => (a.boneId < b.boneId ? -1 : a.boneId > b.boneId ? 1 : 0));
  const slots: SlotTimelineSnapshot[] = [];
  for (const [slotId, set] of animation.slots) {
    slots.push({
      slotId,
      color: set.color.map(keyframeToSnapshot),
      attachment: set.attachment.map(attachmentFrameToSnapshot),
      sequence: set.sequence.map(sequenceKeyframeToSnapshot),
      dark: set.dark.map(keyframeToSnapshot),
      rgb: set.rgb.map(keyframeToSnapshot),
      alpha: set.alpha.map(keyframeToSnapshot),
    });
  }
  slots.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  const ik: IkTimelineSnapshot[] = [];
  for (const [constraintId, frames] of animation.ik) {
    ik.push({ constraintId, keyframes: frames.map(ikKeyframeToSnapshot) });
  }
  ik.sort((a, b) =>
    a.constraintId < b.constraintId ? -1 : a.constraintId > b.constraintId ? 1 : 0,
  );
  const transform: TransformTimelineSnapshot[] = [];
  for (const [constraintId, frames] of animation.transform) {
    transform.push({ constraintId, keyframes: frames.map(transformKeyframeToSnapshot) });
  }
  transform.sort((a, b) =>
    a.constraintId < b.constraintId ? -1 : a.constraintId > b.constraintId ? 1 : 0,
  );
  const deform: DeformTimelineSnapshot[] = [];
  for (const [skin, bySlot] of animation.deform) {
    for (const [slotId, byName] of bySlot) {
      for (const [attachment, frames] of byName) {
        deform.push({ skin, slotId, attachment, keyframes: frames.map(deformKeyframeToSnapshot) });
      }
    }
  }
  deform.sort(
    (a, b) =>
      (a.skin < b.skin ? -1 : a.skin > b.skin ? 1 : 0) ||
      (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0) ||
      (a.attachment < b.attachment ? -1 : a.attachment > b.attachment ? 1 : 0),
  );
  // Carried path timelines (PP-D11): deep-copy each named track (value + curve) so the snapshot never
  // aliases the frozen model, with the constraint names sorted for a deterministic, stable projection.
  const path: Record<string, AnimationEntity['path'][string][number][]> = {};
  for (const name of Object.keys(animation.path).sort()) {
    path[name] = animation.path[name]!.map((frame) => ({
      time: frame.time,
      value: { ...frame.value },
      curve: cloneCurve(frame.curve),
    }));
  }
  return {
    id: animation.id,
    name: animation.name,
    duration: animation.duration,
    bones,
    slots,
    ik,
    transform,
    deform,
    drawOrder: animation.drawOrder.map(drawOrderKeyToSnapshot),
    events: animation.events.map(eventKeyToSnapshot),
    path,
  };
}

// Project an IK constraint to its snapshot shape (bones array copied so the snapshot never aliases).
export function ikConstraintToSnapshot(c: IkConstraintEntity): IkConstraintSnapshot {
  return {
    id: c.id,
    name: c.name,
    bones: c.bones.slice(),
    target: c.target,
    mix: c.mix,
    bendPositive: c.bendPositive,
    softness: c.softness,
    stretch: c.stretch,
    compress: c.compress,
    uniform: c.uniform,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Project a transform constraint to its snapshot shape (all six mix and six offset channels).
export function transformConstraintToSnapshot(
  c: TransformConstraintEntity,
): TransformConstraintSnapshot {
  return {
    id: c.id,
    name: c.name,
    bones: c.bones.slice(),
    target: c.target,
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

// Project a named skin to its snapshot shape: its attachments flattened to a sorted list (by slotId then
// name), the same shape DocSnapshot.attachments uses for the default skin.
export function skinToSnapshot(skin: SkinEntity): SkinSnapshot {
  const attachments: AttachmentSnapshot[] = [];
  for (const [slotId, inner] of skin.attachments) {
    for (const att of inner.values()) attachments.push(attachmentToSnapshot(slotId, att));
  }
  attachments.sort((a, b) =>
    a.slotId < b.slotId
      ? -1
      : a.slotId > b.slotId
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
  return {
    id: skin.id,
    name: skin.name,
    attachments,
    ...(skin.bones !== undefined ? { bones: [...skin.bones] } : {}),
    ...(skin.constraints !== undefined ? { constraints: [...skin.constraints] } : {}),
  };
}

// Project the slot-scene aggregate to its deterministic snapshot shape (phase-4 WP-4.5 / WP-4.6): the grid
// is a deep value copy; the symbol library is flattened to a list sorted by SymbolId; the refs are
// name-sorted lists; the sequencer / feature-flow / tumble configs are carried by value (deeply-frozen
// format values, shared by reference). `anticipation` is emitted only when present (exactOptionalProperty
// Types) so a mapped symbol with no anticipation round-trips deep-equal.
export function slotSceneToSnapshot(scene: SlotSceneState): SlotSceneSnapshot {
  const symbols: SymbolAnimSetSnapshot[] = [];
  for (const [id, set] of Object.entries(scene.symbols)) {
    symbols.push({
      symbolId: id,
      skeletonRef: set.skeletonRef,
      idle: set.idle,
      land: set.land,
      win: set.win,
      ...(set.anticipation !== undefined ? { anticipation: set.anticipation } : {}),
    });
  }
  symbols.sort((a, b) => (a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0));
  const byName = (a: SceneRefEntrySnapshot, b: SceneRefEntrySnapshot): number =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  const skeletons = scene.refs.skeletons
    .map((entry) => ({ name: entry.name, hash: entry.hash }))
    .sort(byName);
  const vfxPresets = scene.refs.vfxPresets
    .map((entry) => ({ name: entry.name, hash: entry.hash }))
    .sort(byName);
  return {
    grid: cloneGridConfig(scene.grid),
    symbols,
    winSequencer: scene.winSequencer,
    featureFlows: scene.featureFlows,
    tumble: scene.tumble,
    skeletons,
    vfxPresets,
  };
}

// Project the symbol library to a fresh SymbolId-keyed record (a value copy that never aliases the live
// scene). Used by the read accessor that hands out slotScene().symbols.
export function cloneSymbolLibrary(
  symbols: Readonly<Record<SymbolId, SymbolAnimSet>>,
): Record<SymbolId, SymbolAnimSet> {
  const out: Record<SymbolId, SymbolAnimSet> = {};
  for (const [id, set] of Object.entries(symbols)) {
    // Object.entries widens the key to string; the keys were branded SymbolIds when stored, so the
    // documented brand round-trip via cloneSymbolAnimSet keeps the value copy exact.
    out[id as SymbolId] = cloneSymbolAnimSet(set);
  }
  return out;
}

// Hand out a deep-copied, deep-frozen SlotSceneState so a read holder cannot mutate the live scene through
// the returned reference. The grid and refs are copied (the commands mutate them); the immutable sequencer/
// feature/tumble values are shared by reference (they are never patched in place).
export function freezeSlotSceneForReadOut(scene: SlotSceneState): SlotSceneState {
  return Object.freeze({
    grid: Object.freeze(cloneGridConfig(scene.grid)),
    symbols: Object.freeze(cloneSymbolLibrary(scene.symbols)),
    winSequencer: Object.freeze(cloneWinSequenceConfig(scene.winSequencer)),
    featureFlows: Object.freeze(cloneFeatureFlowGraph(scene.featureFlows)),
    tumble: scene.tumble,
    refs: Object.freeze(cloneSceneRefs(scene.refs)),
  });
}
