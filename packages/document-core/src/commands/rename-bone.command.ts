import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Rename a bone (command-history catalog RenameBone). A single-field change with zero cascade because
// identity is the internal id, not the name (Section 2, D2). Transient name collisions are legal
// internally (D9); name uniqueness is enforced only at export. Never coalesces. Memento-based.
export class RenameBoneCommand implements Command {
  readonly kind = 'bone.rename';
  readonly label = 'Rename Bone';
  private before: string | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = bone.name;
    }
    ctx.mutate.patchBone(this.target, { name: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { name: this.before });
  }
}

export const renameBoneSpec: CommandSpec = {
  kind: 'bone.rename',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return { command: new RenameBoneCommand(target.id, `${target.name}_renamed`) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.rename fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.rename target missing from snapshot');
    if (a.name === b.name) throw new Error('bone.rename produced no name delta');
    if (a.x !== b.x || a.rotation !== b.rotation) {
      throw new Error('bone.rename changed a field outside the name');
    }
  },
};
