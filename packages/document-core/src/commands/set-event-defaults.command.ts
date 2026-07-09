import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EventEditError } from '../command/errors';
import { makeEventDef, type EventDefEntity } from '../model/doc-state';
import type { EventDefId } from '../model/ids';
import type { CommandSpec } from './spec';

// The int/float/string payload DEFAULTS a SetEventDefaults writes (each a value or undefined to clear it).
export interface EventDefaults {
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
}

// Set an event definition's payload defaults (command-history Stage F1, `event.setDefaults`; PP-D9). The
// audio hint is left untouched. before/after are whole-entity mementos, and it COALESCES on the same
// EventDefId, so a payload-value drag (a number spinner) collapses to one undo step. NOT a structural edit
// (no name change), so no uniqueness guard.
export class SetEventDefaultsCommand implements Command {
  readonly kind = 'event.setDefaults';
  readonly label = 'Set Event Defaults';
  private before: EventDefEntity | undefined;
  private after: EventDefEntity | undefined;

  constructor(
    private readonly id: EventDefId,
    private readonly defaults: EventDefaults,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const def = ctx.mutate.getEventDef(this.id);
      if (!def) throw new EventEditError('notFound', this.id);
      this.before = def;
      this.after = makeEventDef(this.id, def.name, {
        int: this.defaults.int,
        float: this.defaults.float,
        string: this.defaults.string,
        audio: def.audio,
      });
    }
    if (this.after === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setEventDef(this.id, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setEventDef(this.id, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetEventDefaultsCommand &&
      prev.id === this.id &&
      prev.before !== undefined &&
      this.after !== undefined
    ) {
      const merged = new SetEventDefaultsCommand(this.id, this.defaults);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const setEventDefaultsSpec: CommandSpec = {
  kind: 'event.setDefaults',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const def = model.eventDefs()[0];
    if (!def) return null;
    return {
      command: new SetEventDefaultsCommand(def.id, { int: 99, float: 1.25, string: 'hit' }),
    };
  },
  assertApplied: (before, after) => {
    const id = before.eventOrder[0];
    if (id === undefined) throw new Error('event.setDefaults fixture seed had no event definitions');
    const a = after.events.find((d) => d.id === id);
    if (!a) throw new Error('event.setDefaults target missing from snapshot');
    if (a.int !== 99 || a.float !== 1.25 || a.string !== 'hit') {
      throw new Error('event.setDefaults did not apply the payload defaults');
    }
  },
};
