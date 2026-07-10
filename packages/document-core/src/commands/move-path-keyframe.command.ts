import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makePathKeyframe, type PathKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, PathConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a path keyframe to a new time (`path.moveKeyframe`; PP-D11), the mirror of MoveIkKeyframe. Targets the
// frame by KeyframeId, re-sorts the channel, preserves the frame's channels and curve, and REJECTS a move
// onto a time another frame already occupies with a typed KeyframeCollisionError thrown before any mutation.
// Session coalescing collapses a dopesheet drag to one undo step; before/after are whole-channel mementos.
export class MovePathKeyframeCommand implements Command {
  readonly kind = 'path.moveKeyframe';
  readonly label = 'Move Path Keyframe';
  private before: readonly PathKeyframeEntity[] | undefined;
  private after: readonly PathKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PathConstraintId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.path.get(this.constraintId) ?? [];
      const moving = channel.find((kf) => kf.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((kf) => kf.id !== this.keyframeId && kf.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makePathKeyframe(
        moving.id,
        this.newTime,
        {
          position: moving.position,
          spacing: moving.spacing,
          mixRotate: moving.mixRotate,
          mixX: moving.mixX,
          mixY: moving.mixY,
        },
        moving.curve,
      );
      this.after = channel
        .map((kf) => (kf.id === this.keyframeId ? moved : kf))
        .sort((a, b) => a.time - b.time);
    }
    ctx.mutate.setPathChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathChannel(this.animId, this.constraintId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MovePathKeyframeCommand &&
      prev.animId === this.animId &&
      prev.constraintId === this.constraintId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MovePathKeyframeCommand(
        this.animId,
        this.constraintId,
        this.keyframeId,
        this.newTime,
      );
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

function pathTimes(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number[] {
  if (snapshot === undefined) return [];
  const track = snapshot.path.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.map((kf) => kf.time) : [];
}

export const movePathKeyframeSpec: CommandSpec = {
  kind: 'path.moveKeyframe',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'glide') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.path][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const last = frames[frames.length - 1]!;
    const prev = frames[frames.length - 2]!;
    const newTime = (prev.time + last.time) / 2;
    return { command: new MovePathKeyframeCommand(animation.id, constraintId, last.id, newTime) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'glide') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('path.moveKeyframe fixture seed had no animations');
    const track = animBefore.path[0];
    if (track === undefined) throw new Error('path.moveKeyframe fixture seed had no path track');
    const b = pathTimes(findAnimationSnapshot(before, animBefore.id), track.constraintId);
    const a = pathTimes(findAnimationSnapshot(after, animBefore.id), track.constraintId);
    if (a.length !== b.length) throw new Error('path.moveKeyframe changed the keyframe count');
    if (a.join(',') === b.join(',')) throw new Error('path.moveKeyframe produced no time delta');
    for (let i = 1; i < a.length; i += 1) {
      if (a[i]! <= a[i - 1]!)
        throw new Error('path.moveKeyframe left the channel out of time order');
    }
  },
};
