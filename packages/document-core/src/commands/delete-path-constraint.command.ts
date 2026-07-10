import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { AnimationEntity, PathConstraintEntity } from '../model/doc-state';
import type { AnimationId, PathConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The carried path timeline track for one constraint in one animation (still keyed by NAME and held as the
// on-disk keyframe array until the path timeline's own id-keyed promotion, PP-D11 slice 2).
type PathTrackFrames = AnimationEntity['path'][string];

// One captured path timeline track, so the cascade restores every track the constraint owned across all
// animations on undo.
interface RemovedPathTrack {
  readonly animId: AnimationId;
  readonly frames: PathTrackFrames;
}

interface RemovedPathConstraint {
  readonly entity: PathConstraintEntity;
  readonly index: number; // original pathConstraintOrder index, for exact restore
  readonly tracks: readonly RemovedPathTrack[];
}

// Delete a path constraint, cascading every animation's carried path timeline that targets it (command-
// history catalog DeletePathConstraint, `path.deleteConstraint`; PP-D11). A SINGLE command with a SET memento
// (the removed constraint with its solve-order index, plus the removed path tracks), NOT a composite, so the
// whole cascade is ONE undo step. Never coalesces. undo re-inserts the constraint at its original index and
// restores each path track. Pruning the timeline keeps export valid (an orphan track fails ANIM_PATH_UNKNOWN).
export class DeletePathConstraintCommand implements Command {
  readonly kind = 'path.deleteConstraint';
  readonly label = 'Delete Path Constraint';
  private before: RemovedPathConstraint | undefined;

  constructor(private readonly id: PathConstraintId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const list = ctx.mutate.pathConstraints();
      const index = list.findIndex((c) => c.id === this.id);
      if (index < 0) throw new ConstraintError('notFound', this.id);
      const entity = list[index]!;
      const tracks: RemovedPathTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        const frames = anim.path[entity.name];
        if (frames !== undefined && frames.length > 0) tracks.push({ animId: anim.id, frames });
      }
      this.before = { entity, index, tracks };
    }
    // Prune the carried path tracks first (by the constraint's name), then remove the constraint.
    for (const track of this.before.tracks) {
      ctx.mutate.setCarriedPathTimeline(track.animId, this.before.entity.name, null);
    }
    ctx.mutate.removePathConstraint(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertPathConstraint(this.before.entity, this.before.index);
    for (const track of this.before.tracks) {
      ctx.mutate.setCarriedPathTimeline(track.animId, this.before.entity.name, track.frames);
    }
  }
}

export const deletePathConstraintSpec: CommandSpec = {
  kind: 'path.deleteConstraint',
  // 'pathed' carries a path constraint ('rail-follow') plus an animation that keys its path timeline, so the
  // delete exercises the carried-track cascade.
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const constraint = model.pathConstraints()[0];
    if (!constraint) return null;
    return { command: new DeletePathConstraintCommand(constraint.id) };
  },
  assertApplied: (before, after) => {
    if (after.pathConstraints.length !== before.pathConstraints.length - 1) {
      throw new Error('path.deleteConstraint did not remove exactly one path constraint');
    }
  },
};
