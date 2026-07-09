import type { Command, CommandContext } from '../command/command';
import type { EventAudioValue } from '../model/doc-state';
import { makeEventDef } from '../model/doc-state';
import type { EventDefId } from '../model/ids';
import {
  assertEventAudioInRange,
  assertEventNameFree,
  assertEventNameNonEmpty,
} from './event-support';
import type { CommandSpec } from './spec';

// The payload defaults and audio hint a DefineEvent carries (each a value or undefined so a caller states
// intent, mirroring the entity shape).
export interface EventDefInit {
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
  readonly audio: EventAudioValue | undefined;
}

// Create a document-level event definition (command-history Stage F1, `event.define`; PP-D9). The name is
// checked non-empty and unique across the event definitions, and the audio range is validated, all BEFORE
// any mutation, so an invalid define leaves no document change and no history entry. The EventDefId is
// minted by the caller so redo reuses the same id. The definition appends to the end of eventOrder. The undo
// memento is the id (removeEventDef reverses the insert). NOT coalescing.
export class DefineEventCommand implements Command {
  readonly kind = 'event.define';
  readonly label = 'Define Event';

  constructor(
    private readonly id: EventDefId,
    private readonly name: string,
    private readonly init: EventDefInit,
  ) {}

  do(ctx: CommandContext): void {
    assertEventNameNonEmpty(this.name);
    assertEventNameFree(ctx.mutate, this.name);
    assertEventAudioInRange(this.init.audio);
    ctx.mutate.insertEventDef(
      makeEventDef(this.id, this.name, this.init),
      ctx.mutate.eventDefs().length,
    );
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeEventDef(this.id);
  }
}

export const defineEventSpec: CommandSpec = {
  kind: 'event.define',
  // 'minimal' carries no event definitions, so defining one is a clean append with a real delta.
  representativeSeedId: 'minimal',
  fixture: (model, ids) => {
    if (model.eventDefs().some((d) => d.name === 'event_new')) return null;
    return {
      command: new DefineEventCommand(ids.mint('eventDef'), 'event_new', {
        int: 5,
        float: undefined,
        string: undefined,
        audio: undefined,
      }),
    };
  },
  assertApplied: (before, after) => {
    if (after.events.length !== before.events.length + 1) {
      throw new Error('event.define did not add exactly one event definition');
    }
  },
};
