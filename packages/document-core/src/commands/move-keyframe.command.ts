import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makeKeyframe, type KeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import {
  readChannel,
  sameTarget,
  sortByTime,
  writeChannel,
  type KeyframeTarget,
} from './keyframe-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a keyframe to a new time (command-history catalog MoveKeyframe, `kf.move`). Targets the keyframe
// by KeyframeId (an array index would go stale on any sibling edit), re-sorts the channel, and REJECTS a
// move onto a time another keyframe already occupies with a typed KeyframeCollisionError thrown before
// any mutation (auto-key/UI prevent collisions; this is the fail-loud backstop). Session coalescing
// collapses a dopesheet drag to one undo step; before/after are whole-channel mementos.
export class MoveKeyframeCommand implements Command {
  readonly kind = 'kf.move';
  readonly label = 'Move Keyframe';
  private before: readonly KeyframeEntity[] | undefined;
  private after: readonly KeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly target: KeyframeTarget,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = readChannel(animation, this.target);
      const moving = channel.find((kf) => kf.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((kf) => kf.id !== this.keyframeId && kf.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makeKeyframe(moving.id, this.newTime, moving.value, moving.curve);
      this.after = sortByTime(channel.map((kf) => (kf.id === this.keyframeId ? moved : kf)));
    }
    writeChannel(ctx.mutate, this.animId, this.target, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    writeChannel(ctx.mutate, this.animId, this.target, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveKeyframeCommand &&
      prev.animId === this.animId &&
      sameTarget(prev.target, this.target) &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveKeyframeCommand(
        this.animId,
        this.target,
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

function keyframeTimes(snapshot: ReturnType<typeof findAnimationSnapshot>): number[] {
  if (snapshot === undefined) return [];
  return snapshot.bones.flatMap((bone) => bone.rotate.map((kf) => kf.time));
}

export const moveKeyframeSpec: CommandSpec = {
  kind: 'kf.move',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [boneId, set] of animation.bones) {
      // Move the LAST rotate key to a free time strictly between the prior key and itself, so the move
      // stays in range, collides with nothing, and re-sorting is a no-op visible only as a time delta.
      if (set.rotate.length >= 2) {
        const last = set.rotate[set.rotate.length - 1]!;
        const prev = set.rotate[set.rotate.length - 2]!;
        const newTime = (prev.time + last.time) / 2;
        const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
        return { command: new MoveKeyframeCommand(animation.id, target, last.id, newTime) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('kf.move fixture seed had no animations');
    const beforeTimes = keyframeTimes(findAnimationSnapshot(before, target.id));
    const afterTimes = keyframeTimes(findAnimationSnapshot(after, target.id));
    if (afterTimes.length !== beforeTimes.length) {
      throw new Error('kf.move changed the keyframe count');
    }
    if (beforeTimes.join(',') === afterTimes.join(',')) {
      throw new Error('kf.move produced no time delta');
    }
    // The channel must stay strictly ascending after the move.
    for (let i = 1; i < afterTimes.length; i += 1) {
      if (afterTimes[i]! <= afterTimes[i - 1]!) {
        throw new Error('kf.move left the channel out of time order');
      }
    }
  },
};
