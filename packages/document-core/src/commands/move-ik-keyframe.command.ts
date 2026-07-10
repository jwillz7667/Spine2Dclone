import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makeIkKeyframe, type IkKeyframeEntity } from '../model/doc-state';
import type { AnimationId, IkConstraintId, KeyframeId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move an IK keyframe to a new time (the deferred quality-wave follow-up to SetIkKeyframe;
// `ik.moveKeyframe`, PP-D10). Targets the frame by KeyframeId, re-sorts the channel, preserves the frame's
// mix/bendPositive/curve and any carried F2 depth channels (ADR-0009), and REJECTS a move onto a time
// another frame already occupies with a typed KeyframeCollisionError thrown before any mutation (the IK
// channel keys by time, so two frames never share one). Session coalescing collapses a dopesheet drag to one
// undo step; before/after are whole-channel mementos, so undo is bit-exact.
export class MoveIkKeyframeCommand implements Command {
  readonly kind = 'ik.moveKeyframe';
  readonly label = 'Move IK Keyframe';
  private before: readonly IkKeyframeEntity[] | undefined;
  private after: readonly IkKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: IkConstraintId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.ik.get(this.constraintId) ?? [];
      const moving = channel.find((kf) => kf.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((kf) => kf.id !== this.keyframeId && kf.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      // Preserve every field of the moved frame; only `time` changes. The carried F2 depth channels
      // (softness/stretch/compress) are passed through so a move never drops them.
      const moved = makeIkKeyframe(
        moving.id,
        this.newTime,
        moving.mix,
        moving.bendPositive,
        moving.curve,
        {
          softness: moving.softness,
          stretch: moving.stretch,
          compress: moving.compress,
        },
      );
      this.after = channel
        .map((kf) => (kf.id === this.keyframeId ? moved : kf))
        .sort((a, b) => a.time - b.time);
    }
    ctx.mutate.setIkChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setIkChannel(this.animId, this.constraintId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveIkKeyframeCommand &&
      prev.animId === this.animId &&
      prev.constraintId === this.constraintId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveIkKeyframeCommand(
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

function ikTimes(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number[] {
  if (snapshot === undefined) return [];
  const track = snapshot.ik.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.map((kf) => kf.time) : [];
}

export const moveIkKeyframeSpec: CommandSpec = {
  kind: 'ik.moveKeyframe',
  // 'rigged' has an animation ('move') whose ik timeline carries two keys, so moving the last one to a free
  // time strictly between the two stays in range, collides with nothing, and shows only a time delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.ik][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const last = frames[frames.length - 1]!;
    const prev = frames[frames.length - 2]!;
    const newTime = (prev.time + last.time) / 2;
    return { command: new MoveIkKeyframeCommand(animation.id, constraintId, last.id, newTime) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined) throw new Error('ik.moveKeyframe fixture seed had no animations');
    const track = animBefore.ik[0];
    if (track === undefined) throw new Error('ik.moveKeyframe fixture seed had no ik track');
    const b = ikTimes(findAnimationSnapshot(before, animBefore.id), track.constraintId);
    const a = ikTimes(findAnimationSnapshot(after, animBefore.id), track.constraintId);
    if (a.length !== b.length) throw new Error('ik.moveKeyframe changed the keyframe count');
    if (a.join(',') === b.join(',')) throw new Error('ik.moveKeyframe produced no time delta');
    for (let i = 1; i < a.length; i += 1) {
      if (a[i]! <= a[i - 1]!) throw new Error('ik.moveKeyframe left the channel out of time order');
    }
  },
};
