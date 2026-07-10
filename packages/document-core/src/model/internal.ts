import { decodeWeightedVertices, encodeWeightedVertices } from '@marionette/format';
import type { AtlasRef, SkeletonMeta, Sequence } from '@marionette/format/types';
import type {
  FeatureFlowGraph,
  GridConfig,
  SceneRefs,
  SymbolAnimSet,
  SymbolId,
  TumbleChoreography,
  WinSequenceConfig,
} from '@marionette/format/slot-types';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneChannel,
  BoneEntity,
  BoneTimelineSet,
  DeformKeyframeEntity,
  DeformSkinKey,
  DocState,
  DrawOrderKeyEntity,
  EventDefEntity,
  EventKeyEntity,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  MeshAttachmentEntity,
  MeshGeometry,
  PathConstraintEntity,
  PathGeometry,
  PathKeyframeEntity,
  PreservedContent,
  RegionAttachmentEntity,
  SkinEntity,
  SequenceKeyframeEntity,
  SlotEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from './doc-state';
import {
  cloneMetadata,
  isBoneTimelineSetEmpty,
  isSlotTimelineSetEmpty,
  makePathAttachment,
} from './doc-state';
import type { SlotSceneState } from './slot-scene';
import {
  cloneFeatureFlowGraph,
  cloneGridConfig,
  cloneSceneRefs,
  cloneSlotSceneState,
  cloneSymbolAnimSet,
  cloneTumbleChoreography,
  cloneWinSequenceConfig,
} from './slot-scene';
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
} from './ids';
import {
  animationToSnapshot,
  attachmentToSnapshot,
  boneToSnapshot,
  eventDefToSnapshot,
  freezeSlotSceneForReadOut,
  ikConstraintToSnapshot,
  pathConstraintToSnapshot,
  skinToSnapshot,
  slotSceneToSnapshot,
  slotToSnapshot,
  transformConstraintToSnapshot,
  type AnimationSnapshot,
  type AttachmentSnapshot,
  type DocSnapshot,
  type DocumentReadModel,
  type EventDefSnapshot,
  type IkConstraintSnapshot,
  type PathConstraintSnapshot,
  type SkinSnapshot,
  type TransformConstraintSnapshot,
} from './read-model';

// Internal mutable bone: the same fields as BoneEntity but writable, so BATCH mode can patch a field
// in place during a drag without cloning the bones map. Read accessors hand out frozen copies typed
// as the readonly BoneEntity, so this mutability never leaks outside the model.
interface MutableBone {
  id: BoneId;
  name: string;
  parent: BoneId | null;
  length: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  transformMode: BoneEntity['transformMode'];
}

// Internal mutable slot, same role as MutableBone. `color`/`darkColor` are replaced wholesale (a color
// edit patches the whole object), never mutated in place, so a frozen color reference is safe to share.
interface MutableSlot {
  id: SlotId;
  name: string;
  bone: BoneId;
  color: SlotEntity['color'];
  darkColor: SlotEntity['darkColor'];
  attachment: string | null;
  blendMode: SlotEntity['blendMode'];
}

function toMutableBone(bone: BoneEntity): MutableBone {
  return { ...bone };
}

function toMutableSlot(slot: SlotEntity): MutableSlot {
  return { ...slot };
}

function freezeBone(bone: MutableBone): BoneEntity {
  return Object.freeze({ ...bone });
}

// Freeze a slot for hand-out, deep-freezing its color objects so a caller cannot mutate them in place.
function freezeSlot(slot: MutableSlot): SlotEntity {
  return Object.freeze({
    ...slot,
    color: Object.freeze({ ...slot.color }),
    darkColor: slot.darkColor === null ? null : Object.freeze({ ...slot.darkColor }),
  });
}

// Freeze an attachment for hand-out. The region and mesh variants deep-freeze their color (and the mesh
// variant deep-freezes copies of its geometry arrays, so a caller cannot mutate uvs/triangles/vertices/
// edges/bones through a handed-out reference); the preserved variant already wraps a deeply-frozen
// verbatim format value.
function freezeAttachment(att: AttachmentEntity): AttachmentEntity {
  if (att.kind === 'region') {
    return Object.freeze({ ...att, color: Object.freeze({ ...att.color }) });
  }
  if (att.kind === 'mesh') {
    return Object.freeze({
      kind: 'mesh',
      name: att.name,
      path: att.path,
      uvs: Object.freeze(att.uvs.slice()),
      triangles: Object.freeze(att.triangles.slice()),
      hullLength: att.hullLength,
      width: att.width,
      height: att.height,
      color: Object.freeze({ ...att.color }),
      vertices: Object.freeze(att.vertices.slice()),
      ...(att.edges !== undefined ? { edges: Object.freeze(att.edges.slice()) } : {}),
      ...(att.bones !== undefined ? { bones: Object.freeze(att.bones.slice()) } : {}),
      // Stage F2 (ADR-0009) carried frame-sequence (deep-frozen at load), shared by reference.
      ...(att.sequence !== undefined ? { sequence: att.sequence } : {}),
    });
  }
  if (att.kind === 'linkedmesh') {
    return Object.freeze({
      kind: 'linkedmesh',
      name: att.name,
      path: att.path,
      parent: att.parent,
      ...(att.skin !== undefined ? { skin: att.skin } : {}),
      timelines: att.timelines,
      width: att.width,
      height: att.height,
      color: Object.freeze({ ...att.color }),
    });
  }
  if (att.kind === 'path') {
    return makePathAttachment(att);
  }
  return Object.freeze({ ...att });
}

// Recursively freeze the preserved (not-yet-promoted) body so it cannot be mutated through a read
// accessor or a snapshot. It is held verbatim and round-tripped unchanged in Phase 1.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// Clone the per-slot attachment maps so a fresh outer Map and fresh inner Maps make a reference-
// equality selector see exactly one change at a batch boundary (and so DISCRETE copies never alias).
function cloneAttachments(
  source: ReadonlyMap<SlotId, ReadonlyMap<string, AttachmentEntity>>,
): Map<SlotId, Map<string, AttachmentEntity>> {
  const out = new Map<SlotId, Map<string, AttachmentEntity>>();
  for (const [slotId, inner] of source) out.set(slotId, new Map(inner));
  return out;
}

// Rewrite one attachment's stored GLOBAL weighted-mesh bone indices when the model bone ORDER changes,
// so ADR-0002's index contract ("a weighted vertex boneIndex is the index into the CURRENT model bone
// order") holds after every reorder. `translate` maps an OLD global index to its NEW one. Returns the
// SAME reference when the attachment is not a weighted mesh or none of its indices move (so callers can
// skip copy-on-write and avoid map-identity churn). The codec is the single producer of the on-disk
// weighted layout, so decode -> remap -> encode keeps the stream and the ascending `bones` manifest
// consistent, and re-running the inverse translate on undo reproduces the exact prior encoding.
function remapWeightedMeshEntity(
  att: AttachmentEntity,
  translate: (oldIndex: number) => number,
): AttachmentEntity {
  if (att.kind !== 'mesh' || att.bones === undefined) return att;
  const bindings = decodeWeightedVertices({ vertices: [...att.vertices] });
  let changed = false;
  const remapped = bindings.map((vertex) =>
    vertex.map((influence) => {
      const nextIndex = translate(influence.boneIndex);
      if (nextIndex !== influence.boneIndex) changed = true;
      return { ...influence, boneIndex: nextIndex };
    }),
  );
  if (!changed) return att;
  const { vertices, bones } = encodeWeightedVertices(remapped);
  return { ...att, vertices, bones };
}

// Remap every weighted mesh in one (skin) attachment map. Returns the SAME map reference when nothing
// changed (fast path: no allocation, no identity change when a document has no weighted mesh); otherwise
// a fresh outer map that reuses each unchanged inner map and clones only the inner maps that changed.
function remapAttachmentMapWeighted(
  source: Map<SlotId, Map<string, AttachmentEntity>>,
  translate: (oldIndex: number) => number,
): Map<SlotId, Map<string, AttachmentEntity>> {
  let outerChanged = false;
  const next = new Map<SlotId, Map<string, AttachmentEntity>>();
  for (const [slotId, inner] of source) {
    let innerChanged = false;
    const nextInner = new Map<string, AttachmentEntity>();
    for (const [name, att] of inner) {
      const remapped = remapWeightedMeshEntity(att, translate);
      if (remapped !== att) innerChanged = true;
      nextInner.set(name, remapped);
    }
    if (innerChanged) {
      outerChanged = true;
      next.set(slotId, nextInner);
    } else {
      next.set(slotId, inner);
    }
  }
  return outerChanged ? next : source;
}

// Internal mutable bone timeline set: same channels as BoneTimelineSet but with writable arrays so the
// mutator can replace a channel wholesale. Keyframe OBJECTS are immutable (replaced, never patched), so
// the arrays carry shared frozen refs safely.
interface MutableBoneTimelineSet {
  rotate: KeyframeEntity[];
  translate: KeyframeEntity[];
  scale: KeyframeEntity[];
  shear: KeyframeEntity[];
  // Stage F2 (ADR-0009 section 4.1) per-component split tracks, now first-class editable channels (PP-D10)
  // replaced wholesale like the joint channels; keyframe OBJECTS stay immutable frozen refs.
  translateX: KeyframeEntity[];
  translateY: KeyframeEntity[];
  scaleX: KeyframeEntity[];
  scaleY: KeyframeEntity[];
  shearX: KeyframeEntity[];
  shearY: KeyframeEntity[];
}

interface MutableSlotTimelineSet {
  color: KeyframeEntity[];
  attachment: AttachmentFrameEntity[];
  // The sequence, dark, and Stage F2 (ADR-0009 section 4.2) split rgb/alpha timelines (PP-D10) are all
  // first-class editable channels like color/attachment, replaced wholesale; keyframe objects stay immutable.
  sequence: SequenceKeyframeEntity[];
  dark: KeyframeEntity[];
  rgb: KeyframeEntity[];
  alpha: KeyframeEntity[];
}

