import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { IkKeyframeEntity } from '../model/doc-state';
import type { AnimationId, IkConstraintId, KeyframeId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete one IK keyframe by id (command-history catalog DeleteIkKeyframe, `ik.deleteKeyframe`; WP-2.6).
// before/after are whole-channel mementos (the channel array with and without the frame), so undo is
// bit-exact and the surviving frames keep their ids and order. Does NOT coalesce. When the channel empties
// the mutator prunes the track (setIkChannel with an empty array).
export class DeleteIkKeyframeCommand implements Command {
  readonly kind = 'ik.deleteKeyframe';
  readonly label = 'Delete IK Keyframe';
  private before: readonly IkKeyframeEntity[] | undefined;
  private after: readonly IkKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly constraintId: IkConstraintId,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = animation.ik.get(this.constraintId) ?? [];
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    ctx.mutate.setIkChannel(this.animId, this.constraintId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
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

export const deleteIkKeyframeSpec: CommandSpec = {
  kind: 'ik.deleteKeyframe',
  // 'rigged' has an animation ('move') whose ik timeline carries two keys, so deleting the first leaves a
  // real (smaller) track.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const animation = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!animation) return null;
    const entry = [...animation.ik][0];
    if (!entry) return null;
    const [constraintId, frames] = entry;
    const first = frames[0];
    if (first === undefined) return null;
    return { command: new DeleteIkKeyframeCommand(animation.id, constraintId, first.id) };
  },
  assertApplied: (before, after) => {
    const animBefore = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (animBefore === undefined)
      throw new Error('ik.deleteKeyframe fixture seed had no animations');
    const track = animBefore.ik[0];
    if (track === undefined) throw new Error('ik.deleteKeyframe fixture seed had no ik track');
    const beforeCount = countIkFrames(
      findAnimationSnapshot(before, animBefore.id),
      track.constraintId,
    );
    const afterCount = countIkFrames(
      findAnimationSnapshot(after, animBefore.id),
      track.constraintId,
    );
    if (afterCount !== beforeCount - 1) {
      throw new Error('ik.deleteKeyframe did not remove exactly one IK keyframe');
    }
  },
};
