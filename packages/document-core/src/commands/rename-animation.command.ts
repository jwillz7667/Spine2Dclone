import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AnimationId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Rename an animation (command-history catalog RenameAnimation, `anim.rename`). A single-field change
// with zero cascade because identity is the AnimationId, not the name. Name uniqueness is the format
// validator's concern at export, NOT a command guard (the on-disk record is name-keyed, but the model
// addresses by id, so a transient duplicate is legal internally). Never coalesces. Memento-based.
export class RenameAnimationCommand implements Command {
  readonly kind = 'anim.rename';
  readonly label = 'Rename Animation';
  private before: string | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly after: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      this.before = animation.name;
    }
    ctx.mutate.patchAnimation(this.animId, { name: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchAnimation(this.animId, { name: this.before });
  }
}

export const renameAnimationSpec: CommandSpec = {
  kind: 'anim.rename',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    return { command: new RenameAnimationCommand(animation.id, `${animation.name}_renamed`) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('anim.rename fixture seed had no animations');
    const a = findAnimationSnapshot(after, target.id);
    if (!a) throw new Error('anim.rename target missing from snapshot');
    if (a.name === target.name) throw new Error('anim.rename produced no name delta');
    if (a.duration !== target.duration)
      throw new Error('anim.rename changed a field outside the name');
  },
};