// Internal mutable deform map: skin -> slot -> attachment name -> keyframe array. The keyframe OBJECTS are
// immutable (replaced wholesale, never patched), so the arrays carry shared frozen refs safely.
type MutableDeformMap = Map<DeformSkinKey, Map<SlotId, Map<string, DeformKeyframeEntity[]>>>;

// Internal mutable animation: timelines keyed by branded id, with writable maps/arrays for batch mode. The
// ik/transform timelines are keyed by the constraint id; the deform timeline is the nested skin/slot/name
// map (the format `deform` shape).
interface MutableAnimation {
  id: AnimationId;
  name: string;
  duration: number;
  bones: Map<BoneId, MutableBoneTimelineSet>;
  slots: Map<SlotId, MutableSlotTimelineSet>;
  ik: Map<IkConstraintId, IkKeyframeEntity[]>;
  transform: Map<TransformConstraintId, TransformKeyframeEntity[]>;
  deform: MutableDeformMap;
  // Draw-order and event timelines (Stage F1, PP-D9). Replaced WHOLESALE by their commands (the key
  // objects are immutable), never patched in place, so a shared array reference is safe.
  drawOrder: readonly DrawOrderKeyEntity[];
  events: readonly EventKeyEntity[];
  // Stage F3 (ADR-0011 section 3) path-constraint timelines, id-keyed editable keyframes (PP-D11), the same
  // shape as ik/transform above; replaced per-channel by setPathChannel, never patched in place.
  path: Map<PathConstraintId, PathKeyframeEntity[]>;
}

function toMutableBoneSet(set: BoneTimelineSet): MutableBoneTimelineSet {
  return {
    rotate: set.rotate.slice(),
    translate: set.translate.slice(),
    scale: set.scale.slice(),
    shear: set.shear.slice(),
    translateX: set.translateX.slice(),
    translateY: set.translateY.slice(),
    scaleX: set.scaleX.slice(),
    scaleY: set.scaleY.slice(),
    shearX: set.shearX.slice(),
    shearY: set.shearY.slice(),
  };
}

function toMutableSlotSet(set: SlotTimelineSet): MutableSlotTimelineSet {
  return {
    color: set.color.slice(),
    attachment: set.attachment.slice(),
    sequence: set.sequence.slice(),
    dark: set.dark.slice(),
    rgb: set.rgb.slice(),
    alpha: set.alpha.slice(),
  };
}

// A fresh empty mutable bone timeline set (the create-on-write base for setBoneChannel), all ten channels
// present and empty.
function newMutableBoneSet(): MutableBoneTimelineSet {
  return {
    rotate: [],
    translate: [],
    scale: [],
    shear: [],
    translateX: [],
    translateY: [],
    scaleX: [],
    scaleY: [],
    shearX: [],
    shearY: [],
  };
}

// A fresh empty mutable slot timeline set (the create-on-write base for the slot channel writers).
function newMutableSlotSet(): MutableSlotTimelineSet {
  return { color: [], attachment: [], sequence: [], dark: [], rgb: [], alpha: [] };
}

// Deep-copy a deform map (fresh nested maps and sliced keyframe arrays) so an in-place edit to one copy
// never touches another. Used by both the readonly->mutable load and the discrete copy-on-write clone.
function cloneDeformMap(
  src: ReadonlyMap<
    DeformSkinKey,
    ReadonlyMap<SlotId, ReadonlyMap<string, readonly DeformKeyframeEntity[]>>
  >,
): MutableDeformMap {
  const out: MutableDeformMap = new Map();
  for (const [skinKey, bySlot] of src) {
    const slotMap = new Map<SlotId, Map<string, DeformKeyframeEntity[]>>();
    for (const [slotId, byName] of bySlot) {
      const nameMap = new Map<string, DeformKeyframeEntity[]>();
      for (const [name, frames] of byName) nameMap.set(name, frames.slice());
      slotMap.set(slotId, nameMap);
    }
    out.set(skinKey, slotMap);
  }
  return out;
}

function freezeDeformMap(
  src: MutableDeformMap,
): ReadonlyMap<
  DeformSkinKey,
  ReadonlyMap<SlotId, ReadonlyMap<string, readonly DeformKeyframeEntity[]>>
> {
  const out = new Map<
    DeformSkinKey,
    ReadonlyMap<SlotId, ReadonlyMap<string, readonly DeformKeyframeEntity[]>>
  >();
  for (const [skinKey, bySlot] of src) {
    const slotMap = new Map<SlotId, ReadonlyMap<string, readonly DeformKeyframeEntity[]>>();
    for (const [slotId, byName] of bySlot) {
      const nameMap = new Map<string, readonly DeformKeyframeEntity[]>();
      for (const [name, frames] of byName) nameMap.set(name, Object.freeze(frames.slice()));
      slotMap.set(slotId, nameMap);
    }
    out.set(skinKey, slotMap);
  }
  return out;
}

function toMutableAnimation(animation: AnimationEntity): MutableAnimation {
  const bones = new Map<BoneId, MutableBoneTimelineSet>();
  for (const [id, set] of animation.bones) bones.set(id, toMutableBoneSet(set));
  const slots = new Map<SlotId, MutableSlotTimelineSet>();
  for (const [id, set] of animation.slots) slots.set(id, toMutableSlotSet(set));
  const ik = new Map<IkConstraintId, IkKeyframeEntity[]>();
  for (const [id, frames] of animation.ik) ik.set(id, frames.slice());
  const transform = new Map<TransformConstraintId, TransformKeyframeEntity[]>();
  for (const [id, frames] of animation.transform) transform.set(id, frames.slice());
  const path = new Map<PathConstraintId, PathKeyframeEntity[]>();
  for (const [id, frames] of animation.path) path.set(id, frames.slice());
  return {
    id: animation.id,
    name: animation.name,
    duration: animation.duration,
    bones,
    slots,
    ik,
    transform,
    deform: cloneDeformMap(animation.deform),
    drawOrder: animation.drawOrder,
    events: animation.events,
    path,
  };
}

// Clone a mutable animation (deep enough that an in-place edit to the clone never touches the original):
// fresh maps and fresh channel arrays. Keyframe objects are shared by reference (immutable).
function cloneMutableAnimation(a: MutableAnimation): MutableAnimation {
  const bones = new Map<BoneId, MutableBoneTimelineSet>();
  for (const [id, set] of a.bones) bones.set(id, toMutableBoneSet(set));
  const slots = new Map<SlotId, MutableSlotTimelineSet>();
  for (const [id, set] of a.slots) slots.set(id, toMutableSlotSet(set));
  const ik = new Map<IkConstraintId, IkKeyframeEntity[]>();
  for (const [id, frames] of a.ik) ik.set(id, frames.slice());
  const transform = new Map<TransformConstraintId, TransformKeyframeEntity[]>();
  for (const [id, frames] of a.transform) transform.set(id, frames.slice());
  const path = new Map<PathConstraintId, PathKeyframeEntity[]>();
  for (const [id, frames] of a.path) path.set(id, frames.slice());
  return {
    id: a.id,
    name: a.name,
    duration: a.duration,
    bones,
    slots,
    ik,
    transform,
    deform: cloneDeformMap(a.deform),
    drawOrder: a.drawOrder,
    events: a.events,
    path,
  };
}

// Freeze a mutable animation for hand-out: a fresh readonly entity with fresh maps and frozen channel
// arrays (keyframe objects are already deep-frozen at construction).
function freezeAnimation(a: MutableAnimation): AnimationEntity {
  const bones = new Map<BoneId, BoneTimelineSet>();
  for (const [id, set] of a.bones) {
    bones.set(
      id,
      Object.freeze({
        rotate: Object.freeze(set.rotate.slice()),
        translate: Object.freeze(set.translate.slice()),
        scale: Object.freeze(set.scale.slice()),
        shear: Object.freeze(set.shear.slice()),
        translateX: Object.freeze(set.translateX.slice()),
        translateY: Object.freeze(set.translateY.slice()),
        scaleX: Object.freeze(set.scaleX.slice()),
        scaleY: Object.freeze(set.scaleY.slice()),
        shearX: Object.freeze(set.shearX.slice()),
        shearY: Object.freeze(set.shearY.slice()),
      }),
    );
  }
  const slots = new Map<SlotId, SlotTimelineSet>();
  for (const [id, set] of a.slots) {
    slots.set(
      id,
      Object.freeze({
        color: Object.freeze(set.color.slice()),
        attachment: Object.freeze(set.attachment.slice()),
        sequence: Object.freeze(set.sequence.slice()),
        dark: Object.freeze(set.dark.slice()),
        rgb: Object.freeze(set.rgb.slice()),
        alpha: Object.freeze(set.alpha.slice()),
      }),
    );
  }
  const ik = new Map<IkConstraintId, readonly IkKeyframeEntity[]>();
  for (const [id, frames] of a.ik) ik.set(id, Object.freeze(frames.slice()));
  const transform = new Map<TransformConstraintId, readonly TransformKeyframeEntity[]>();
  for (const [id, frames] of a.transform) transform.set(id, Object.freeze(frames.slice()));
  const path = new Map<PathConstraintId, readonly PathKeyframeEntity[]>();
  for (const [id, frames] of a.path) path.set(id, Object.freeze(frames.slice()));
  return Object.freeze({
    id: a.id,
    name: a.name,
    duration: a.duration,
    bones,
    slots,
    ik,
    transform,
    deform: freezeDeformMap(a.deform),
    drawOrder: Object.freeze(a.drawOrder.slice()),
    events: Object.freeze(a.events.slice()),
    path,
  });
}

function cloneAnimations(
  source: ReadonlyMap<AnimationId, MutableAnimation>,
): Map<AnimationId, MutableAnimation> {
  const out = new Map<AnimationId, MutableAnimation>();
  for (const [id, animation] of source) out.set(id, cloneMutableAnimation(animation));
  return out;
}

