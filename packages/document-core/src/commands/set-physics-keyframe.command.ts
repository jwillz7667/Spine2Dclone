import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandTargetMissingError } from '../command/errors';
import { makePhysicsKeyframe, type PhysicsKeyframeEntity } from '../model/doc-state';
import type { AnimationId, PhysicsConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The animatable physics-constraint channels a keyframe carries; each is a number or undefined (an absent
// channel keeps its base value, ADR-0014 section 7). step/mass/channels are NOT keyable.
export interface PhysicsKeyframeChannels {
  readonly mix: number | undefined;
  readonly inertia: number | undefined;
  readonly strength: number | undefined;
  readonly damping: number | undefined;
  readonly wind: number | undefined;
  readonly gravity: number | undefined;
}

// Insert-or-update a physics keyframe (command-history catalog SetPhysicsKeyframe, `physics.setKeyframe`;
// PP-D12), the mirror of SetPathKeyframe. If a frame already exists at `time` its channels are updated (its
// KeyframeId, time, and curve are kept); otherwise a new frame is minted and inserted, keeping the channel
// strictly time-sorted. On insert the new frame takes `insertCurve` (default 'linear'). before/after are
// whole-channel mementos, so undo is bit-exact. Does NOT coalesce (a keyframe edit is discrete, not a scrub).
export class SetPhysicsKeyframeCommand implements Command {
  readonly kind = 'physics.setKeyframe';
  readonly label = 'Set Physics Keyframe';
  private before: readonly PhysicsKeyframeEntity[] | undefined;
  private after: readonly PhysicsKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PhysicsConstraintId,
    private readonly time: number,
    private readonly channels: PhysicsKeyframeChannels,
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.physics.get(this.constraintId) ?? [];
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        const updated = makePhysicsKeyframe(
          existing.id,
          existing.time,
          this.channels,
          existing.curve,
        );
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const inserted = makePhysicsKeyframe(
          ctx.ids.mint('keyframe'),
          this.time,
          this.channels,
          this.insertCurve,
        );
        this.after = [...channel, inserted].sort((a, b) => a.time - b.time);
      }
    }
    ctx.mutate.setPhysicsChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandTargetMissingError(this.kind, this.animId);
    ctx.mutate.setPhysicsChannel(this.animId, this.constraintId, this.before);
  }
}

function countPhysicsFrames(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  constraintId: string,
): number {
  if (snapshot === undefined) return 0;
  const track = snapshot.physics.find((t) => t.constraintId === constraintId);
  return track ? track.keyframes.length : 0;
}

export const setPhysicsKeyframeSpec: CommandSpec = {
  kind: 'physics.setKeyframe',
  // 'physicsed' has an animation ('jiggle') whose physics timeline carries two keys, so an insert at their
  // midpoint is a free time with a real delta.
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'jiggle') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.physics][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    if (frames.length < 2) return null;
    const time = (frames[0]!.time + frames[1]!.time) / 2;
    return {
      command: new SetPhysicsKeyframeCommand(animation.id, constraintId, time, {
        mix: 0.5,
        inertia: undefined,
        strength: undefined,
        damping: undefined,
        wind: 2.5,
        gravity: undefined,
      }),
    };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'jiggle') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('physics.setKeyframe fixture seed had no animations');
    const track = animBefore.physics[0];
    if (track === undefined)
      throw new Error('physics.setKeyframe fixture seed had no physics track');
    const beforeCount = countPhysicsFrames(
      findAnimationSnapshot(before, animBefore.id),
      track.constraintId,
    );
    const afterCount = countPhysicsFrames(
      findAnimationSnapshot(after, animBefore.id),
      track.constraintId,
    );
    if (afterCount !== beforeCount + 1) {
      throw new Error('physics.setKeyframe did not insert exactly one physics keyframe');
    }
  },
};
