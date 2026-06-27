import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Scale a bone's local scale (command-history catalog ScaleBone). One channel (scaleX, scaleY);
// coalesces same-target scales within a gizmo session. Memento-based, absolute before/after.
export class ScaleBoneCommand implements Command {
  readonly kind = 'bone.scale';
  readonly label = 'Scale Bone';
  private before: { readonly scaleX: number; readonly scaleY: number } | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: { readonly scaleX: number; readonly scaleY: number },
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = { scaleX: bone.scaleX, scaleY: bone.scaleY };
    }
    ctx.mutate.patchBone(this.target, { scaleX: this.after.scaleX, scaleY: this.after.scaleY });
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { scaleX: this.before.scaleX, scaleY: this.before.scaleY });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof ScaleBoneCommand && prev.target === this.target) {
      const merged = new ScaleBoneCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const scaleBoneSpec: CommandSpec = {
  kind: 'bone.scale',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return {
      command: new ScaleBoneCommand(target.id, {
        scaleX: target.scaleX * 2 + 0.5,
        scaleY: target.scaleY * 2 + 0.5,
      }),
    };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.scale fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.scale target missing from snapshot');
    if (a.scaleX === b.scaleX && a.scaleY === b.scaleY) {
      throw new Error('bone.scale produced no scale delta');
    }
    if (a.x !== b.x || a.rotation !== b.rotation) {
      throw new Error('bone.scale changed a field outside its channel');
    }
  },
};
