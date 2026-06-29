import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandTargetMissingError } from '../command/errors';
import { makeIkKeyframe, type IkKeyframeEntity } from '../model/doc-state';
import type { AnimationId, IkConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Insert-or-update an IK keyframe (command-history catalog SetIkKeyframe, `ik.setKeyframe`; WP-2.6). If a
// frame already exists at `time` on the constraint's ik channel, its mix/bendPositive are updated (its
// KeyframeId, time, and curve are kept); otherwise a new frame is minted and inserted, keeping the channel
// strictly time-sorted. On insert the new frame takes `insertCurve` (default 'linear'). before/after are
// whole-channel mementos, so undo is bit-exact. Does NOT coalesce (per plan: IK keyframe edits are
// discrete, like an attachment swap, not a continuous scrub).
export class SetIkKeyframeCommand implements Command {
  readonly kind = 'ik.setKeyframe';
  readonly label = 'Set IK Keyframe';
  private before: readonly IkKeyframeEntity[] | undefined;
  private after: readonly IkKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: IkConstraintId,
    private readonly time: number,
    private readonly mix: number,
    private readonly bendPositive: boolean,
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.ik.get(this.constraintId) ?? [];
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        const updated = makeIkKeyframe(
          existing.id,
          existing.time,
          this.mix,
          this.bendPositive,
          existing.curve,
        );
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const inserted = makeIkKeyframe(
          ctx.ids.mint('keyframe'),
          this.time,
          this.mix,
          this.bendPositive,
          this.insertCurve,
        );
        this.after = [...channel, inserted].sort((a, b) => a.time - b.time);
      }
    }
    ctx.mutate.setIkChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandTargetMissingError(this.kind, this.animId);
    ctx.mutate.setIkChannel(this.animId, this.constraintId, this.before);
  }
}

function countIkFrames(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.ik.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.length : 0;
}

export const setIkKeyframeSpec: CommandSpec = {
  kind: 'ik.setKeyframe',
  // 'rigged' has an animation ('move') whose ik timeline already carries two keys, so an insert at the
  // midpoint of the first two is a free time, in range, with a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.ik][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const time = (frames[0]!.time + frames[1]!.time) / 2;
    return { command: new SetIkKeyframeCommand(animation.id, constraintId, time, 0.5, true) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined) throw new Error('ik.setKeyframe fixture seed had no animations');
    const track = animBefore.ik[0];
    if (track === undefined) throw new Error('ik.setKeyframe fixture seed had no ik track');
    const beforeCount = countIkFrames(
      findAnimationSnapshot(before, animBefore.id),
      track.constraintId,
    );
    const afterCount = countIkFrames(
      findAnimationSnapshot(after, animBefore.id),
      track.constraintId,
    );
    if (afterCount !== beforeCount + 1) {
      throw new Error('ik.setKeyframe did not insert exactly one IK keyframe');
    }
  },
};