// Internal mutable constraints, same role as MutableBone/MutableSlot: BATCH mode patches a field in place
// during a slider drag without cloning the map; read accessors hand out frozen copies. `bones` is replaced
// wholesale (never mutated in place), so a shared array reference is safe.
interface MutableIkConstraint {
  id: IkConstraintId;
  name: string;
  bones: readonly BoneId[];
  target: BoneId;
  mix: number;
  bendPositive: boolean;
  // Stage F2 (ADR-0009) carried IK depth + optional order (see IkConstraintEntity).
  softness: number;
  stretch: boolean;
  compress: boolean;
  uniform: boolean;
  order?: number;
}

interface MutableTransformConstraint {
  id: TransformConstraintId;
  name: string;
  bones: readonly BoneId[];
  target: BoneId;
  mixRotate: number;
  mixX: number;
  mixY: number;
  mixScaleX: number;
  mixScaleY: number;
  mixShearY: number;
  offsetRotation: number;
  offsetX: number;
  offsetY: number;
  offsetScaleX: number;
  offsetScaleY: number;
  offsetShearY: number;
  // Stage F2 (ADR-0009) carried variant flags + optional order (see TransformConstraintEntity).
  local: boolean;
  relative: boolean;
  order?: number;
}

// Internal mutable named skin: its own attachment map (slotId -> name -> entity), the same shape as the
// model's default-skin attachmentsMap, so cloneAttachments and freezeAttachment are reused verbatim.
interface MutableSkin {
  id: SkinId;
  name: string;
  attachments: Map<SlotId, Map<string, AttachmentEntity>>;
  // Stage F2 (ADR-0009 section 5) carried skin-scoping name lists: immutable, shared by reference.
  bones?: readonly string[];
  constraints?: readonly string[];
}

// Spread only the PRESENT carried skin-scoping lists (exactOptionalPropertyTypes) so an unscoped skin stays
// unscoped through a copy. The lists are immutable name references, safely shared by reference.
function skinScoping(skin: SkinEntity | MutableSkin): Pick<SkinEntity, 'bones' | 'constraints'> {
  return {
    ...(skin.bones !== undefined ? { bones: skin.bones } : {}),
    ...(skin.constraints !== undefined ? { constraints: skin.constraints } : {}),
  };
}

function toMutableIk(c: IkConstraintEntity): MutableIkConstraint {
  return { ...c, bones: c.bones.slice() };
}

function freezeIk(c: MutableIkConstraint): IkConstraintEntity {
  return Object.freeze({ ...c, bones: Object.freeze(c.bones.slice()) });
}

function toMutableTransform(c: TransformConstraintEntity): MutableTransformConstraint {
  return { ...c, bones: c.bones.slice() };
}

function freezeTransform(c: MutableTransformConstraint): TransformConstraintEntity {
  return Object.freeze({ ...c, bones: Object.freeze(c.bones.slice()) });
}

interface MutablePathConstraint {
  id: PathConstraintId;
  name: string;
  target: SlotId;
  bones: readonly BoneId[];
  positionMode: PathConstraintEntity['positionMode'];
  spacingMode: PathConstraintEntity['spacingMode'];
  rotateMode: PathConstraintEntity['rotateMode'];
  position: number;
  spacing: number;
  offsetRotation: number;
  mixRotate: number;
  mixX: number;
  mixY: number;
  order?: number;
}

function toMutablePath(c: PathConstraintEntity): MutablePathConstraint {
  return { ...c, bones: c.bones.slice() };
}

function freezePath(c: MutablePathConstraint): PathConstraintEntity {
  return Object.freeze({ ...c, bones: Object.freeze(c.bones.slice()) });
}

function toMutableSkin(skin: SkinEntity): MutableSkin {
  return {
    id: skin.id,
    name: skin.name,
    attachments: cloneAttachments(skin.attachments),
    ...skinScoping(skin),
  };
}

function freezeSkin(skin: MutableSkin): SkinEntity {
  const attachments = new Map<SlotId, ReadonlyMap<string, AttachmentEntity>>();
  for (const [slotId, inner] of skin.attachments) {
    const frozen = new Map<string, AttachmentEntity>();
    for (const [name, att] of inner) frozen.set(name, freezeAttachment(att));
    attachments.set(slotId, frozen);
  }
  return Object.freeze({ id: skin.id, name: skin.name, attachments, ...skinScoping(skin) });
}

function cloneSkins(source: ReadonlyMap<SkinId, MutableSkin>): Map<SkinId, MutableSkin> {
  const out = new Map<SkinId, MutableSkin>();
  for (const [id, skin] of source) {
    out.set(id, {
      id: skin.id,
      name: skin.name,
      attachments: cloneAttachments(skin.attachments),
      ...skinScoping(skin),
    });
  }
  return out;
}

// The write-capable model (command-history Section 3.1). NEVER exported through the package barrel:
// only createMutator (history-internal) and History reach it, which is the structural half of LAW 2.
// Change detection is revision-based. Two mutation modes share observable results and differ only in
// allocation: DISCRETE (default) replaces the changed map by copy-on-write; BATCH (between
// beginBatch/commitBatch, one gesture) mutates in place and takes a single copy-on-write boundary at
// commitBatch, so a drag allocates O(1) per pointer-move instead of cloning the map each move.
export class DocumentModelInternal implements DocumentReadModel {
  readonly ids: IdFactory;
  private formatVersionValue: string;
  private nameValue: string;
  private bonesMap: Map<BoneId, MutableBone>;
  private boneOrderArr: BoneId[];
  private slotsMap: Map<SlotId, MutableSlot>;
  private slotOrderArr: SlotId[];
  private attachmentsMap: Map<SlotId, Map<string, AttachmentEntity>>;
  private animationsMap: Map<AnimationId, MutableAnimation>;
  private ikConstraintsMap: Map<IkConstraintId, MutableIkConstraint>;
  private ikConstraintOrderArr: IkConstraintId[];
  private transformConstraintsMap: Map<TransformConstraintId, MutableTransformConstraint>;
  private transformConstraintOrderArr: TransformConstraintId[];
  private pathConstraintsMap: Map<PathConstraintId, MutablePathConstraint>;
  private pathConstraintOrderArr: PathConstraintId[];
  private skinsMap: Map<SkinId, MutableSkin>;
  private skinOrderArr: SkinId[];
  // Document-level event definitions (Stage F1, PP-D9), keyed by EventDefId with an explicit order array
  // (mirroring skinsMap/skinOrderArr). Entities are immutable (frozen at construction), so the map shares
  // them by reference. `metadataValue` is the optional skeleton metadata block (undefined when absent).
  private eventsMap: Map<EventDefId, EventDefEntity>;
  private eventOrderArr: EventDefId[];
  private metadataValue: SkeletonMeta | undefined;
  // The slot-scene aggregate (phase-4 WP-4.5 / WP-4.6). Held as a single value whose members are replaced
  // WHOLESALE by the slot commands (grid, one symbol entry, refs), never patched in place, so a frozen copy
  // is safe to share by reference. There is no batch/discrete distinction worth threading per member: a grid
  // metric drag coalesces at the COMMAND level (SetGridConfig.coalesceWith), and each command applies an
  // absolute new scene value, so the model just swaps the value (revision bumps each swap so a coalesced
  // session still redraws). DISCRETE and BATCH both replace the held value object identically.
  private slotSceneValue: SlotSceneState;
  private preservedContent: PreservedContent;
  private batching = false;
  private revisionValue = 0;

  constructor(state: DocState, ids: IdFactory) {
    this.ids = ids;
    this.formatVersionValue = state.formatVersion;
    this.nameValue = state.name;
    this.bonesMap = new Map();
    for (const [id, bone] of state.bones) this.bonesMap.set(id, toMutableBone(bone));
    this.boneOrderArr = state.boneOrder.slice();
    this.slotsMap = new Map();
    for (const [id, slot] of state.slots) this.slotsMap.set(id, toMutableSlot(slot));
    this.slotOrderArr = state.slotOrder.slice();
    this.attachmentsMap = cloneAttachments(state.attachments);
    this.animationsMap = new Map();
    for (const [id, animation] of state.animations) {
      this.animationsMap.set(id, toMutableAnimation(animation));
    }
    this.ikConstraintsMap = new Map();
    for (const [id, c] of state.ikConstraints) this.ikConstraintsMap.set(id, toMutableIk(c));
    this.ikConstraintOrderArr = state.ikConstraintOrder.slice();
    this.transformConstraintsMap = new Map();
    for (const [id, c] of state.transformConstraints) {
      this.transformConstraintsMap.set(id, toMutableTransform(c));
    }
    this.transformConstraintOrderArr = state.transformConstraintOrder.slice();
    this.pathConstraintsMap = new Map();
    for (const [id, c] of state.pathConstraints) this.pathConstraintsMap.set(id, toMutablePath(c));
    this.pathConstraintOrderArr = state.pathConstraintOrder.slice();
    this.skinsMap = new Map();
    for (const [id, skin] of state.skins) this.skinsMap.set(id, toMutableSkin(skin));
    this.skinOrderArr = state.skinOrder.slice();
    // Event definitions are immutable value entities (frozen at construction), so the map carries them by
    // reference; the order array is sliced so the model never aliases the caller's DocState. Metadata is
    // deep-copied and frozen for the same isolation.
    this.eventsMap = new Map(state.events);
    this.eventOrderArr = state.eventOrder.slice();
    const metadata = cloneMetadata(state.metadata);
    this.metadataValue = metadata === undefined ? undefined : Object.freeze(metadata);
    // Deep-copy the incoming scene so the model never aliases the caller's DocState (the same isolation the
    // bones/slots maps get above). The grid and refs are copied; the immutable configs are shared.
    this.slotSceneValue = cloneSlotSceneState(state.slotScene);
    this.preservedContent = deepFreeze({
      atlas: state.preserved.atlas,
    });
  }

  get revision(): number {
    return this.revisionValue;
  }

  get name(): string {
    return this.nameValue;
  }

  get formatVersion(): string {
    return this.formatVersionValue;
  }

