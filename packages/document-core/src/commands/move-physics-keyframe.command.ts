import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makePhysicsKeyframe, type PhysicsKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, PhysicsConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a physics keyframe to a new time (`physics.moveKeyframe`; PP-D12), the mirror of MovePathKeyframe.
// Targets the frame by KeyframeId, re-sorts the channel, preserves the frame's channels and curve, and REJECTS
// a move onto a time another frame already occupies with a typed KeyframeCollisionError thrown before any
// mutation. Session coalescing collapses a dopesheet drag to one undo step; before/after are whole-channel
// mementos.
export class MovePhysicsKeyframeCommand implements Command {
  readonly kind = 'physics.moveKeyframe';
  readonly label = 'Move Physics Keyframe';
  private before: readonly PhysicsKeyframeEntity[] | undefined;
  private after: readonly PhysicsKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PhysicsConstraintId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.physics.get(this.constraintId) ?? [];
      const moving = channel.find((kf) => kf.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((kf) => kf.id !== this.keyframeId && kf.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makePhysicsKeyframe(
        moving.id,
        this.newTime,
        {
          mix: moving.mix,
          inertia: moving.inertia,
          strength: moving.strength,
          damping: moving.damping,
          wind: moving.wind,
          gravity: moving.gravity,
        },
        moving.curve,
      );
      this.after = channel
        .map((kf) => (kf.id === this.keyframeId ? moved : kf))
        .sort((a, b) => a.time - b.time);
    }
    ctx.mutate.setPhysicsChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPhysicsChannel(this.animId, this.constraintId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MovePhysicsKeyframeCommand &&
      prev.animId === this.animId &&
      prev.constraintId === this.constraintId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MovePhysicsKeyframeCommand(
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

function physicsTimes(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number[] {
  if (snapshot === undefined) return [];
  const track = snapshot.physics.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.map((kf) => kf.time) : [];
}

export const movePhysicsKeyframeSpec: CommandSpec = {
  kind: 'physics.moveKeyframe',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'jiggle') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.physics][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const last = frames[frames.length - 1]!;
    const prev = frames[frames.length - 2]!;
    const newTime = (prev.time + last.time) / 2;
    return {
      command: new MovePhysicsKeyframeCommand(animation.id, constraintId, last.id, newTime),
    };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'jiggle') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('physics.moveKeyframe fixture seed had no animations');
    const track = animBefore.physics[0];
    if (track === undefined)
      throw new Error('physics.moveKeyframe fixture seed had no physics track');
    const b = physicsTimes(findAnimationSnapshot(before, animBefore.id), track.constraintId);
    const a = physicsTimes(findAnimationSnapshot(after, animBefore.id), track.constraintId);
    if (a.length !== b.length) throw new Error('physics.moveKeyframe changed the keyframe count');
    if (a.join(',') === b.join(',')) throw new Error('physics.moveKeyframe produced no time delta');
    for (let i = 1; i < a.length; i += 1) {
      if (a[i]! <= a[i - 1]!)
        throw new Error('physics.moveKeyframe left the channel out of time order');
    }
  },
};
