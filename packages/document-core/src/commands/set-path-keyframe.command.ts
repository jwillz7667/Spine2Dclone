import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandTargetMissingError } from '../command/errors';
import { makePathKeyframe, type PathKeyframeEntity } from '../model/doc-state';
import type { AnimationId, PathConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The animatable path-constraint channels a keyframe carries; each is a number or undefined (an absent
// channel keeps its base value, ADR-0011 section 3).
export interface PathKeyframeChannels {
  readonly position: number | undefined;
  readonly spacing: number | undefined;
  readonly mixRotate: number | undefined;
  readonly mixX: number | undefined;
  readonly mixY: number | undefined;
}

// Insert-or-update a path keyframe (command-history catalog SetPathKeyframe, `path.setKeyframe`; PP-D11),
// the mirror of SetIkKeyframe. If a frame already exists at `time` its channels are updated (its KeyframeId,
// time, and curve are kept); otherwise a new frame is minted and inserted, keeping the channel strictly
// time-sorted. On insert the new frame takes `insertCurve` (default 'linear'). before/after are whole-channel
// mementos, so undo is bit-exact. Does NOT coalesce (a keyframe edit is discrete, not a continuous scrub).
export class SetPathKeyframeCommand implements Command {
  readonly kind = 'path.setKeyframe';
  readonly label = 'Set Path Keyframe';
  private before: readonly PathKeyframeEntity[] | undefined;
  private after: readonly PathKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PathConstraintId,
    private readonly time: number,
    private readonly channels: PathKeyframeChannels,
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.path.get(this.constraintId) ?? [];
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        const updated = makePathKeyframe(existing.id, existing.time, this.channels, existing.curve);
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const inserted = makePathKeyframe(
          ctx.ids.mint('keyframe'),
          this.time,
          this.channels,
          this.insertCurve,
        );
        this.after = [...channel, inserted].sort((a, b) => a.time - b.time);
      }
    }
    ctx.mutate.setPathChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandTargetMissingError(this.kind, this.animId);
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

export const setPathKeyframeSpec: CommandSpec = {
  kind: 'path.setKeyframe',
  // 'pathed' has an animation ('glide') whose path timeline already carries two keys, so an insert at their
  // midpoint is a free time with a real delta.
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'glide') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.path][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const time = (frames[0]!.time + frames[1]!.time) / 2;
    return {
      command: new SetPathKeyframeCommand(animation.id, constraintId, time, {
        position: 0.5,
        spacing: undefined,
        mixRotate: 0.5,
        mixX: undefined,
        mixY: undefined,
      }),
    };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'glide') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('path.setKeyframe fixture seed had no animations');
    const track = animBefore.path[0];
    if (track === undefined) throw new Error('path.setKeyframe fixture seed had no path track');
    const beforeCount = countPathFrames(
      findAnimationSnapshot(before, animBefore.id),
      track.constraintId,
    );
    const afterCount = countPathFrames(
      findAnimationSnapshot(after, animBefore.id),
      track.constraintId,
    );
    if (afterCount !== beforeCount + 1) {
      throw new Error('path.setKeyframe did not insert exactly one path keyframe');
    }
  },
};
