import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import type {
  Animation,
  Attachment,
  AtlasRef,
  BlendMode,
  RGBA,
  Skin,
  TransformMode,
} from '@marionette/format/types';
import type { BoneId, SlotId } from './ids';

// Internal bone entity (command-history Section 3.1): carries an internal `id` and otherwise mirrors
// the format bone fields BY VALUE. `parent` is an Id reference, not a name, so a rename never cascades.
export interface BoneEntity {
  readonly id: BoneId;
  readonly name: string;
  readonly parent: BoneId | null;
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

// Internal slot entity (command-history Section 3.1): an internal `id` plus the format slot fields BY
// VALUE. CRITICAL: `bone` is a BoneId reference (like BoneEntity.parent), NOT a name, so renaming or
// reordering a bone never breaks a slot. `attachment` is the setup-pose active attachment NAME (a key
// into this slot's attachment map) or null. `darkColor` is null when the slot has a single-color tint
// (the format field is then absent), which is NOT equivalent to black.
export interface SlotEntity {
  readonly id: SlotId;
  readonly name: string;
  readonly bone: BoneId;
  readonly color: RGBA;
  readonly darkColor: RGBA | null;
  readonly attachment: string | null;
  readonly blendMode: BlendMode;
}

// A region attachment in the default skin, mirroring the format RegionAttachment BY VALUE plus its own
// `name` (the attachment map key; the format stores the name as the key, not as a field) and a `kind`
// discriminant. Phase 1 (WP-1.2) authors ONLY region attachments; addressing is by (owning SlotId,
// attachment name), since the command catalog mints no AttachmentId.
export interface RegionAttachmentEntity {
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

// A non-region attachment (mesh/clipping/point/boundingbox) held VERBATIM so a loaded document round-
// trips losslessly: Phase 1 has no command that creates or edits one. It lives in the same per-slot
// attachment map as region attachments (keyed by SlotId then name), so a slot rename keeps the linkage
// and the delete cascade restores it uniformly. `value` is the exact format Attachment.
export interface PreservedAttachmentEntity {
  readonly kind: 'preserved';
  readonly name: string;
  readonly value: Attachment;
}

// The default skin's attachments are the only ones Phase 1 promotes to editable. The discriminated
// union keeps the editable region path (RegionAttachmentEntity) clean while still carrying non-region
// attachments losslessly (PreservedAttachmentEntity). RemoveAttachment and the delete cascade operate
// on either kind uniformly; only the region-authoring commands construct or patch the region variant.
export type AttachmentEntity = RegionAttachmentEntity | PreservedAttachmentEntity;

// Phase-1 preserved content: the document body not yet promoted to editable id-keyed entities.
// `animations` promote in WP-1.5; the `atlas` stays preserved until its command lands. `extraSkins`
// are skins OTHER than 'default' (Phase 1 authors only the default skin, which is materialized from
// `slots` + `attachments`, never stored here); they round-trip verbatim. Slots and the default skin's
// attachments left PreservedContent in WP-1.2 and are now first-class (DocState.slots / .attachments).
export interface PreservedContent {
  readonly animations: Readonly<Record<string, Animation>>;
  readonly atlas: AtlasRef;
  readonly extraSkins: readonly Skin[];
}

// The full internal document state. Bones and slots are the editable, id-keyed collections; `boneOrder`
// keeps parents before children (the format invariant) and `slotOrder` is the setup-pose draw order
// (the format `slots[]` order). `attachments` is the default skin's attachments keyed by owning SlotId
// then attachment name. DocState is immutable to the outside world: its only mutation surface is the
// Mutator, reachable only from inside a command.
export interface DocState {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: ReadonlyMap<BoneId, BoneEntity>;
  readonly boneOrder: readonly BoneId[];
  readonly slots: ReadonlyMap<SlotId, SlotEntity>;
  readonly slotOrder: readonly SlotId[];
  readonly attachments: ReadonlyMap<SlotId, ReadonlyMap<string, AttachmentEntity>>;
  readonly preserved: PreservedContent;
}

// A new, empty document body: one default skin (the format requires it on export) and no extra skins,
// animations, or atlas pages. The default skin is materialized from the (empty) slots/attachments on
// export, so it is not stored here.
export function emptyPreservedContent(): PreservedContent {
  return {
    animations: {},
    atlas: { pages: [] },
    extraSkins: [],
  };
}

// A fresh, empty document state at the current format version: no bones yet (the first CreateBone adds
// the root), no slots or attachments, a materialized default skin on export. Export stays invalid until
// a bone exists (the format requires bones.length >= 1), which the Phase 0 flow satisfies before saving.
export function newDocState(name: string): DocState {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name,
    bones: new Map(),
    boneOrder: [],
    slots: new Map(),
    slotOrder: [],
    attachments: new Map(),
    preserved: emptyPreservedContent(),
  };
}