  getBone(id: BoneId): BoneEntity | undefined {
    const bone = this.bonesMap.get(id);
    return bone ? freezeBone(bone) : undefined;
  }

  bones(): readonly BoneEntity[] {
    const out: BoneEntity[] = [];
    for (const id of this.boneOrderArr) {
      const bone = this.bonesMap.get(id);
      if (bone) out.push(freezeBone(bone));
    }
    return out;
  }

  findBoneByName(name: string): BoneEntity | undefined {
    for (const id of this.boneOrderArr) {
      const bone = this.bonesMap.get(id);
      if (bone && bone.name === name) return freezeBone(bone);
    }
    return undefined;
  }

  getSlot(id: SlotId): SlotEntity | undefined {
    const slot = this.slotsMap.get(id);
    return slot ? freezeSlot(slot) : undefined;
  }

  slots(): readonly SlotEntity[] {
    const out: SlotEntity[] = [];
    for (const id of this.slotOrderArr) {
      const slot = this.slotsMap.get(id);
      if (slot) out.push(freezeSlot(slot));
    }
    return out;
  }

  attachments(slotId: SlotId): readonly AttachmentEntity[] {
    const inner = this.attachmentsMap.get(slotId);
    if (!inner) return [];
    return [...inner.values()]
      .map(freezeAttachment)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  getAttachment(slotId: SlotId, name: string): AttachmentEntity | undefined {
    const att = this.attachmentsMap.get(slotId)?.get(name);
    return att ? freezeAttachment(att) : undefined;
  }

  getAnimation(id: AnimationId): AnimationEntity | undefined {
    const animation = this.animationsMap.get(id);
    return animation ? freezeAnimation(animation) : undefined;
  }

  animations(): readonly AnimationEntity[] {
    return [...this.animationsMap.values()]
      .map(freezeAnimation)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  getIkConstraint(id: IkConstraintId): IkConstraintEntity | undefined {
    const c = this.ikConstraintsMap.get(id);
    return c ? freezeIk(c) : undefined;
  }

  ikConstraints(): readonly IkConstraintEntity[] {
    const out: IkConstraintEntity[] = [];
    for (const id of this.ikConstraintOrderArr) {
      const c = this.ikConstraintsMap.get(id);
      if (c) out.push(freezeIk(c));
    }
    return out;
  }

  getTransformConstraint(id: TransformConstraintId): TransformConstraintEntity | undefined {
    const c = this.transformConstraintsMap.get(id);
    return c ? freezeTransform(c) : undefined;
  }

  transformConstraints(): readonly TransformConstraintEntity[] {
    const out: TransformConstraintEntity[] = [];
    for (const id of this.transformConstraintOrderArr) {
      const c = this.transformConstraintsMap.get(id);
      if (c) out.push(freezeTransform(c));
    }
    return out;
  }

  getPathConstraint(id: PathConstraintId): PathConstraintEntity | undefined {
    const c = this.pathConstraintsMap.get(id);
    return c ? freezePath(c) : undefined;
  }

  pathConstraints(): readonly PathConstraintEntity[] {
    const out: PathConstraintEntity[] = [];
    for (const id of this.pathConstraintOrderArr) {
      const c = this.pathConstraintsMap.get(id);
      if (c) out.push(freezePath(c));
    }
    return out;
  }

  getSkin(id: SkinId): SkinEntity | undefined {
    const skin = this.skinsMap.get(id);
    return skin ? freezeSkin(skin) : undefined;
  }

  skins(): readonly SkinEntity[] {
    const out: SkinEntity[] = [];
    for (const id of this.skinOrderArr) {
      const skin = this.skinsMap.get(id);
      if (skin) out.push(freezeSkin(skin));
    }
    return out;
  }

  getEventDef(id: EventDefId): EventDefEntity | undefined {
    return this.eventsMap.get(id);
  }

  eventDefs(): readonly EventDefEntity[] {
    const out: EventDefEntity[] = [];
    for (const id of this.eventOrderArr) {
      const def = this.eventsMap.get(id);
      if (def) out.push(def);
    }
    return out;
  }

  findEventDefByName(name: string): EventDefEntity | undefined {
    for (const id of this.eventOrderArr) {
      const def = this.eventsMap.get(id);
      if (def && def.name === name) return def;
    }
    return undefined;
  }

  metadata(): SkeletonMeta | undefined {
    return cloneMetadata(this.metadataValue);
  }

  slotScene(): SlotSceneState {
    return freezeSlotSceneForReadOut(this.slotSceneValue);
  }

  slotGrid(): GridConfig {
    return Object.freeze(cloneGridConfig(this.slotSceneValue.grid));
  }

  slotTumble(): TumbleChoreography {
    return Object.freeze(cloneTumbleChoreography(this.slotSceneValue.tumble));
  }

  getSymbolAnimSet(symbolId: SymbolId): SymbolAnimSet | undefined {
    const set = this.slotSceneValue.symbols[symbolId];
    return set ? Object.freeze(cloneSymbolAnimSet(set)) : undefined;
  }

  preserved(): PreservedContent {
    return this.preservedContent;
  }

  snapshot(): DocSnapshot {
    const bones = [...this.bonesMap.values()]
      .map((bone) => boneToSnapshot(freezeBone(bone)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const slots = [...this.slotsMap.values()]
      .map((slot) => slotToSnapshot(freezeSlot(slot)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const attachments: AttachmentSnapshot[] = [];
    for (const [slotId, inner] of this.attachmentsMap) {
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
    const animations: AnimationSnapshot[] = [...this.animationsMap.values()]
      .map((animation) => animationToSnapshot(freezeAnimation(animation)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ikConstraints: IkConstraintSnapshot[] = [...this.ikConstraintsMap.values()]
      .map((c) => ikConstraintToSnapshot(freezeIk(c)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const transformConstraints: TransformConstraintSnapshot[] = [
      ...this.transformConstraintsMap.values(),
    ]
      .map((c) => transformConstraintToSnapshot(freezeTransform(c)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const pathConstraints: PathConstraintSnapshot[] = [...this.pathConstraintsMap.values()]
      .map((c) => pathConstraintToSnapshot(freezePath(c)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const skins: SkinSnapshot[] = [...this.skinsMap.values()]
      .map((skin) => skinToSnapshot(freezeSkin(skin)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const events: EventDefSnapshot[] = [...this.eventsMap.values()]
      .map(eventDefToSnapshot)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      formatVersion: this.formatVersionValue,
      name: this.nameValue,
      bones,
      boneOrder: this.boneOrderArr.slice(),
      slots,
      slotOrder: this.slotOrderArr.slice(),
      attachments,
      animations,
      ikConstraints,
      ikConstraintOrder: this.ikConstraintOrderArr.slice(),
      transformConstraints,
      transformConstraintOrder: this.transformConstraintOrderArr.slice(),
      pathConstraints,
      pathConstraintOrder: this.pathConstraintOrderArr.slice(),
      skins,
      skinOrder: this.skinOrderArr.slice(),
      events,
      eventOrder: this.eventOrderArr.slice(),
      metadata: cloneMetadata(this.metadataValue),
      slotScene: slotSceneToSnapshot(this.slotSceneValue),
      preserved: this.preservedContent,
    };
  }

  // ----- bone write surface (reached only through the Mutator, model/mutator.ts) -----

  insertBone(entity: BoneEntity, index: number): void {
    const bone = toMutableBone(entity);
    if (this.batching) {
      this.bonesMap.set(bone.id, bone);
      this.boneOrderArr.splice(index, 0, bone.id);
    } else {
      const next = new Map(this.bonesMap);
      next.set(bone.id, bone);
      this.bonesMap = next;
      const order = this.boneOrderArr.slice();
      order.splice(index, 0, bone.id);
      this.boneOrderArr = order;
    }
    // A bone appears at `index`, so every existing global index at or past it shifts up by one; the new
    // bone owns `index` and is referenced by no mesh yet (ADR-0002 remap invariant).
    this.remapWeightedMeshBones((oldIndex) => (oldIndex >= index ? oldIndex + 1 : oldIndex));
    this.revisionValue += 1;
  }

  removeBone(id: BoneId): void {
    const removedIndex = this.boneOrderArr.indexOf(id);
    if (this.batching) {
      this.bonesMap.delete(id);
      if (removedIndex >= 0) this.boneOrderArr.splice(removedIndex, 1);
    } else {
      const next = new Map(this.bonesMap);
      next.delete(id);
      this.bonesMap = next;
      this.boneOrderArr = this.boneOrderArr.filter((x) => x !== id);
    }
    // The bone at `removedIndex` is gone, so every global index past it shifts down by one; indices below
    // it are untouched (ADR-0002 remap invariant). A mesh still bound to the removed bone is a distinct
    // (delete-a-bound-bone) concern surfaced by the export validator, not remapped here.
    if (removedIndex >= 0) {
      this.remapWeightedMeshBones((oldIndex) =>
        oldIndex > removedIndex ? oldIndex - 1 : oldIndex,
      );
    }
    this.revisionValue += 1;
  }

  patchBone(id: BoneId, patch: Partial<Omit<BoneEntity, 'id'>>): void {
    const current = this.bonesMap.get(id);
    if (!current) return; // commands assert existence before patching; a missing id is a no-op here
    if (this.batching) {
      Object.assign(current, patch);
    } else {
      const next = new Map(this.bonesMap);
      next.set(id, { ...current, ...patch });
      this.bonesMap = next;
    }
    this.revisionValue += 1;
  }

  setBoneOrder(order: readonly BoneId[]): void {
    // Capture the prior order BEFORE it is replaced (in batch mode the array is mutated in place, so a
    // slice is mandatory) to translate each old global index to its position in the new permutation. A
    // reorder never drops a bone (reparent re-derives a topological order over the SAME id set), so a
    // bone missing from the new order leaves its indices untouched rather than corrupting them.
    const oldOrder = this.boneOrderArr.slice();
    const newIndexById = new Map<BoneId, number>();
    order.forEach((id, i) => newIndexById.set(id, i));
    if (this.batching) {
      this.boneOrderArr.length = 0;
      for (const id of order) this.boneOrderArr.push(id);
    } else {
      this.boneOrderArr = order.slice();
    }
    this.remapWeightedMeshBones((oldIndex) => {
      const boneId = oldOrder[oldIndex];
      if (boneId === undefined) return oldIndex;
      const newIndex = newIndexById.get(boneId);
      return newIndex === undefined ? oldIndex : newIndex;
    });
    this.revisionValue += 1;
  }

  // Rewrite every weighted mesh's stored GLOBAL bone indices (default skin AND named skins, since the
  // index is global regardless of the owning skin, ADR-0002) so the "indices refer to the CURRENT bone
  // order" invariant survives a create/reparent/delete that reorders bones. Part of the SAME mutator step
  // (one revision bump by the caller) and exactly reversed on undo, which restores the prior order and
  // re-runs the inverse translate, keeping the do/undo round-trip bit-exact. No-op (no allocation, no
  // map-identity churn) when no weighted mesh index actually moves, so the no-weighted-mesh path is free.
  private remapWeightedMeshBones(translate: (oldIndex: number) => number): void {
    const nextAttachments = remapAttachmentMapWeighted(this.attachmentsMap, translate);
    if (nextAttachments !== this.attachmentsMap) this.attachmentsMap = nextAttachments;

    let skinsChanged = false;
    const nextSkins = new Map<SkinId, MutableSkin>();
    for (const [id, skin] of this.skinsMap) {
      const nextInner = remapAttachmentMapWeighted(skin.attachments, translate);
      if (nextInner !== skin.attachments) {
        skinsChanged = true;
        // Preserve the Stage F2 (ADR-0009 section 5) skin-scoping name lists through the rebuild; a bone
        // reorder that triggers the weighted-mesh remap must not silently drop a skin's bones/constraints.
        nextSkins.set(id, {
          id: skin.id,
          name: skin.name,
          attachments: nextInner,
          ...skinScoping(skin),
        });
      } else {
        nextSkins.set(id, skin);
      }
    }
    if (skinsChanged) this.skinsMap = nextSkins;
  }

  // ----- slot write surface -----

  insertSlot(entity: SlotEntity, index: number): void {
    const slot = toMutableSlot(entity);
    if (this.batching) {
      this.slotsMap.set(slot.id, slot);
      this.slotOrderArr.splice(index, 0, slot.id);
    } else {
      const next = new Map(this.slotsMap);
      next.set(slot.id, slot);
      this.slotsMap = next;
      const order = this.slotOrderArr.slice();
      order.splice(index, 0, slot.id);
      this.slotOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeSlot(id: SlotId): void {
    if (this.batching) {
      this.slotsMap.delete(id);
      const i = this.slotOrderArr.indexOf(id);
      if (i >= 0) this.slotOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.slotsMap);
      next.delete(id);
      this.slotsMap = next;
      this.slotOrderArr = this.slotOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  // patchSlot edits the value fields (name, bone, color, darkColor, blendMode). The active attachment
  // is changed only through setActiveAttachment, so the two write paths never overlap.
  patchSlot(id: SlotId, patch: Partial<Omit<SlotEntity, 'id' | 'attachment'>>): void {
    const current = this.slotsMap.get(id);
    if (!current) return;
    if (this.batching) {
      Object.assign(current, patch);
    } else {
      const next = new Map(this.slotsMap);
      next.set(id, { ...current, ...patch });
      this.slotsMap = next;
    }
    this.revisionValue += 1;
  }

  setActiveAttachment(id: SlotId, name: string | null): void {
    const current = this.slotsMap.get(id);
    if (!current) return;
    if (this.batching) {
      current.attachment = name;
    } else {
      const next = new Map(this.slotsMap);
      next.set(id, { ...current, attachment: name });
      this.slotsMap = next;
    }
    this.revisionValue += 1;
  }

  setSlotOrder(order: readonly SlotId[]): void {
    if (this.batching) {
      this.slotOrderArr.length = 0;
      for (const id of order) this.slotOrderArr.push(id);
    } else {
      this.slotOrderArr = order.slice();
    }
    this.revisionValue += 1;
  }

  // ----- attachment write surface (default skin, keyed by SlotId then name) -----

  addAttachment(slotId: SlotId, entity: AttachmentEntity): void {
    if (this.batching) {
      const inner = this.attachmentsMap.get(slotId) ?? new Map<string, AttachmentEntity>();
      this.attachmentsMap.set(slotId, inner);
      inner.set(entity.name, entity);
    } else {
      const next = new Map(this.attachmentsMap);
      const inner = new Map(next.get(slotId) ?? []);
      inner.set(entity.name, entity);
      next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  removeAttachment(slotId: SlotId, name: string): void {
    if (this.batching) {
      const inner = this.attachmentsMap.get(slotId);
      if (!inner) return;
      inner.delete(name);
      if (inner.size === 0) this.attachmentsMap.delete(slotId);
    } else {
      const inner0 = this.attachmentsMap.get(slotId);
      if (!inner0) return;
      const next = new Map(this.attachmentsMap);
      const inner = new Map(inner0);
      inner.delete(name);
      if (inner.size === 0) next.delete(slotId);
      else next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  // patchAttachment edits a REGION attachment's transform/size fields. A non-region (preserved)
  // attachment is never patched, so the guard makes a wrong target a no-op rather than corrupting it.
  patchAttachment(
    slotId: SlotId,
    name: string,
    patch: Partial<Omit<RegionAttachmentEntity, 'kind' | 'name'>>,
  ): void {
    const inner0 = this.attachmentsMap.get(slotId);
    if (!inner0) return;
    const current = inner0.get(name);
    if (!current || current.kind !== 'region') return;
    const updated: RegionAttachmentEntity = { ...current, ...patch };
    if (this.batching) {
      inner0.set(name, updated);
    } else {
      const next = new Map(this.attachmentsMap);
      const inner = new Map(inner0);
      inner.set(name, updated);
      next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  // Set or CLEAR the Stage F2 frame-sequence block (ADR-0009 section 3) on a region or mesh attachment
  // (PP-D10). `undefined` DELETES the key (so a cleared attachment is byte-identical to one that never had a
  // sequence; a `{ sequence: undefined }` patch cannot express that under exactOptionalPropertyTypes). A
  // wrong or missing target, or a non-region/non-mesh attachment, is a no-op (the command asserts kind first).
  setAttachmentSequence(slotId: SlotId, name: string, sequence: Sequence | undefined): void {
    const inner0 = this.attachmentsMap.get(slotId);
    if (!inner0) return;
    const current = inner0.get(name);
    if (!current || (current.kind !== 'region' && current.kind !== 'mesh')) return;
    const { sequence: _omit, ...rest } = current;
    void _omit;
    const updated: AttachmentEntity = sequence === undefined ? rest : { ...rest, sequence };
    if (this.batching) {
      inner0.set(name, updated);
    } else {
      const next = new Map(this.attachmentsMap);
      const inner = new Map(inner0);
      inner.set(name, updated);
      next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  // setMeshGeometry replaces a MESH attachment's six geometry fields (uvs/triangles/hullLength/vertices/
  // edges/bones) WHOLESALE, preserving its identity fields (name/path/width/height/color). It is the one
  // write path for every mesh-edit command (WP-2.1); the kind swap region<->mesh goes through
  // addAttachment instead. A wrong or missing target is a no-op (commands assert kind 'mesh' before
  // writing). Arrays are sliced so the stored entity never aliases the command's memento.
  setMeshGeometry(slotId: SlotId, name: string, geometry: MeshGeometry): void {
    const inner0 = this.attachmentsMap.get(slotId);
    if (!inner0) return;
    const current = inner0.get(name);
    if (!current || current.kind !== 'mesh') return;
    const updated: MeshAttachmentEntity = {
      kind: 'mesh',
      name: current.name,
      path: current.path,
      width: current.width,
      height: current.height,
      color: current.color,
      uvs: geometry.uvs.slice(),
      triangles: geometry.triangles.slice(),
      hullLength: geometry.hullLength,
      vertices: geometry.vertices.slice(),
      ...(geometry.edges !== undefined ? { edges: geometry.edges.slice() } : {}),
      ...(geometry.bones !== undefined ? { bones: geometry.bones.slice() } : {}),
      // A geometry edit replaces only the six geometry fields; the carried F2 sequence (ADR-0009) is a
      // stable non-geometry field and survives, like path/width/height/color.
      ...(current.sequence !== undefined ? { sequence: current.sequence } : {}),
    };
    if (this.batching) {
      inner0.set(name, updated);
    } else {
      const next = new Map(this.attachmentsMap);
      const inner = new Map(inner0);
      inner.set(name, updated);
      next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  // setPathGeometry replaces a PATH attachment's four editable fields (closed/constantSpeed/lengths/
  // vertices) WHOLESALE, preserving its `name` identity (PP-D11). It is the one write path for every
  // path control-point / flag command; the arc-length `lengths` table is recomputed by the command layer
  // before the call (authoring owns it, ADR-0011). A wrong or missing target is a no-op (commands assert
  // kind 'path' before writing). Arrays are sliced so the stored entity never aliases the command memento.
  setPathGeometry(slotId: SlotId, name: string, geometry: PathGeometry): void {
    const inner0 = this.attachmentsMap.get(slotId);
    if (!inner0) return;
    const current = inner0.get(name);
    if (!current || current.kind !== 'path') return;
    const updated = makePathAttachment({
      name: current.name,
      closed: geometry.closed,
      constantSpeed: geometry.constantSpeed,
      lengths: geometry.lengths,
      vertices: geometry.vertices,
    });
    if (this.batching) {
      inner0.set(name, updated);
    } else {
      const next = new Map(this.attachmentsMap);
      const inner = new Map(inner0);
      inner.set(name, updated);
      next.set(slotId, inner);
      this.attachmentsMap = next;
    }
    this.revisionValue += 1;
  }

  // ----- animation + keyframe write surface (reached only through the Mutator) -----

  insertAnimation(entity: AnimationEntity): void {
    const animation = toMutableAnimation(entity);
    if (this.batching) {
      this.animationsMap.set(animation.id, animation);
    } else {
      const next = new Map(this.animationsMap);
      next.set(animation.id, animation);
      this.animationsMap = next;
    }
    this.revisionValue += 1;
  }

  removeAnimation(id: AnimationId): void {
    if (this.batching) {
      this.animationsMap.delete(id);
    } else {
      const next = new Map(this.animationsMap);
      next.delete(id);
      this.animationsMap = next;
    }
    this.revisionValue += 1;
  }

  patchAnimation(
    id: AnimationId,
    patch: { readonly name?: string; readonly duration?: number },
  ): void {
    this.writeAnimation(id, (animation) => {
      if (patch.name !== undefined) animation.name = patch.name;
      if (patch.duration !== undefined) animation.duration = patch.duration;
    });
  }

  // Replace one bone channel's keyframes. Creates the bone's timeline set on first write and prunes the
  // whole entry when the set returns to all-empty, so a channel set back to [] exactly reverses a prior
  // insert (the symmetry the do/undo round-trip relies on). The caller passes an already-sorted array.
  setBoneChannel(
    animId: AnimationId,
    boneId: BoneId,
    channel: BoneChannel,
    keyframes: readonly KeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.bones.get(boneId);
      if (keyframes.length === 0) {
        if (!set) return;
        set[channel] = [];
        if (isBoneTimelineSetEmpty(set)) animation.bones.delete(boneId);
        return;
      }
      if (!set) {
        set = newMutableBoneSet();
        animation.bones.set(boneId, set);
      }
      set[channel] = keyframes.slice();
    });
  }

  // Replace a slot's color-timeline keyframes (the only authored slot value channel in Phase 1). Same
  // create-on-write / prune-on-empty contract as setBoneChannel; an existing attachment timeline on the
  // slot keeps the entry alive even when color goes empty.
  setSlotColorChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (keyframes.length === 0) {
        if (!set) return;
        set.color = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.color = keyframes.slice();
    });
  }

  // Replace a slot's attachment-swap frames (the stepped animation.slots[slot].attachment timeline). Same
  // create-on-write / prune-on-empty contract as setSlotColorChannel; another non-empty channel on the slot
  // keeps the entry alive even when the attachment channel goes empty. The caller passes an already-time-
  // sorted array of immutable frames.
  setSlotAttachmentChannel(
    animId: AnimationId,
    slotId: SlotId,
    frames: readonly AttachmentFrameEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (frames.length === 0) {
        if (!set) return;
        set.attachment = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.attachment = frames.slice();
    });
  }

  // Replace a slot's frame-sequence keyframes (PP-D10). Same create-on-write / prune-on-empty contract as the
  // other slot channels; the caller passes an already-time-sorted (strict-ascending) array of immutable keys.
  setSlotSequenceChannel(
    animId: AnimationId,
    slotId: SlotId,
    keys: readonly SequenceKeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (keys.length === 0) {
        if (!set) return;
        set.sequence = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.sequence = keys.slice();
    });
  }

  // Replace a slot's dark-color (two-color tint) keyframes (PP-D10). Same create-on-write / prune-on-empty
  // contract as the other slot channels; the caller passes an already-time-sorted array of immutable keys.
  setSlotDarkChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (keyframes.length === 0) {
        if (!set) return;
        set.dark = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.dark = keyframes.slice();
    });
  }

  // Replace a slot's split rgb-color keyframes (Stage F2, ADR-0009 section 4.2, PP-D10). Same create-on-write
  // / prune-on-empty contract as the other slot channels; the caller passes an already-time-sorted array.
  setSlotRgbChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (keyframes.length === 0) {
        if (!set) return;
        set.rgb = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.rgb = keyframes.slice();
    });
  }

  // Replace a slot's split alpha-color keyframes (Stage F2, ADR-0009 section 4.2, PP-D10). Same
  // create-on-write / prune-on-empty contract as the other slot channels.
  setSlotAlphaChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      let set = animation.slots.get(slotId);
      if (keyframes.length === 0) {
        if (!set) return;
        set.alpha = [];
        if (isSlotTimelineSetEmpty(set)) animation.slots.delete(slotId);
        return;
      }
      if (!set) {
        set = newMutableSlotSet();
        animation.slots.set(slotId, set);
      }
      set.alpha = keyframes.slice();
    });
  }

  // Replace (or remove) a bone's WHOLE timeline set in one step. Used by the delete-bone/slot cascade to
  // prune all of a bone's tracks atomically and to restore them on undo. A null or all-empty set removes
  // the entry.
  setBoneTimelines(animId: AnimationId, boneId: BoneId, set: BoneTimelineSet | null): void {
    this.writeAnimation(animId, (animation) => {
      if (set === null || isBoneTimelineSetEmpty(set)) {
        animation.bones.delete(boneId);
        return;
      }
      animation.bones.set(boneId, toMutableBoneSet(set));
    });
  }

  setSlotTimelines(animId: AnimationId, slotId: SlotId, set: SlotTimelineSet | null): void {
    this.writeAnimation(animId, (animation) => {
      if (set === null || isSlotTimelineSetEmpty(set)) {
        animation.slots.delete(slotId);
        return;
      }
      animation.slots.set(slotId, toMutableSlotSet(set));
    });
  }

  // Replace a constraint's IK keyframe array on one animation (WP-2.6). An empty array prunes the entry
  // (the prune-on-empty symmetry the do/undo round-trip relies on); the caller passes an already-time-
  // sorted array of immutable frames.
  setIkChannel(
    animId: AnimationId,
    constraintId: IkConstraintId,
    keyframes: readonly IkKeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      if (keyframes.length === 0) animation.ik.delete(constraintId);
      else animation.ik.set(constraintId, keyframes.slice());
    });
  }

  // Replace a constraint's transform keyframe array on one animation (WP-2.7). Same prune-on-empty contract.
  setTransformChannel(
    animId: AnimationId,
    constraintId: TransformConstraintId,
    keyframes: readonly TransformKeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      if (keyframes.length === 0) animation.transform.delete(constraintId);
      else animation.transform.set(constraintId, keyframes.slice());
    });
  }

  // Replace the deform keyframes for one skin/slot/attachment on one animation (WP-2.9). An empty array
  // prunes the attachment entry, then the slot map, then the skin map as each becomes empty, so clearing
  // exactly reverses a prior set (round-trip symmetry). The caller passes an already-time-sorted array.
  setDeformChannel(
    animId: AnimationId,
    skinKey: DeformSkinKey,
    slotId: SlotId,
    attachmentName: string,
    keyframes: readonly DeformKeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      const bySlot = animation.deform.get(skinKey);
      if (keyframes.length === 0) {
        if (!bySlot) return;
        const byName = bySlot.get(slotId);
        if (!byName) return;
        byName.delete(attachmentName);
        if (byName.size === 0) bySlot.delete(slotId);
        if (bySlot.size === 0) animation.deform.delete(skinKey);
        return;
      }
      let slotMap = bySlot;
      if (!slotMap) {
        slotMap = new Map();
        animation.deform.set(skinKey, slotMap);
      }
      let nameMap = slotMap.get(slotId);
      if (!nameMap) {
        nameMap = new Map();
        slotMap.set(slotId, nameMap);
      }
      nameMap.set(attachmentName, keyframes.slice());
    });
  }

  // Replace an animation's event timeline WHOLESALE (Stage F1 event.key.* commands). The key objects are
  // immutable; the caller passes an already-time-ordered (non-decreasing) array. An empty array clears the
  // timeline, exactly reversing a prior set (the round-trip symmetry).
  setEventTimeline(animId: AnimationId, keys: readonly EventKeyEntity[]): void {
    this.writeAnimation(animId, (animation) => {
      animation.events = keys.slice();
    });
  }

  // Replace an animation's draw-order timeline WHOLESALE (Stage F1 draworder.key.* commands). Same contract
  // as setEventTimeline; the caller passes an already-time-sorted (strictly ascending) array.
  setDrawOrderTimeline(animId: AnimationId, keys: readonly DrawOrderKeyEntity[]): void {
    this.writeAnimation(animId, (animation) => {
      animation.drawOrder = keys.slice();
    });
  }

  // The single copy-on-write boundary for an animation edit: DISCRETE clones the target animation (so a
  // reference-equality selector sees exactly one change and siblings stay shared), BATCH mutates it in
  // place. A missing id is a no-op (commands assert existence before writing).
  private writeAnimation(id: AnimationId, mutate: (animation: MutableAnimation) => void): void {
    const current = this.animationsMap.get(id);
    if (!current) return;
    if (this.batching) {
      mutate(current);
    } else {
      const clone = cloneMutableAnimation(current);
      mutate(clone);
      const next = new Map(this.animationsMap);
      next.set(id, clone);
      this.animationsMap = next;
    }
    this.revisionValue += 1;
  }

  // ----- constraint write surface (WP-2.6 / WP-2.7, reached only through the Mutator) -----

  insertIkConstraint(entity: IkConstraintEntity, index: number): void {
    const c = toMutableIk(entity);
    if (this.batching) {
      this.ikConstraintsMap.set(c.id, c);
      this.ikConstraintOrderArr.splice(index, 0, c.id);
    } else {
      const next = new Map(this.ikConstraintsMap);
      next.set(c.id, c);
      this.ikConstraintsMap = next;
      const order = this.ikConstraintOrderArr.slice();
      order.splice(index, 0, c.id);
      this.ikConstraintOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeIkConstraint(id: IkConstraintId): void {
    if (this.batching) {
      this.ikConstraintsMap.delete(id);
      const i = this.ikConstraintOrderArr.indexOf(id);
      if (i >= 0) this.ikConstraintOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.ikConstraintsMap);
      next.delete(id);
      this.ikConstraintsMap = next;
      this.ikConstraintOrderArr = this.ikConstraintOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  patchIkConstraint(id: IkConstraintId, patch: Partial<Omit<IkConstraintEntity, 'id'>>): void {
    const current = this.ikConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      Object.assign(current, patch);
    } else {
      const next = new Map(this.ikConstraintsMap);
      next.set(id, { ...current, ...patch });
      this.ikConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  // Set or CLEAR an IK constraint's OPTIONAL explicit solve order (ADR-0009 section 1.3). A number assigns
  // the order; `undefined` DELETES the key (so a cleared constraint is byte-identical to one that never had
  // an order, which the plain patch path cannot express: a `{ order: undefined }` patch would leave the key
  // present). Used by ReorderConstraints; a missing id is a no-op (the command asserts existence first).
  setIkConstraintOrder(id: IkConstraintId, order: number | undefined): void {
    const current = this.ikConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      if (order === undefined) delete current.order;
      else current.order = order;
    } else {
      const updated: MutableIkConstraint = { ...current };
      if (order === undefined) delete updated.order;
      else updated.order = order;
      const next = new Map(this.ikConstraintsMap);
      next.set(id, updated);
      this.ikConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  insertTransformConstraint(entity: TransformConstraintEntity, index: number): void {
    const c = toMutableTransform(entity);
    if (this.batching) {
      this.transformConstraintsMap.set(c.id, c);
      this.transformConstraintOrderArr.splice(index, 0, c.id);
    } else {
      const next = new Map(this.transformConstraintsMap);
      next.set(c.id, c);
      this.transformConstraintsMap = next;
      const order = this.transformConstraintOrderArr.slice();
      order.splice(index, 0, c.id);
      this.transformConstraintOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeTransformConstraint(id: TransformConstraintId): void {
    if (this.batching) {
      this.transformConstraintsMap.delete(id);
      const i = this.transformConstraintOrderArr.indexOf(id);
      if (i >= 0) this.transformConstraintOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.transformConstraintsMap);
      next.delete(id);
      this.transformConstraintsMap = next;
      this.transformConstraintOrderArr = this.transformConstraintOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  patchTransformConstraint(
    id: TransformConstraintId,
    patch: Partial<Omit<TransformConstraintEntity, 'id'>>,
  ): void {
    const current = this.transformConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      Object.assign(current, patch);
    } else {
      const next = new Map(this.transformConstraintsMap);
      next.set(id, { ...current, ...patch });
      this.transformConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  // Set or CLEAR a transform constraint's OPTIONAL explicit solve order (ADR-0009 section 1.3), the mirror of
  // setIkConstraintOrder. `undefined` deletes the key so a cleared constraint is byte-identical to one that
  // never had an order. Used by ReorderConstraints; a missing id is a no-op.
  setTransformConstraintOrder(id: TransformConstraintId, order: number | undefined): void {
    const current = this.transformConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      if (order === undefined) delete current.order;
      else current.order = order;
    } else {
      const updated: MutableTransformConstraint = { ...current };
      if (order === undefined) delete updated.order;
      else updated.order = order;
      const next = new Map(this.transformConstraintsMap);
      next.set(id, updated);
      this.transformConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  // ----- path-constraint write surface (Stage F3, PP-D11, reached only through the Mutator) -----

  insertPathConstraint(entity: PathConstraintEntity, index: number): void {
    const c = toMutablePath(entity);
    if (this.batching) {
      this.pathConstraintsMap.set(c.id, c);
      this.pathConstraintOrderArr.splice(index, 0, c.id);
    } else {
      const next = new Map(this.pathConstraintsMap);
      next.set(c.id, c);
      this.pathConstraintsMap = next;
      const order = this.pathConstraintOrderArr.slice();
      order.splice(index, 0, c.id);
      this.pathConstraintOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removePathConstraint(id: PathConstraintId): void {
    if (this.batching) {
      this.pathConstraintsMap.delete(id);
      const i = this.pathConstraintOrderArr.indexOf(id);
      if (i >= 0) this.pathConstraintOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.pathConstraintsMap);
      next.delete(id);
      this.pathConstraintsMap = next;
      this.pathConstraintOrderArr = this.pathConstraintOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  patchPathConstraint(
    id: PathConstraintId,
    patch: Partial<Omit<PathConstraintEntity, 'id'>>,
  ): void {
    const current = this.pathConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      Object.assign(current, patch);
    } else {
      const next = new Map(this.pathConstraintsMap);
      next.set(id, { ...current, ...patch });
      this.pathConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  // Set or CLEAR a path constraint's OPTIONAL explicit solve order (ADR-0011 section 2.3), the mirror of
  // setIkConstraintOrder / setTransformConstraintOrder. `undefined` deletes the key. Used by ReorderConstraints.
  setPathConstraintOrder(id: PathConstraintId, order: number | undefined): void {
    const current = this.pathConstraintsMap.get(id);
    if (!current) return;
    if (this.batching) {
      if (order === undefined) delete current.order;
      else current.order = order;
    } else {
      const updated: MutablePathConstraint = { ...current };
      if (order === undefined) delete updated.order;
      else updated.order = order;
      const next = new Map(this.pathConstraintsMap);
      next.set(id, updated);
      this.pathConstraintsMap = next;
    }
    this.revisionValue += 1;
  }

  // Replace a path constraint's keyframe array on one animation (PP-D11), the mirror of setIkChannel /
  // setTransformChannel. An empty array PRUNES the constraint entry (so clearing exactly reverses a set and a
  // deleted constraint leaves no orphan track, which would fail ANIM_PATH_UNKNOWN on export). The caller
  // passes an already-time-sorted array.
  setPathChannel(
    animId: AnimationId,
    constraintId: PathConstraintId,
    keyframes: readonly PathKeyframeEntity[],
  ): void {
    this.writeAnimation(animId, (animation) => {
      if (keyframes.length === 0) animation.path.delete(constraintId);
      else animation.path.set(constraintId, keyframes.slice());
    });
  }

  // ----- named-skin write surface (WP-2.8, reached only through the Mutator) -----

  insertSkin(entity: SkinEntity, index: number): void {
    const skin = toMutableSkin(entity);
    if (this.batching) {
      this.skinsMap.set(skin.id, skin);
      this.skinOrderArr.splice(index, 0, skin.id);
    } else {
      const next = new Map(this.skinsMap);
      next.set(skin.id, skin);
      this.skinsMap = next;
      const order = this.skinOrderArr.slice();
      order.splice(index, 0, skin.id);
      this.skinOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeSkin(id: SkinId): void {
    if (this.batching) {
      this.skinsMap.delete(id);
      const i = this.skinOrderArr.indexOf(id);
      if (i >= 0) this.skinOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.skinsMap);
      next.delete(id);
      this.skinsMap = next;
      this.skinOrderArr = this.skinOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  patchSkin(id: SkinId, patch: { readonly name?: string }): void {
    const current = this.skinsMap.get(id);
    if (!current) return;
    if (this.batching) {
      if (patch.name !== undefined) current.name = patch.name;
    } else {
      const next = new Map(this.skinsMap);
      next.set(id, { ...current, ...(patch.name !== undefined ? { name: patch.name } : {}) });
      this.skinsMap = next;
    }
    this.revisionValue += 1;
  }

  // Set (or clear) a named skin's Stage F2 (ADR-0009 section 5) scoping list. An undefined or empty list
  // removes the field (the skin is unscoped in that dimension), keeping the model canonical (no empty-array
  // scoping). A missing skin is a no-op (commands assert existence before writing).
  setSkinScope(
    skinId: SkinId,
    scope: 'bones' | 'constraints',
    names: readonly string[] | undefined,
  ): void {
    const current = this.skinsMap.get(skinId);
    if (!current) return;
    const value = names && names.length > 0 ? Object.freeze(names.slice()) : undefined;
    if (this.batching) {
      if (value === undefined) delete current[scope];
      else current[scope] = value;
    } else {
      const next = new Map(this.skinsMap);
      const updated: MutableSkin = { ...current };
      if (value === undefined) delete updated[scope];
      else updated[scope] = value;
      next.set(skinId, updated);
      this.skinsMap = next;
    }
    this.revisionValue += 1;
  }

  // Place an attachment in a NAMED skin under (slotId, entity.name), the mirror of the default-skin
  // addAttachment path but scoped to one skin's own attachment map. A missing skin is a no-op (commands
  // assert existence before writing).
  setSkinAttachment(skinId: SkinId, slotId: SlotId, entity: AttachmentEntity): void {
    const current = this.skinsMap.get(skinId);
    if (!current) return;
    if (this.batching) {
      const inner = current.attachments.get(slotId) ?? new Map<string, AttachmentEntity>();
      current.attachments.set(slotId, inner);
      inner.set(entity.name, entity);
    } else {
      const inner = new Map(current.attachments.get(slotId) ?? []);
      inner.set(entity.name, entity);
      const attachments = new Map(current.attachments);
      attachments.set(slotId, inner);
      const next = new Map(this.skinsMap);
      next.set(skinId, { ...current, attachments });
      this.skinsMap = next;
    }
    this.revisionValue += 1;
  }

  removeSkinAttachment(skinId: SkinId, slotId: SlotId, name: string): void {
    const current = this.skinsMap.get(skinId);
    if (!current) return;
    if (this.batching) {
      const inner = current.attachments.get(slotId);
      if (!inner) return;
      inner.delete(name);
      if (inner.size === 0) current.attachments.delete(slotId);
    } else {
      const inner0 = current.attachments.get(slotId);
      if (!inner0) return;
      const innerNext = new Map(inner0);
      innerNext.delete(name);
      const attachments = new Map(current.attachments);
      if (innerNext.size === 0) attachments.delete(slotId);
      else attachments.set(slotId, innerNext);
      const next = new Map(this.skinsMap);
      next.set(skinId, { ...current, attachments });
      this.skinsMap = next;
    }
    this.revisionValue += 1;
  }

  // ----- slot-scene write surface (phase-4 WP-4.5 / WP-4.6, reached only through the Mutator) -----

  // Replace the slot grid WHOLESALE (SetGridConfig). The grid is deep-copied on the way in so the stored
  // scene never aliases the command's value. A fresh scene object is allocated (one reference change) in
  // both modes: the held value is a single object replaced atomically, so there is no in-place batch path
  // (a grid-metric drag coalesces at the command level, not by mutating the live grid).
  setSlotGrid(grid: GridConfig): void {
    this.slotSceneValue = { ...this.slotSceneValue, grid: cloneGridConfig(grid) };
    this.revisionValue += 1;
  }

  // Set (add or replace) one symbol's SymbolAnimSet (MapSymbolAnimSet do). The set is deep-copied; a fresh
  // symbols record and a fresh scene object are allocated so a reference-equality selector sees one change.
  setSymbolAnimSet(symbolId: SymbolId, set: SymbolAnimSet): void {
    const symbols = { ...this.slotSceneValue.symbols, [symbolId]: cloneSymbolAnimSet(set) };
    this.slotSceneValue = { ...this.slotSceneValue, symbols };
    this.revisionValue += 1;
  }

  // Remove one symbol's mapping (MapSymbolAnimSet do with a null target, and undo of an add). A missing key
  // is a no-op (commands assert intent before writing). A fresh record and scene object are allocated.
  removeSymbolAnimSet(symbolId: SymbolId): void {
    if (!(symbolId in this.slotSceneValue.symbols)) return;
    const symbols: Record<SymbolId, SymbolAnimSet> = {};
    for (const [id, value] of Object.entries(this.slotSceneValue.symbols)) {
      if (id === symbolId) continue;
      symbols[id as SymbolId] = value;
    }
    this.slotSceneValue = { ...this.slotSceneValue, symbols };
    this.revisionValue += 1;
  }

  // Replace the scene refs WHOLESALE (MapSymbolAnimSet's refs.skeletons add/prune bookkeeping). The refs are
  // deep-copied; a fresh scene object is allocated. Driven only as part of a MapSymbolAnimSet composite.
  setSceneRefs(refs: SceneRefs): void {
    this.slotSceneValue = { ...this.slotSceneValue, refs: cloneSceneRefs(refs) };
    this.revisionValue += 1;
  }

  // Replace the win sequencer config WHOLESALE (the WP-4.8 slot.winseq.* commands). The config is
  // deep-copied so the model never aliases a command-held value, and a fresh scene object is allocated so a
  // reference-equality selector sees one change. The config is a single immutable value replaced atomically
  // (there is no in-place batch path; a step/threshold drag coalesces at the command level), mirroring how
  // setSlotGrid replaces the grid.
  setSlotWinSequencer(config: WinSequenceConfig): void {
    this.slotSceneValue = { ...this.slotSceneValue, winSequencer: cloneWinSequenceConfig(config) };
    this.revisionValue += 1;
  }

  // Replace the feature-flow graph WHOLESALE (the WP-4.9 slot.flow.* commands). The graph is deep-copied so
  // the model never aliases a command-held value, and a fresh scene object is allocated so a
  // reference-equality selector sees one change. The graph is a single immutable value replaced atomically
  // (there is no in-place batch path; a flow edit is a discrete authoring action, never a drag), mirroring
  // how setSlotWinSequencer replaces the win sequencer.
  setSlotFeatureFlows(graph: FeatureFlowGraph): void {
    this.slotSceneValue = { ...this.slotSceneValue, featureFlows: cloneFeatureFlowGraph(graph) };
    this.revisionValue += 1;
  }

  // Replace the tumble choreography WHOLESALE (the WP-4.10 SetTumbleChoreography command). The choreography
  // is deep-copied so the model never aliases a command-held value, and a fresh scene object is allocated so
  // a reference-equality selector sees one change. The choreography is a single immutable value replaced
  // atomically (a timing-slider drag coalesces at the COMMAND level, not by mutating the live value),
  // mirroring how setSlotGrid replaces the grid.
  setSlotTumble(tumble: TumbleChoreography): void {
    this.slotSceneValue = { ...this.slotSceneValue, tumble: cloneTumbleChoreography(tumble) };
    this.revisionValue += 1;
  }

  // ----- preserved-content write surface (reached only through the Mutator) -----

  // Replace the preserved atlas wholesale (WP-1.3, command-history catalog SetAtlasRef). preservedContent
  // is a single immutable value, replaced with a fresh deeply-frozen object (the same way the constructor
  // builds it), so there is no in-place/copy-on-write distinction and no batch branch: an atlas import is
  // a discrete edit, never part of a drag. NO content hash is computed here (the exporter is the sole hash
  // owner, LAW 3).
  setAtlas(atlas: AtlasRef): void {
    this.preservedContent = deepFreeze({ atlas });
    this.revisionValue += 1;
  }

  // ----- event-definition + metadata write surface (Stage F1, PP-D9, reached only through the Mutator) -----

  insertEventDef(entity: EventDefEntity, index: number): void {
    if (this.batching) {
      this.eventsMap.set(entity.id, entity);
      this.eventOrderArr.splice(index, 0, entity.id);
    } else {
      const next = new Map(this.eventsMap);
      next.set(entity.id, entity);
      this.eventsMap = next;
      const order = this.eventOrderArr.slice();
      order.splice(index, 0, entity.id);
      this.eventOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeEventDef(id: EventDefId): void {
    if (this.batching) {
      this.eventsMap.delete(id);
      const i = this.eventOrderArr.indexOf(id);
      if (i >= 0) this.eventOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.eventsMap);
      next.delete(id);
      this.eventsMap = next;
      this.eventOrderArr = this.eventOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  // Replace one event definition WHOLESALE (rename / set-defaults / set-audio). The entity is immutable
  // (frozen at construction), so the map just swaps the reference. A missing id is a no-op (commands assert
  // existence before writing).
  setEventDef(id: EventDefId, entity: EventDefEntity): void {
    if (!this.eventsMap.has(id)) return;
    if (this.batching) {
      this.eventsMap.set(id, entity);
    } else {
      const next = new Map(this.eventsMap);
      next.set(id, entity);
      this.eventsMap = next;
    }
    this.revisionValue += 1;
  }

  // Replace the optional metadata block WHOLESALE (SetDocumentMetadata). The value is deep-copied and frozen
  // so the model never aliases a command-held value; undefined clears the block.
  setMetadata(metadata: SkeletonMeta | undefined): void {
    const cloned = cloneMetadata(metadata);
    this.metadataValue = cloned === undefined ? undefined : Object.freeze(cloned);
    this.revisionValue += 1;
  }

  beginBatch(): void {
    this.batching = true;
  }

  commitBatch(): void {
    // Single copy-on-write boundary for the whole gesture: fresh map and order references so a
    // reference-equality selector sees one change, not one per pointer-move.
    this.bonesMap = new Map(this.bonesMap);
    this.boneOrderArr = this.boneOrderArr.slice();
    this.slotsMap = new Map(this.slotsMap);
    this.slotOrderArr = this.slotOrderArr.slice();
    this.attachmentsMap = cloneAttachments(this.attachmentsMap);
    this.animationsMap = cloneAnimations(this.animationsMap);
    this.ikConstraintsMap = new Map(this.ikConstraintsMap);
    this.ikConstraintOrderArr = this.ikConstraintOrderArr.slice();
    this.transformConstraintsMap = new Map(this.transformConstraintsMap);
    this.transformConstraintOrderArr = this.transformConstraintOrderArr.slice();
    this.skinsMap = cloneSkins(this.skinsMap);
    this.skinOrderArr = this.skinOrderArr.slice();
    this.eventsMap = new Map(this.eventsMap);
    this.eventOrderArr = this.eventOrderArr.slice();
    this.batching = false;
  }

  // Exit batch mode WITHOUT a copy-on-write boundary. History.cancelInteraction calls this AFTER it has
  // undone every in-session command in reverse (each undo ran in-place, so the live maps already hold the
  // pre-interaction values). A fresh boundary is unnecessary because the net document state is unchanged;
  // revision still bumped per undo, so revision-based viewport selectors redraw back to the pre-drag pose.
  cancelBatch(): void {
    this.batching = false;
  }
}

// A read-only facade over the internal model, handed to UI and the MCP server as Document.model. The
// internal instance has PUBLIC write methods (insertBone/insertSlot/...), so returning it directly,
// even typed as DocumentReadModel, would let a holder reach the write surface through an `as` cast and
// bypass LAW 2. This facade exposes ONLY the read methods (a fresh delegating object, no write
// methods at runtime), so the write capability is reachable solely through History via the Mutator.
export function createReadModel(model: DocumentModelInternal): DocumentReadModel {
  return {
    get revision(): number {
      return model.revision;
    },
    get name(): string {
      return model.name;
    },
    getBone: (id) => model.getBone(id),
    bones: () => model.bones(),
    findBoneByName: (name) => model.findBoneByName(name),
    getSlot: (id) => model.getSlot(id),
    slots: () => model.slots(),
    attachments: (slotId) => model.attachments(slotId),
    getAttachment: (slotId, name) => model.getAttachment(slotId, name),
    getAnimation: (id) => model.getAnimation(id),
    animations: () => model.animations(),
    getIkConstraint: (id) => model.getIkConstraint(id),
    ikConstraints: () => model.ikConstraints(),
    getTransformConstraint: (id) => model.getTransformConstraint(id),
    transformConstraints: () => model.transformConstraints(),
    getPathConstraint: (id) => model.getPathConstraint(id),
    pathConstraints: () => model.pathConstraints(),
    getSkin: (id) => model.getSkin(id),
    skins: () => model.skins(),
    getEventDef: (id) => model.getEventDef(id),
    eventDefs: () => model.eventDefs(),
    findEventDefByName: (name) => model.findEventDefByName(name),
    metadata: () => model.metadata(),
    slotScene: () => model.slotScene(),
    slotGrid: () => model.slotGrid(),
    slotTumble: () => model.slotTumble(),
    getSymbolAnimSet: (symbolId) => model.getSymbolAnimSet(symbolId),
    preserved: () => model.preserved(),
    snapshot: () => model.snapshot(),
  };
}
