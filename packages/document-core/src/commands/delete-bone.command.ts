import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { CommandSpec } from './spec';

interface RemovedBone {
  readonly entity: BoneEntity;
  readonly index: number; // original boneOrder index, for exact restore
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

// Delete a bone and its descendant BONES (command-history catalog DeleteBone, decision D8: cascade,
// not reparent-to-grandparent). A SINGLE command with a SET memento (the removed entities plus their
// original boneOrder indices, captured in boneOrder order), NOT a CompositeCommand. Phase 0 has no
// slots/attachments/animations, so it touches none; the rider-aware variant is Phase 1. Never
// coalesces. selectionHint selects the parent (or clears) on execute/redo and reselects the restored
// bone on undo.
export class DeleteBoneCommand implements Command {
  readonly kind = 'bone.delete';
  readonly label = 'Delete Bone';
  private removed: readonly RemovedBone[] | undefined;
  private parentId: BoneId | null = null;

  constructor(private readonly target: BoneId) {}

  do(ctx: CommandContext): void {
    if (!this.removed) {
      const ordered = ctx.mutate.bones(); // in boneOrder
      const targetBone = ordered.find((bone) => bone.id === this.target);
      if (!targetBone) throw new CommandTargetMissingError(this.kind, this.target);
      this.parentId = targetBone.parent;
      const subtree = collectSubtree(ordered, this.target);
      const removed: RemovedBone[] = [];
      ordered.forEach((bone, index) => {
        if (subtree.has(bone.id)) removed.push({ entity: bone, index });
      });
      this.removed = removed;
    }
    // Remove children-first (reverse capture order) so each removal is independent of the others.
    for (let i = this.removed.length - 1; i >= 0; i -= 1) {
      const item = this.removed[i];
      if (item) ctx.mutate.removeBone(item.entity.id);
    }
  }

  undo(ctx: CommandContext): void {
    if (!this.removed) throw new CommandNotAppliedError(this.kind);
    // Re-insert in original boneOrder order (parents before children) at original indices: inserting
    // ascending reconstructs the exact prior order because each original index accounts for the
    // entities inserted before it.
    for (const item of this.removed) ctx.mutate.insertBone(item.entity, item.index);
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
    if (after.bones.length >= before.bones.length) {
      throw new Error('bone.delete expected fewer bones');
    }
    if (after.boneOrder.length >= before.boneOrder.length) {
      throw new Error('bone.delete expected boneOrder to shrink');
    }
  },
};
