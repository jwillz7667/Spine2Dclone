import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { TransformKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, TransformConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete one transform-constraint keyframe by id (command-history catalog DeleteTransformKeyframe,
// `transform.deleteKeyframe`; WP-2.7). before/after are whole-channel mementos (the channel with the named
// keyframe filtered out), so undo restores the channel bit-exactly. NOT coalescing.
export class DeleteTransformKeyframeCommand implements Command {
  readonly kind = 'transform.deleteKeyframe';
  readonly label = 'Delete Transform Keyframe';
  private before: readonly TransformKeyframeEntity[] | undefined;
  private after: readonly TransformKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: TransformConstraintId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.transform.get(this.constraintId) ?? [];
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    ctx.mutate.setTransformChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setTransformChannel(this.animId, this.constraintId, this.before);
  }
}

function countTransformKeys(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.transform.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.length : 0;
}

export const deleteTransformKeyframeSpec: CommandSpec = {
  kind: 'transform.deleteKeyframe',
  // 'rigged' carries the 'move' animation with a transform timeline on 'follow' (keys at t=0 and t=1), so
  // deleting its first key yields a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [constraintId, frames] of animation.transform) {
      const first = frames[0];
      if (first) {
        return {
          command: new DeleteTransformKeyframeCommand(animation.id, constraintId, first.id),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const anim = before.animations[0];
    if (anim === undefined) {
      throw new Error('transform.deleteKeyframe fixture seed had no animations');
    }
    const constraintId = anim.transform[0]?.constraintId;
    if (constraintId === undefined) {
      throw new Error('transform.deleteKeyframe fixture seed had no transform track');
    }
    const beforeCount = countTransformKeys(findAnimationSnapshot(before, anim.id), constraintId);
    const afterCount = countTransformKeys(findAnimationSnapshot(after, anim.id), constraintId);
    if (afterCount !== beforeCount - 1) {
      throw new Error('transform.deleteKeyframe did not remove exactly one keyframe');
    }
  },
};
