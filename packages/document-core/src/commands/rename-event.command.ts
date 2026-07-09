import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError, EventEditError } from '../command/errors';
import { makeEventDef } from '../model/doc-state';
import type { EventDefId } from '../model/ids';
import { assertEventNameFree, assertEventNameNonEmpty } from './event-support';
import type { CommandSpec } from './spec';

// Rename an event definition (command-history Stage F1, `event.rename`; PP-D9). A single-field change with
// ZERO cascade because an animation's event keys reference the definition by EventDefId, not by name. The
// new name is checked non-empty and unique (against every OTHER definition) BEFORE any mutation. Never
// coalesces. Memento is the prior name.
export class RenameEventCommand implements Command {
  readonly kind = 'event.rename';
  readonly label = 'Rename Event';
  private before: string | undefined;

  constructor(
    private readonly id: EventDefId,
    private readonly after: string,
  ) {}

  do(ctx: CommandContext): void {
    const def = ctx.mutate.getEventDef(this.id);
    if (!def) throw new EventEditError('notFound', this.id);
    assertEventNameNonEmpty(this.after);
    assertEventNameFree(ctx.mutate, this.after, this.id);
    if (this.before === undefined) this.before = def.name;
    ctx.mutate.setEventDef(
      this.id,
      makeEventDef(this.id, this.after, {
        int: def.int,
        float: def.float,
        string: def.string,
        audio: def.audio,
      }),
    );
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    const def = ctx.mutate.getEventDef(this.id);
    if (!def) throw new CommandTargetMissingError(this.kind, this.id);
    ctx.mutate.setEventDef(
      this.id,
      makeEventDef(this.id, this.before, {
        int: def.int,
        float: def.float,
        string: def.string,
        audio: def.audio,
      }),
    );
  }
}

export const renameEventSpec: CommandSpec = {
  kind: 'event.rename',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const def = model.eventDefs()[0];
    if (!def) return null;
    return { command: new RenameEventCommand(def.id, `${def.name}_renamed`) };
  },
  assertApplied: (before, after) => {
    const id = before.eventOrder[0];
    if (id === undefined) throw new Error('event.rename fixture seed had no event definitions');
    const b = before.events.find((d) => d.id === id);
    const a = after.events.find((d) => d.id === id);
    if (!b || !a) throw new Error('event.rename target missing from snapshot');
    if (a.name === b.name) throw new Error('event.rename produced no name delta');
    if (a.int !== b.int || a.float !== b.float) {
      throw new Error('event.rename changed a payload default');
    }
  },
};
