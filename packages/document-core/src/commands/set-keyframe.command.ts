import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  TimelineError,
} from '../command/errors';
import { makeKeyframe, type KeyframeEntity, type KeyframeValue } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import {
  conflictingChannels,
  readChannel,
  sameTarget,
  sortByTime,
  writeChannel,
  type KeyframeTarget,
} from './keyframe-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The single insert-or-update keyframe command (command-history catalog SetKeyframe, `kf.set`). If a
// keyframe already exists at `time` on the channel, its VALUE is updated (its KeyframeId, time, and
// curve are kept); otherwise a new keyframe is minted and inserted, keeping the channel strictly time-
// sorted. On insert the new keyframe takes `insertCurve` (default 'linear'); SetCurve edits curves of
// existing keyframes. The stored value/curve are AS GIVEN (the auto-key delta logic is WP-1.8).
//
// Coalescing is keyed on the TOUCHED keyframe (animation + target + KeyframeId): two edits of the same
// keyframe during a scrub collapse to one undo step, while a fresh insert at a new time mints a new
// KeyframeId and is therefore its own step. before/after are whole-channel mementos (the channel array),
// so undo is bit-exact and a coalesced sequence keeps the ORIGINAL pre-interaction channel.
export class SetKeyframeCommand implements Command {
  readonly kind = 'kf.set';
  readonly label = 'Set Keyframe';
  private before: readonly KeyframeEntity[] | undefined;
  private after: readonly KeyframeEntity[] = [];
  private touchedId: KeyframeId | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly target: KeyframeTarget,
    private readonly time: number,
    private readonly value: KeyframeValue,
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      // Keying a slot's two-color `dark` tint requires the slot's setup darkColor (ADR-0009 section 4.3, the
      // format's ANIM_DARK_NO_SETUP), enforced BEFORE any mutation.
      if (this.target.kind === 'slot' && this.target.channel === 'dark') {
        const slot = ctx.mutate.getSlot(this.target.slotId);
        if (slot === undefined) throw new CommandTargetMissingError(this.kind, this.target.slotId);
        if (slot.darkColor === null) {
          throw new TimelineError('darkNoSetup', `slot "${this.target.slotId}" has no setup dark color`);
        }
      }
      // Stage F2 (ADR-0009 section 4.1) coexistence ban (the format's TIMELINE_COMPONENT_CONFLICT): a joint
      // transform channel and its split components must not both be keyed on one bone. Reject BEFORE any
      // mutation when a conflicting sibling channel already carries keyframes.
      for (const sibling of conflictingChannels(this.target)) {
        if (readChannel(animation, sibling).length > 0) {
          throw new TimelineError(
            'componentConflict',
            `cannot key channel "${this.target.channel}" while a conflicting channel already has keyframes`,
          );
        }
      }
      const channel = readChannel(animation, this.target);
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        this.touchedId = existing.id;
        const updated = makeKeyframe(existing.id, existing.time, this.value, existing.curve);
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const id = ctx.ids.mint('keyframe');
        this.touchedId = id;
        const inserted = makeKeyframe(id, this.time, this.value, this.insertCurve);
        this.after = sortByTime([...channel, inserted]);
      }
    }
    writeChannel(ctx.mutate, this.animId, this.target, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    writeChannel(ctx.mutate, this.animId, this.target, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetKeyframeCommand &&
      prev.animId === this.animId &&
      sameTarget(prev.target, this.target) &&
      prev.touchedId !== undefined &&
      prev.touchedId === this.touchedId
    ) {
      const merged = new SetKeyframeCommand(
        this.animId,
        this.target,
        this.time,
        this.value,
        this.insertCurve,
      );
      merged.before = prev.before;
      merged.after = this.after;
      merged.touchedId = this.touchedId;
      return merged;
    }
    return null;
  }
}

function countRotate(snapshot: ReturnType<typeof findAnimationSnapshot>): number {
  if (snapshot === undefined) return 0;
  return snapshot.bones.reduce((sum, bone) => sum + bone.rotate.length, 0);
}

export const setKeyframeSpec: CommandSpec = {
  kind: 'kf.set',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [boneId, set] of animation.bones) {
      if (set.rotate.length >= 2) {
        const t0 = set.rotate[0]!.time;
        const t1 = set.rotate[1]!.time;
        const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
        // Insert at the midpoint of the first two rotate keys: a free time, in range, a real delta.
        return {
          command: new SetKeyframeCommand(animation.id, target, (t0 + t1) / 2, { angle: 12 }),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('kf.set fixture seed had no animations');
    const beforeCount = countRotate(findAnimationSnapshot(before, target.id));
    const afterCount = countRotate(findAnimationSnapshot(after, target.id));
    if (afterCount !== beforeCount + 1) {
      throw new Error('kf.set did not insert exactly one rotate keyframe');
    }
  },
};
