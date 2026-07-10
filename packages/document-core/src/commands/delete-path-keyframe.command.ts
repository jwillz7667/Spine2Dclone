import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PathKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, PathConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete one path keyframe by id (command-history catalog DeletePathKeyframe, `path.deleteKeyframe`; PP-D11),
// the mirror of DeleteIkKeyframe. before/after are whole-channel mementos, so undo is bit-exact and the
// surviving frames keep their ids and order. Does NOT coalesce. When the channel empties the mutator prunes
// the track (setPathChannel with an empty array).
export class DeletePathKeyframeCommand implements Command {
  readonly kind = 'path.deleteKeyframe';
  readonly label = 'Delete Path Keyframe';
  private before: readonly PathKeyframeEntity[] | undefined;
  private after: readonly PathKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PathConstraintId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.path.get(this.constraintId) ?? [];
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    ctx.mutate.setPathChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathChannel(this.animId, this.constraintId, this.before);
  }
}

function countPathFrames(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.path.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.length : 0;
}

export const deletePathKeyframeSpec: CommandSpec = {
  kind: 'path.deleteKeyframe',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'glide') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.path][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    const first = frames[0];
    if (first === undefined) return null;
    return { command: new DeletePathKeyframeCommand(animation.id, constraintId, first.id) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'glide') ?? before.animations[0];
    if (animBefore === undefined) throw new Error('path.deleteKeyframe fixture seed had no animations');
    const track = animBefore.path[0];
    if (track === undefined) throw new Error('path.deleteKeyframe fixture seed had no path track');
    const beforeCount = countPathFrames(findAnimationSnapshot(before, animBefore.id), track.constraintId);
    const afterCount = countPathFrames(findAnimationSnapshot(after, animBefore.id), track.constraintId);
    if (afterCount !== beforeCount - 1) {
      throw new Error('path.deleteKeyframe did not remove exactly one path keyframe');
    }
  },
};
