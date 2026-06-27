import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AttachmentEntity, BoneEntity, SlotEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { CommandSpec } from './spec';

interface RemovedBone {
  readonly entity: BoneEntity;
  readonly index: number; // original boneOrder index, for exact restore
}

interface RemovedSlot {
  readonly slot: SlotEntity;
  readonly index: number; // original slotOrder index, for exact restore
  readonly attachments: readonly AttachmentEntity[];
}

// Collect a bone plus all its descendants. boneOrder is parent-before-child, so a single forward pass
// closes over the subtree: a bone joins if its parent is already in the set.
function collectSubtree(ordered: readonly BoneEntity[], target: BoneId): Set<BoneId> {
  const subtree = new Set<BoneId>([target]);
  for (const bone of ordered) {
    if (bone.parent !== null && subtree.has(bone.parent)) subtree.add(bone.id);
  }
  return subtree;
}

// Delete a bone and its descendant BONES, cascading the slots riding any deleted bone and those slots'
// attachments (command-history catalog DeleteBone, decision D8: cascade, not reparent-to-grandparent;
// TASK-1.1.2). A SINGLE command with a SET memento (the removed bones with their boneOrder indices,
// plus the removed slots with their slotOrder indices and attachments), NOT a CompositeCommand, so the
// whole cascade is ONE undo step. The slot timelines targeting deleted bones/slots cascade later once
// WP-1.5 lands. Never coalesces. selectionHint selects the parent (or clears) on execute/redo and
// reselects the restored bone on undo.
export class DeleteBoneCommand implements Command {
  readonly kind = 'bone.delete';
  readonly label = 'Delete Bone';
  private removedBones: readonly RemovedBone[] | undefined;
  private removedSlots: readonly RemovedSlot[] | undefined;
  private parentId: BoneId | null = null;

  constructor(private readonly target: BoneId) {}

  do(ctx: CommandContext): void {
    if (!this.removedBones || !this.removedSlots) {
      const ordered = ctx.mutate.bones(); // in boneOrder
      const targetBone = ordered.find((bone) => bone.id === this.target);
      if (!targetBone) throw new CommandTargetMissingError(this.kind, this.target);
      this.parentId = targetBone.parent;
      const subtree = collectSubtree(ordered, this.target);
      const removedBones: RemovedBone[] = [];
      ordered.forEach((bone, index) => {
        if (subtree.has(bone.id)) removedBones.push({ entity: bone, index });
      });
      // Slots riding any deleted bone cascade with it, capturing their draw-order index and attachments
      // (in slotOrder order, so re-inserting ascending reconstructs the exact prior draw order).
      const removedSlots: RemovedSlot[] = [];
      ctx.mutate.slots().forEach((slot, index) => {
        if (subtree.has(slot.bone)) {
          removedSlots.push({ slot, index, attachments: ctx.mutate.attachments(slot.id) });
        }
      });
      this.removedBones = removedBones;
      this.removedSlots = removedSlots;
    }
    // Remove slots (and their attachments) first, then bones children-first (reverse capture order) so
    // each removal is independent of the others.
    for (const item of this.removedSlots) {
      for (const att of item.attachments) ctx.mutate.removeAttachment(item.slot.id, att.name);
      ctx.mutate.removeSlot(item.slot.id);
    }
    for (let i = this.removedBones.length - 1; i >= 0; i -= 1) {
      const item = this.removedBones[i];
      if (item) ctx.mutate.removeBone(item.entity.id);
    }
  }

  undo(ctx: CommandContext): void {
    if (!this.removedBones || !this.removedSlots) throw new CommandNotAppliedError(this.kind);
    // Re-insert bones in original boneOrder order (parents before children) at original indices, then
    // restore the slots and their attachments at their original draw-order indices.
    for (const item of this.removedBones) ctx.mutate.insertBone(item.entity, item.index);
    for (const item of this.removedSlots) {
      ctx.mutate.insertSlot(item.slot, item.index);
      for (const att of item.attachments) ctx.mutate.addAttachment(item.slot.id, att);
    }
  }

  selectionHint(phase: HistoryPhase): SelectionHint {
    if (phase === 'undo') {
      return { kind: 'select', entities: [{ type: 'bone', id: this.target }] };
    }
    return this.parentId !== null
      ? { kind: 'select', entities: [{ type: 'bone', id: this.parentId }] }
      : { kind: 'clear' };
  }
}

export const deleteBoneSpec: CommandSpec = {
  kind: 'bone.delete',
  // 'rig' has a parent plus child, so deleting the root exercises the subtree cascade.
  representativeSeedId: 'rig',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return { command: new DeleteBoneCommand(target.id) };
  },
  assertApplied: (before, after) => {
    const targetId = before.boneOrder[0];
    if (targetId === undefined) throw new Error('bone.delete fixture seed had no bones');
    if (after.bones.some((bone) => bone.id === targetId)) {
      throw new Error('bone.delete did not remove the target bone');
    }
    if (after.bones.length >= before.bones.length) {
      throw new Error('bone.delete expected fewer bones');
    }
    if (after.boneOrder.length >= before.boneOrder.length) {
      throw new Error('bone.delete expected boneOrder to shrink');
    }
    // Every surviving bone must have existed before: delete removes, never adds or mutates ids.
    const beforeIds = new Set(before.bones.map((bone) => bone.id));
    for (const bone of after.bones) {
      if (!beforeIds.has(bone.id)) throw new Error('bone.delete produced an unexpected bone');
    }
  },
};
