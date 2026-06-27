import type { Attachment, BlendMode, RGBA, TransformMode } from '@marionette/format/types';
import type { AttachmentEntity, BoneEntity, PreservedContent, SlotEntity } from './doc-state';
import type { BoneId, SlotId } from './ids';

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
  // The preserved (not-yet-promoted) document body, read-only. Phase 1 holds animations, the atlas,
  // and non-default skins verbatim.
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

// A plain attachment projection for snapshots, keyed by its owning slot. The region variant carries
// its editable fields; the preserved variant carries the verbatim format value, so both round-trip.
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
      readonly kind: 'preserved';
      readonly name: string;
      readonly value: Attachment;
    };

// The full internal-state projection the round-trip harness deep-compares (command-history Section
// 3.4). Maps serialize as arrays sorted by id; order-significant arrays (boneOrder, slotOrder) preserve
// order; attachments sort by (slotId, name); numbers are verbatim (undo restores stored mementos, so
// the round-trip is bit-exact, no epsilon).
export interface DocSnapshot {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: readonly BoneSnapshot[]; // sorted by id
  readonly boneOrder: readonly string[]; // order-significant
  readonly slots: readonly SlotSnapshot[]; // sorted by id
  readonly slotOrder: readonly string[]; // order-significant (draw order)
  readonly attachments: readonly AttachmentSnapshot[]; // sorted by (slotId, name)
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
  return { slotId, kind: 'preserved', name: att.name, value: att.value };
}
