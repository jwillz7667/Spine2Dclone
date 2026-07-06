import type { Command, CommandContext } from '../command/command';
import {
  AnimationDurationError,
  CommandNotAppliedError,
  CommandTargetMissingError,
} from '../command/errors';
import type { AnimationEntity } from '../model/doc-state';
import type { AnimationId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The largest keyframe/frame time across every timeline of an animation. The new duration may not drop
// below this, or keyframes would fall outside [0, duration] (the format's ANIM_TIME_RANGE / ANIM_DURATION).
function lastKeyframeTime(animation: AnimationEntity): number {
  let max = 0;
  for (const set of animation.bones.values()) {
    for (const channel of [set.rotate, set.translate, set.scale, set.shear]) {
      for (const kf of channel) if (kf.time > max) max = kf.time;
    }
  }
  for (const set of animation.slots.values()) {
    for (const kf of set.color) if (kf.time > max) max = kf.time;
    for (const frame of set.attachment) if (frame.time > max) max = frame.time;
  }
  for (const frames of animation.ik.values()) {
    for (const kf of frames) if (kf.time > max) max = kf.time;
  }
  for (const frames of animation.transform.values()) {
    for (const kf of frames) if (kf.time > max) max = kf.time;
  }
  for (const bySlot of animation.deform.values()) {
    for (const byName of bySlot.values()) {
      for (const frames of byName.values()) {
        for (const kf of frames) if (kf.time > max) max = kf.time;
      }
    }
  }
  return max;
}

// Set an animation's duration (command-history catalog SetAnimationDuration, `anim.duration`). Window
// coalescing merges same-animation duration nudges within the time window, mirroring MoveBone. The
// command REJECTS shrinking the duration below the last keyframe time with a typed AnimationDurationError
// thrown BEFORE any mutation (no document change, no history entry); the format validator independently
// enforces the same bound on import. The reject is the author-time equivalent, not a re-coding of the
// format check.
export class SetAnimationDurationCommand implements Command {
  readonly kind = 'anim.duration';
  readonly label = 'Set Animation Duration';
  private before: number | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly after: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const lastTime = lastKeyframeTime(animation);
      if (this.after < lastTime) {
        throw new AnimationDurationError(this.animId, this.after, lastTime);
      }
      this.before = animation.duration;
    }
    ctx.mutate.patchAnimation(this.animId, { duration: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchAnimation(this.animId, { duration: this.before });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetAnimationDurationCommand && prev.animId === this.animId) {
      const merged = new SetAnimationDurationCommand(this.animId, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setAnimationDurationSpec: CommandSpec = {
  kind: 'anim.duration',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    // Grow the duration (always valid) so the fixture yields a real delta with no shrink rejection.
    return { command: new SetAnimationDurationCommand(animation.id, animation.duration + 0.5) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('anim.duration fixture seed had no animations');
    const a = findAnimationSnapshot(after, target.id);
    if (!a) throw new Error('anim.duration target missing from snapshot');
    if (a.duration === target.duration) throw new Error('anim.duration produced no duration delta');
  },
};
