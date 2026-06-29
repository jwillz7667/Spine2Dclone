import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { TransformConstraintEntity, TransformKeyframeEntity } from '../model/doc-state';
import type { AnimationId, TransformConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// A captured transform timeline track (one animation's transform keyframes keyed to the deleted constraint).
interface RemovedTransformTrack {
  readonly animId: AnimationId;
  readonly frames: readonly TransformKeyframeEntity[];
}

// Delete a transform constraint and cascade every animation's transform timeline keyed to it (command-
// history catalog DeleteTransformConstraint, `transform.delete`; WP-2.7), mirroring DeleteIkConstraint's
// cascade. A SINGLE command with a SET memento (the removed constraint with its solve-order index plus the
// removed transform tracks), so the whole cascade is ONE undo step. do clears the tracks, then removes the
// constraint; undo re-inserts the constraint at its original index BEFORE restoring its tracks (so a
// restored timeline always keys a live constraint). notFound is rejected BEFORE any mutation. NOT coalescing.
export class DeleteTransformConstraintCommand implements Command {
  readonly kind = 'transform.delete';
  readonly label = 'Delete Transform Constraint';
  private entity: TransformConstraintEntity | undefined;
  private index = 0;
  private tracks: readonly RemovedTransformTrack[] | undefined;

  constructor(private readonly id: TransformConstraintId) {}

  do(ctx: CommandContext): void {
    if (this.entity === undefined || this.tracks === undefined) {
      const constraints = ctx.mutate.transformConstraints();
      const index = constraints.findIndex((c) => c.id === this.id);
      if (index < 0) throw new ConstraintError('notFound', this.id);
      const tracks: RemovedTransformTrack[] = [];
      for (const animation of ctx.mutate.animations()) {
        const frames = animation.transform.get(this.id);
        if (frames && frames.length > 0) tracks.push({ animId: animation.id, frames });
      }
      this.entity = constraints[index]!;
      this.index = index;
      this.tracks = tracks;
    }
    // Clear the timelines first, then remove the constraint definition, so no track ever keys a constraint
    // that no longer exists.
    for (const track of this.tracks) ctx.mutate.setTransformChannel(track.animId, this.id, []);
    ctx.mutate.removeTransformConstraint(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.entity === undefined || this.tracks === undefined) {
      throw new CommandNotAppliedError(this.kind);
    }
    // Re-insert the constraint at its original solve-order index, then restore its timelines onto the now-
    // live constraint.
    ctx.mutate.insertTransformConstraint(this.entity, this.index);
    for (const track of this.tracks)
      ctx.mutate.setTransformChannel(track.animId, this.id, track.frames);
  }
}

export const deleteTransformConstraintSpec: CommandSpec = {
  kind: 'transform.delete',
  // 'rigged' carries the 'follow' transform constraint plus a transform timeline keyed to it, so deleting
  // it exercises the timeline cascade.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.transformConstraints()[0];
    if (!c) return null;
    return { command: new DeleteTransformConstraintCommand(c.id) };
  },
  assertApplied: (before, after) => {
    const id = before.transformConstraints[0]?.id;
    if (id === undefined) throw new Error('transform.delete fixture seed had no constraints');
    if (after.transformConstraints.some((c) => c.id === id)) {
      throw new Error('transform.delete did not remove the target constraint');
    }
    if (after.transformConstraints.length !== before.transformConstraints.length - 1) {
      throw new Error('transform.delete expected exactly one fewer transform constraint');
    }
  },
};
