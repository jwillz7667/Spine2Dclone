import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { PhysicsConstraintEntity, PhysicsKeyframeEntity } from '../model/doc-state';
import type { AnimationId, PhysicsConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// One captured physics timeline track (an animation's keyed frames for the deleted constraint, id-keyed like the
// ik/transform/path tracks), so the cascade restores every track the constraint owned across all animations.
interface RemovedPhysicsTrack {
  readonly animId: AnimationId;
  readonly frames: readonly PhysicsKeyframeEntity[];
}

interface RemovedPhysicsConstraint {
  readonly entity: PhysicsConstraintEntity;
  readonly index: number; // original physicsConstraintOrder index, for exact restore
  readonly tracks: readonly RemovedPhysicsTrack[];
}

// Delete a physics constraint, cascading every animation's physics timeline that targets it (command-history
// catalog DeletePhysicsConstraint, `physics.deleteConstraint`; PP-D12), the exact mirror of path.delete. A
// SINGLE command with a SET memento (the removed constraint with its solve-order index, plus the removed physics
// tracks), NOT a composite, so the whole cascade is ONE undo step. Never coalesces. undo re-inserts the
// constraint at its original index and restores each physics track. Pruning keeps export valid (an orphan track
// fails ANIM_PHYSICS_UNKNOWN).
export class DeletePhysicsConstraintCommand implements Command {
  readonly kind = 'physics.deleteConstraint';
  readonly label = 'Delete Physics Constraint';
  private before: RemovedPhysicsConstraint | undefined;

  constructor(private readonly id: PhysicsConstraintId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const list = ctx.mutate.physicsConstraints();
      const index = list.findIndex((c) => c.id === this.id);
      if (index < 0) throw new ConstraintError('notFound', this.id);
      const entity = list[index]!;
      const tracks: RemovedPhysicsTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        const frames = anim.physics.get(this.id);
        if (frames && frames.length > 0) tracks.push({ animId: anim.id, frames });
      }
      this.before = { entity, index, tracks };
    }
    // Prune the physics tracks first, then remove the constraint, so each removal is independent.
    for (const track of this.before.tracks) ctx.mutate.setPhysicsChannel(track.animId, this.id, []);
    ctx.mutate.removePhysicsConstraint(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertPhysicsConstraint(this.before.entity, this.before.index);
    for (const track of this.before.tracks) {
      ctx.mutate.setPhysicsChannel(track.animId, this.id, track.frames);
    }
  }
}

export const deletePhysicsConstraintSpec: CommandSpec = {
  kind: 'physics.deleteConstraint',
  // 'physicsed' carries a physics constraint ('tail-jiggle') plus an animation that keys its physics timeline,
  // so the delete exercises the timeline cascade.
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const constraint = model.physicsConstraints()[0];
    if (!constraint) return null;
    return { command: new DeletePhysicsConstraintCommand(constraint.id) };
  },
  assertApplied: (before, after) => {
    if (after.physicsConstraints.length !== before.physicsConstraints.length - 1) {
      throw new Error('physics.deleteConstraint did not remove exactly one physics constraint');
    }
  },
};
