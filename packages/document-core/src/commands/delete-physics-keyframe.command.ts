import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PhysicsKeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId, PhysicsConstraintId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete one physics keyframe by id (command-history catalog DeletePhysicsKeyframe, `physics.deleteKeyframe`;
// PP-D12), the mirror of DeletePathKeyframe. before/after are whole-channel mementos, so undo is bit-exact and
// the surviving frames keep their ids and order. Does NOT coalesce. When the channel empties the mutator prunes
// the track (setPhysicsChannel with an empty array).
export class DeletePhysicsKeyframeCommand implements Command {
  readonly kind = 'physics.deleteKeyframe';
  readonly label = 'Delete Physics Keyframe';
  private before: readonly PhysicsKeyframeEntity[] | undefined;
  private after: readonly PhysicsKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: PhysicsConstraintId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.physics.get(this.constraintId) ?? [];
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    ctx.mutate.setPhysicsChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
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

export const deletePhysicsKeyframeSpec: CommandSpec = {
  kind: 'physics.deleteKeyframe',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'jiggle') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.physics][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    const first = frames[0];
    if (first === undefined) return null;
    return { command: new DeletePhysicsKeyframeCommand(animation.id, constraintId, first.id) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'jiggle') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('physics.deleteKeyframe fixture seed had no animations');
    const track = animBefore.physics[0];
    if (track === undefined)
      throw new Error('physics.deleteKeyframe fixture seed had no physics track');
    const beforeCount = countPhysicsFrames(
      findAnimationSnapshot(before, animBefore.id),
      track.constraintId,
    );
    const afterCount = countPhysicsFrames(
      findAnimationSnapshot(after, animBefore.id),
      track.constraintId,
    );
    if (afterCount !== beforeCount - 1) {
      throw new Error('physics.deleteKeyframe did not remove exactly one physics keyframe');
    }
  },
};
