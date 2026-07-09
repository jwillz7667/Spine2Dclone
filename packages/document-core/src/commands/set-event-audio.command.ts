import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EventEditError } from '../command/errors';
import { makeEventDef, type EventAudioValue, type EventDefEntity } from '../model/doc-state';
import type { EventDefId } from '../model/ids';
import { assertEventAudioInRange } from './event-support';
import type { CommandSpec } from './spec';

// Set (or clear) an event definition's audio hint (command-history Stage F1, `event.setAudio`; PP-D9).
// A defined hint's volume/balance range is validated BEFORE any mutation (EVENT_AUDIO_RANGE); undefined
// clears the hint. The payload defaults are left untouched. before/after are whole-entity mementos, and it
// COALESCES on the same EventDefId so a volume/balance slider drag collapses to one undo step.
export class SetEventAudioCommand implements Command {
  readonly kind = 'event.setAudio';
  readonly label = 'Set Event Audio';
  private before: EventDefEntity | undefined;
  private after: EventDefEntity | undefined;

  constructor(
    private readonly id: EventDefId,
    private readonly audio: EventAudioValue | undefined,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const def = ctx.mutate.getEventDef(this.id);
      if (!def) throw new EventEditError('notFound', this.id);
      assertEventAudioInRange(this.audio);
      this.before = def;
      this.after = makeEventDef(this.id, def.name, {
        int: def.int,
        float: def.float,
        string: def.string,
        audio: this.audio,
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
      prev instanceof SetEventAudioCommand &&
      prev.id === this.id &&
      prev.before !== undefined &&
      this.after !== undefined
    ) {
      const merged = new SetEventAudioCommand(this.id, this.audio);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const setEventAudioSpec: CommandSpec = {
  kind: 'event.setAudio',
  // 'evented' has an event with an existing audio hint (footstep) and one without (landing); target the one
  // WITHOUT so setting a fresh hint is a real delta.
  representativeSeedId: 'evented',
  fixture: (model) => {
    const target = model.eventDefs().find((d) => d.audio === undefined);
    if (!target) return null;
    return {
      command: new SetEventAudioCommand(target.id, {
        path: 'sfx/land.wav',
        volume: 0.5,
        balance: 0,
      }),
    };
  },
  assertApplied: (before, after) => {
    const beforeTarget = before.events.find((d) => d.audio === undefined);
    if (beforeTarget === undefined) {
      throw new Error('event.setAudio fixture seed had no audioless event');
    }
    const a = after.events.find((d) => d.id === beforeTarget.id);
    if (!a || a.audio === undefined) throw new Error('event.setAudio did not set the audio hint');
    if (a.audio.path !== 'sfx/land.wav' || a.audio.volume !== 0.5) {
      throw new Error('event.setAudio did not apply the audio values');
    }
  },
};
