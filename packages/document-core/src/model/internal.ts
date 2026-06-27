import type {
  AttachmentEntity,
  BoneEntity,
  DocState,
  PreservedContent,
  RegionAttachmentEntity,
  SlotEntity,
} from './doc-state';
import type { BoneId, IdFactory, SlotId } from './ids';
import {
  attachmentToSnapshot,
  boneToSnapshot,
  slotToSnapshot,
  type AttachmentSnapshot,
  type DocSnapshot,
  type DocumentReadModel,
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

// Freeze an attachment for hand-out. The region variant's color is deep-frozen; the preserved variant
// already wraps a deeply-frozen verbatim format value.
function freezeAttachment(att: AttachmentEntity): AttachmentEntity {
  if (att.kind === 'region') {
    return Object.freeze({ ...att, color: Object.freeze({ ...att.color }) });
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
    this.preservedContent = deepFreeze({
      animations: state.preserved.animations,
      atlas: state.preserved.atlas,
      extraSkins: state.preserved.extraSkins,
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
    return {
      formatVersion: this.formatVersionValue,
      name: this.nameValue,
      bones,
      boneOrder: this.boneOrderArr.slice(),
      slots,
      slotOrder: this.slotOrderArr.slice(),
      attachments,
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
    this.revisionValue += 1;
  }

  removeBone(id: BoneId): void {
    if (this.batching) {
      this.bonesMap.delete(id);
      const i = this.boneOrderArr.indexOf(id);
      if (i >= 0) this.boneOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.bonesMap);
      next.delete(id);
      this.bonesMap = next;
      this.boneOrderArr = this.boneOrderArr.filter((x) => x !== id);
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
    if (this.batching) {
      this.boneOrderArr.length = 0;
      for (const id of order) this.boneOrderArr.push(id);
    } else {
      this.boneOrderArr = order.slice();
    }
    this.revisionValue += 1;
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
    preserved: () => model.preserved(),
    snapshot: () => model.snapshot(),
  };
}
