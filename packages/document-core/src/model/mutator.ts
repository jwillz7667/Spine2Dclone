import type { AttachmentEntity, BoneEntity, RegionAttachmentEntity, SlotEntity } from './doc-state';
import type { BoneId, SlotId } from './ids';
import type { DocumentModelInternal } from './internal';
import type { DocumentReadModel } from './read-model';

// The unforgeable witness for the privileged write surface (command-history Section 3.3). It is a
// real runtime symbol (so createMutator can stamp it) whose TYPE is a `unique symbol` (so the brand
// cannot be satisfied without it). Neither the symbol nor the Mutator type nor createMutator is
// re-exported through the package barrel, so UI code can obtain a Mutator only by being handed one,
// and `someObject as Mutator` cannot fabricate the brand. This is the structural half of LAW 2.
const MUTATOR_BRAND: unique symbol = Symbol('document-core.mutator');

export interface Mutator extends DocumentReadModel {
  readonly [MUTATOR_BRAND]: true;
  insertBone(entity: BoneEntity, index: number): void;
  removeBone(id: BoneId): void;
  patchBone(id: BoneId, patch: Partial<Omit<BoneEntity, 'id'>>): void;
  setBoneOrder(order: readonly BoneId[]): void;
  insertSlot(entity: SlotEntity, index: number): void;
  removeSlot(id: SlotId): void;
  patchSlot(id: SlotId, patch: Partial<Omit<SlotEntity, 'id' | 'attachment'>>): void;
  setActiveAttachment(id: SlotId, name: string | null): void;
  setSlotOrder(order: readonly SlotId[]): void;
  addAttachment(slotId: SlotId, entity: AttachmentEntity): void;
  removeAttachment(slotId: SlotId, name: string): void;
  patchAttachment(
    slotId: SlotId,
    name: string,
    patch: Partial<Omit<RegionAttachmentEntity, 'kind' | 'name'>>,
  ): void;
}

// The ONLY factory that can produce a Mutator. History receives the Mutator at construction; nothing
// else imports this. The returned object delegates reads and writes to the internal model and carries
// the brand. `revision` is a live getter so a command always sees the current value.
export function createMutator(model: DocumentModelInternal): Mutator {
  return {
    [MUTATOR_BRAND]: true,
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
    insertBone: (entity, index) => model.insertBone(entity, index),
    removeBone: (id) => model.removeBone(id),
    patchBone: (id, patch) => model.patchBone(id, patch),
    setBoneOrder: (order) => model.setBoneOrder(order),
    insertSlot: (entity, index) => model.insertSlot(entity, index),
    removeSlot: (id) => model.removeSlot(id),
    patchSlot: (id, patch) => model.patchSlot(id, patch),
    setActiveAttachment: (id, name) => model.setActiveAttachment(id, name),
    setSlotOrder: (order) => model.setSlotOrder(order),
    addAttachment: (slotId, entity) => model.addAttachment(slotId, entity),
    removeAttachment: (slotId, name) => model.removeAttachment(slotId, name),
    patchAttachment: (slotId, name, patch) => model.patchAttachment(slotId, name, patch),
  };
}
