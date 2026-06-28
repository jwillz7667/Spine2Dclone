import type {
  Attachment,
  BlendMode,
  CurveType,
  RGBA,
  TransformMode,
} from '@marionette/format/types';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneEntity,
  KeyframeEntity,
  KeyframeValue,
  PreservedContent,
  SlotEntity,
} from './doc-state';
import { cloneCurve, cloneKeyframeValue } from './doc-state';
import type { AnimationId, BoneId, SlotId } from './ids';

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
  // The preserved (not-yet-promoted) document body, read-only. Phase 1 holds the atlas and non-default
  // skins verbatim.
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

// A plain per-bone timeline projection, keyed by the internal BoneId string (a reference, stable across
// a bone rename), with each channel in time order.
export interface BoneTimelineSnapshot {
  readonly boneId: string;
  readonly rotate: readonly KeyframeSnapshot[];
  readonly translate: readonly KeyframeSnapshot[];
  readonly scale: readonly KeyframeSnapshot[];
  readonly shear: readonly KeyframeSnapshot[];
}

// A plain per-slot timeline projection, keyed by the internal SlotId string.
export interface SlotTimelineSnapshot {
  readonly slotId: string;
  readonly color: readonly KeyframeSnapshot[];
  readonly attachment: readonly AttachmentFrameSnapshot[];
}

// A plain animation projection. `bones`/`slots` are sorted by their internal id so the snapshot is
// deterministic and stable across renames.
export interface AnimationSnapshot {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly bones: readonly BoneTimelineSnapshot[]; // sorted by boneId
  readonly slots: readonly SlotTimelineSnapshot[]; // sorted by slotId
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

// Project an animation entity to its snapshot shape: bones and slots sorted by their internal id, each
// channel a value copy in time order. Keyframe arrays are already time-sorted in the model.
export function animationToSnapshot(animation: AnimationEntity): AnimationSnapshot {
  const bones: BoneTimelineSnapshot[] = [];
  for (const [boneId, set] of animation.bones) {
    bones.push({
      boneId,
      rotate: set.rotate.map(keyframeToSnapshot),
      translate: set.translate.map(keyframeToSnapshot),
      scale: set.scale.map(keyframeToSnapshot),
      shear: set.shear.map(keyframeToSnapshot),
    });
  }
  bones.sort((a, b) => (a.boneId < b.boneId ? -1 : a.boneId > b.boneId ? 1 : 0));
  const slots: SlotTimelineSnapshot[] = [];
  for (const [slotId, set] of animation.slots) {
    slots.push({
      slotId,
      color: set.color.map(keyframeToSnapshot),
      attachment: set.attachment.map(attachmentFrameToSnapshot),
    });
  }
  slots.sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  return { id: animation.id, name: animation.name, duration: animation.duration, bones, slots };
}
