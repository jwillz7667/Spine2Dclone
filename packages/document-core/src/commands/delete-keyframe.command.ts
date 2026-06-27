import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { KeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { readChannel, writeChannel, type KeyframeTarget } from './keyframe-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete a keyframe by KeyframeId (command-history catalog DeleteKeyframe, `kf.delete`). The before-memento
// is the whole channel array (which carries the removed keyframe's value, time, curve, and position), so
// undo restores it exactly, position included. When the last keyframe of a channel is removed the mutator
// prunes the now-empty timeline set. Never coalesces.
export class DeleteKeyframeCommand implements Command {
  readonly kind = 'kf.delete';
  readonly label = 'Delete Keyframe';
  private before: readonly KeyframeEntity[] | undefined;
  private after: readonly KeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly target: KeyframeTarget,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = readChannel(animation, this.target);
      if (!channel.some((kf) => kf.id === this.keyframeId)) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    writeChannel(ctx.mutate, this.animId, this.target, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    writeChannel(ctx.mutate, this.animId, this.target, this.before);
  }
}

function countRotate(snapshot: ReturnType<typeof findAnimationSnapshot>): number {
  if (snapshot === undefined) return 0;
  return snapshot.bones.reduce((sum, bone) => sum + bone.rotate.length, 0);
}

export const deleteKeyframeSpec: CommandSpec = {
  kind: 'kf.delete',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [boneId, set] of animation.bones) {
      if (set.rotate.length >= 1) {
        const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
        return { command: new DeleteKeyframeCommand(animation.id, target, set.rotate[0]!.id) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('kf.delete fixture seed had no animations');
    const beforeCount = countRotate(findAnimationSnapshot(before, target.id));
    const afterCount = countRotate(findAnimationSnapshot(after, target.id));
    if (afterCount !== beforeCount - 1) {
      throw new Error('kf.delete did not remove exactly one rotate keyframe');
    }
  },
};
