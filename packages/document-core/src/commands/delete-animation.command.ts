import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AnimationEntity } from '../model/doc-state';
import type { AnimationId } from '../model/ids';
import type { CommandSpec } from './spec';

// Delete an animation (command-history catalog DeleteAnimation, `anim.delete`). A SINGLE command whose
// memento is the WHOLE animation entity (id, name, duration, and every timeline), so undo restores it
// exactly, including all keyframe ids. Never coalesces.
export class DeleteAnimationCommand implements Command {
  readonly kind = 'anim.delete';
  readonly label = 'Delete Animation';
  private removed: AnimationEntity | undefined;

  constructor(private readonly animId: AnimationId) {}

  do(ctx: CommandContext): void {
    if (!this.removed) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      this.removed = animation;
    }
    ctx.mutate.removeAnimation(this.animId);
  }

  undo(ctx: CommandContext): void {
    if (!this.removed) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertAnimation(this.removed);
  }
}

export const deleteAnimationSpec: CommandSpec = {
  kind: 'anim.delete',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    return { command: new DeleteAnimationCommand(animation.id) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('anim.delete fixture seed had no animations');
    if (after.animations.some((animation) => animation.id === target.id)) {
      throw new Error('anim.delete did not remove the target animation');
    }
    if (after.animations.length !== before.animations.length - 1) {
      throw new Error('anim.delete expected one fewer animation');
    }
  },
};
