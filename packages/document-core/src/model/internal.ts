import type { BoneEntity, DocState, PreservedContent } from './doc-state';
import type { BoneId, IdFactory } from './ids';
import { boneToSnapshot, type DocSnapshot, type DocumentReadModel } from './read-model';

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

function toMutable(bone: BoneEntity): MutableBone {
  return { ...bone };
}

function freezeBone(bone: MutableBone): BoneEntity {
  return Object.freeze({ ...bone });
}

// Recursively freeze the preserved (non-bone) body so it cannot be mutated through a read accessor or
// a snapshot. It is held verbatim and round-tripped unchanged in Phase 0.
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
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
  private order: BoneId[];
  private preservedContent: PreservedContent;
  private batching = false;
  private revisionValue = 0;

  constructor(state: DocState, ids: IdFactory) {
    this.ids = ids;
    this.formatVersionValue = state.formatVersion;
    this.nameValue = state.name;
    this.bonesMap = new Map();
    for (const [id, bone] of state.bones) this.bonesMap.set(id, toMutable(bone));
    this.order = state.boneOrder.slice();
    this.preservedContent = deepFreeze({
      slots: state.preserved.slots,
      skins: state.preserved.skins,
      animations: state.preserved.animations,
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
    for (const id of this.order) {
      const bone = this.bonesMap.get(id);
      if (bone) out.push(freezeBone(bone));
    }
    return out;
  }

  findBoneByName(name: string): BoneEntity | undefined {
    for (const id of this.order) {
      const bone = this.bonesMap.get(id);
      if (bone && bone.name === name) return freezeBone(bone);
    }
    return undefined;
  }

  preserved(): PreservedContent {
    return this.preservedContent;
  }

  snapshot(): DocSnapshot {
    const bones = [...this.bonesMap.values()]
      .map((bone) => boneToSnapshot(freezeBone(bone)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      formatVersion: this.formatVersionValue,
      name: this.nameValue,
      bones,
      boneOrder: this.order.slice(),
      preserved: this.preservedContent,
    };
  }

  // ----- write surface (reached only through the Mutator, model/mutator.ts) -----

  insertBone(entity: BoneEntity, index: number): void {
    const bone = toMutable(entity);
    if (this.batching) {
      this.bonesMap.set(bone.id, bone);
      this.order.splice(index, 0, bone.id);
    } else {
      const next = new Map(this.bonesMap);
      next.set(bone.id, bone);
      this.bonesMap = next;
      const order = this.order.slice();
      order.splice(index, 0, bone.id);
      this.order = order;
    }
    this.revisionValue += 1;
  }

  removeBone(id: BoneId): void {
    if (this.batching) {
      this.bonesMap.delete(id);
      const i = this.order.indexOf(id);
      if (i >= 0) this.order.splice(i, 1);
    } else {
      const next = new Map(this.bonesMap);
      next.delete(id);
      this.bonesMap = next;
      this.order = this.order.filter((x) => x !== id);
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
      this.order.length = 0;
      for (const id of order) this.order.push(id);
    } else {
      this.order = order.slice();
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
    this.order = this.order.slice();
    this.batching = false;
  }
}
