import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Set a bone's length (command-history catalog SetBoneLength). Affects the bone tip render only, no
// child cascade. One channel (length); coalesces same-target length drags within a handle session.
export class SetBoneLengthCommand implements Command {
  readonly kind = 'bone.length';
  readonly label = 'Set Bone Length';
  private before: number | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = bone.length;
    }
    ctx.mutate.patchBone(this.target, { length: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { length: this.before });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetBoneLengthCommand && prev.target === this.target) {
      const merged = new SetBoneLengthCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setBoneLengthSpec: CommandSpec = {
  kind: 'bone.length',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return { command: new SetBoneLengthCommand(target.id, target.length + 25) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.length fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.length target missing from snapshot');
    if (a.length === b.length) throw new Error('bone.length produced no length delta');
    if (a.x !== b.x || a.rotation !== b.rotation) {
      throw new Error('bone.length changed a field outside its channel');
    }
  },
};
