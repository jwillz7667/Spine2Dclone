import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EventEditError } from '../command/errors';
import type { EventDefEntity, EventKeyEntity } from '../model/doc-state';
import type { AnimationId, EventDefId } from '../model/ids';
import type { CommandSpec } from './spec';

// One captured event timeline (an animation's event keys for the deleted definition) so the cascade
// restores every key the definition owned across all animations.
interface RemovedEventTrack {
  readonly animId: AnimationId;
  readonly before: readonly EventKeyEntity[];
  readonly after: readonly EventKeyEntity[];
}

interface RemovedEventDef {
  readonly entity: EventDefEntity;
  readonly index: number; // original eventOrder index, for exact restore
  readonly tracks: readonly RemovedEventTrack[];
}

// Delete an event definition, cascading every animation's event key that fires it (command-history Stage
// F1, `event.delete`; PP-D9). A SINGLE command with a SET memento (the removed definition with its
// eventOrder index, plus the removed event tracks), NOT a composite, so the whole cascade is ONE undo step.
// Never coalesces. undo re-inserts the definition at its original index and restores each event timeline
// (the definition its keys reference is live again).
export class DeleteEventCommand implements Command {
  readonly kind = 'event.delete';
  readonly label = 'Delete Event';
  private before: RemovedEventDef | undefined;

  constructor(private readonly id: EventDefId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const defs = ctx.mutate.eventDefs();
      const index = defs.findIndex((d) => d.id === this.id);
      if (index < 0) throw new EventEditError('notFound', this.id);
      const entity = defs[index]!;
      const tracks: RemovedEventTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        if (anim.events.some((key) => key.event === this.id)) {
          tracks.push({
            animId: anim.id,
            before: anim.events,
            after: anim.events.filter((key) => key.event !== this.id),
          });
        }
      }
      this.before = { entity, index, tracks };
    }
    // Prune the event keys first, then remove the definition, so each removal is independent.
    for (const track of this.before.tracks) ctx.mutate.setEventTimeline(track.animId, track.after);
    ctx.mutate.removeEventDef(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertEventDef(this.before.entity, this.before.index);
    for (const track of this.before.tracks) ctx.mutate.setEventTimeline(track.animId, track.before);
  }
}

export const deleteEventSpec: CommandSpec = {
  kind: 'event.delete',
  // 'evented' carries two event definitions and an animation firing both, so the delete exercises the
  // key cascade.
  representativeSeedId: 'evented',
  fixture: (model) => {
    const def = model.eventDefs()[0];
    if (!def) return null;
    return { command: new DeleteEventCommand(def.id) };
  },
  assertApplied: (before, after) => {
    if (after.events.length !== before.events.length - 1) {
      throw new Error('event.delete did not remove exactly one event definition');
    }
  },
};
