import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makeTransformKeyframe, type TransformKeyframeEntity } from '../model/doc-state';
import type { AnimationId, TransformConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The six per-channel mix factors a transform keyframe carries (each a number or undefined; an absent
// channel keeps its base value at solve time, ADR-0003).
export interface TransformKeyframeMix {
  readonly mixRotate: number | undefined;
  readonly mixX: number | undefined;
  readonly mixY: number | undefined;
  readonly mixScaleX: number | undefined;
  readonly mixScaleY: number | undefined;
  readonly mixShearY: number | undefined;
}

// Sort a transform channel strictly by time (keeps the channel ascending after an insert).
function sortByTime(
  frames: readonly TransformKeyframeEntity[],
): readonly TransformKeyframeEntity[] {
  return [...frames].sort((a, b) => a.time - b.time);
}

// Insert-or-update a transform-constraint keyframe (command-history catalog SetTransformKeyframe,
// `transform.setKeyframe`; WP-2.7). If a keyframe already exists at `time` on the constraint's channel its
// MIX is updated (its KeyframeId, time, and curve are kept); otherwise a new keyframe is minted with
// `insertCurve` and inserted, keeping the channel time-sorted. before/after are whole-channel mementos, so
// undo is bit-exact. NOT coalescing (a discrete keyframe edit, not a drag).
export class SetTransformKeyframeCommand implements Command {
  readonly kind = 'transform.setKeyframe';
  readonly label = 'Set Transform Keyframe';
  private before: readonly TransformKeyframeEntity[] | undefined;
  private after: readonly TransformKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: TransformConstraintId,
    private readonly time: number,
    private readonly mix: TransformKeyframeMix,
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.transform.get(this.constraintId) ?? [];
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        const updated = makeTransformKeyframe(existing.id, existing.time, this.mix, existing.curve);
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const id = ctx.ids.mint('keyframe');
        const inserted = makeTransformKeyframe(id, this.time, this.mix, this.insertCurve);
        this.after = sortByTime([...channel, inserted]);
      }
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

export const setTransformKeyframeSpec: CommandSpec = {
  kind: 'transform.setKeyframe',
  // 'rigged' carries the 'move' animation with a transform timeline on 'follow' (keys at t=0 and t=1).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [constraintId, frames] of animation.transform) {
      if (frames.length >= 2) {
        const t0 = frames[0]!.time;
        const t1 = frames[1]!.time;
        // Insert at the midpoint of the first two keys: a free time, in range, a real delta.
        return {
          command: new SetTransformKeyframeCommand(animation.id, constraintId, (t0 + t1) / 2, {
            mixRotate: 0.5,
            mixX: undefined,
            mixY: undefined,
            mixScaleX: undefined,
            mixScaleY: undefined,
            mixShearY: undefined,
          }),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const anim = before.animations[0];
    if (anim === undefined) throw new Error('transform.setKeyframe fixture seed had no animations');
    const constraintId = anim.transform[0]?.constraintId;
    if (constraintId === undefined) {
      throw new Error('transform.setKeyframe fixture seed had no transform track');
    }
    const beforeCount = countTransformKeys(findAnimationSnapshot(before, anim.id), constraintId);
    const afterCount = countTransformKeys(findAnimationSnapshot(after, anim.id), constraintId);
    if (afterCount !== beforeCount + 1) {
      throw new Error('transform.setKeyframe did not insert exactly one keyframe');
    }
  },
};
