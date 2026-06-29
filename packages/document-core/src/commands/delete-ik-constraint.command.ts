import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { IkConstraintEntity, IkKeyframeEntity } from '../model/doc-state';
import type { AnimationId, IkConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// One captured IK timeline (an animation's keyed frames for the deleted constraint), so the cascade
// restores every track the constraint owned across all animations.
interface RemovedIkTrack {
  readonly animId: AnimationId;
  readonly frames: readonly IkKeyframeEntity[];
}

interface RemovedIkConstraint {
  readonly entity: IkConstraintEntity;
  readonly index: number; // original ikConstraintOrder index, for exact restore
  readonly tracks: readonly RemovedIkTrack[];
}

// Delete an IK constraint, cascading every animation's ik timeline that targets it (command-history
// catalog DeleteIkConstraint, `ik.delete`; WP-2.6). A SINGLE command with a SET memento (the removed
// constraint with its solve-order index, plus the removed ik tracks), NOT a composite, so the whole
// cascade is ONE undo step. Never coalesces. undo re-inserts the constraint at its original index and
// restores each ik track (the constraint it targets is live again).
export class DeleteIkConstraintCommand implements Command {
  readonly kind = 'ik.delete';
  readonly label = 'Delete IK Constraint';
  private before: RemovedIkConstraint | undefined;

  constructor(private readonly id: IkConstraintId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const list = ctx.mutate.ikConstraints();
      const index = list.findIndex((c) => c.id === this.id);
      if (index < 0) throw new ConstraintError('notFound', this.id);
      const entity = list[index]!;
      const tracks: RemovedIkTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        const frames = anim.ik.get(this.id);
        if (frames && frames.length > 0) tracks.push({ animId: anim.id, frames });
      }
      this.before = { entity, index, tracks };
    }
    // Prune the ik tracks first, then remove the constraint, so each removal is independent.
    for (const track of this.before.tracks) ctx.mutate.setIkChannel(track.animId, this.id, []);
    ctx.mutate.removeIkConstraint(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertIkConstraint(this.before.entity, this.before.index);
    for (const track of this.before.tracks) {
      ctx.mutate.setIkChannel(track.animId, this.id, track.frames);
    }
  }
}

export const deleteIkConstraintSpec: CommandSpec = {
  kind: 'ik.delete',
  // 'rigged' carries one IK constraint plus an animation that keys its ik timeline, so the delete
  // exercises the track cascade.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const constraint = model.ikConstraints()[0];
    if (!constraint) return null;
    return { command: new DeleteIkConstraintCommand(constraint.id) };
  },
  assertApplied: (before, after) => {
    if (after.ikConstraints.length !== before.ikConstraints.length - 1) {
      throw new Error('ik.delete did not remove exactly one IK constraint');
    }
  },
};
