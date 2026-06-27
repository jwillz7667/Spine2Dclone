import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Move a bone's local translation (command-history Section 4.2, the reference coalescing command).
// One logical channel only (x, y); rotation and scale are separate primitives so the cross-channel
// coalescing guard is correct. Memento-based: `before` is captured on first do (a deep value copy) and
// `after` is the absolute target, so undo is bit-exact and coalesced drags never accumulate drift.
export class MoveBoneCommand implements Command {
  readonly kind = 'bone.move';
  readonly label = 'Move Bone';
  private before: { readonly x: number; readonly y: number } | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: { readonly x: number; readonly y: number },
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = { x: bone.x, y: bone.y };
    }
    ctx.mutate.patchBone(this.target, { x: this.after.x, y: this.after.y });
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { x: this.before.x, y: this.before.y });
  }

  // Same kind + same target only. The merged command keeps the ORIGINAL before (pre-gesture) and the
  // latest after, so one undo returns to the start of the gesture (command-history Section 5.3).
  coalesceWith(prev: Command): Command | null {
    if (prev instanceof MoveBoneCommand && prev.target === this.target) {
      const merged = new MoveBoneCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const moveBoneSpec: CommandSpec = {
  kind: 'bone.move',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return { command: new MoveBoneCommand(target.id, { x: target.x + 33, y: target.y - 17 }) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.move fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.move target missing from snapshot');
    if (a.x === b.x && a.y === b.y) throw new Error('bone.move produced no translation delta');
    if (a.rotation !== b.rotation || a.length !== b.length) {
      throw new Error('bone.move changed a field outside its channel');
    }
  },
};
