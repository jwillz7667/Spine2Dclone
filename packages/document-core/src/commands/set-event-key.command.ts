import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError, EventEditError } from '../command/errors';
import { makeEventKey, type EventKeyEntity } from '../model/doc-state';
import type { AnimationId, EventDefId, KeyframeId } from '../model/ids';
import { sortEventKeysByTime } from './event-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The int/float/string payload OVERRIDES an event key carries (each a value or undefined to defer to the
// definition's default for that field).
export interface EventKeyOverrides {
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
}

// Insert-or-update an event-timeline key (command-history Stage F1, `event.key.set`; PP-D9). If a key
// already fires the SAME event at exactly `time`, its overrides are updated (id kept); otherwise a new key
// is minted and inserted, keeping the timeline non-decreasing in time (stable sort, so coincident firings
// keep order). The referenced event definition must exist (checked before any mutation). before/after are
// whole-timeline mementos; it COALESCES on the touched KeyframeId so an override drag folds to one undo step.
export class SetEventKeyCommand implements Command {
  readonly kind = 'event.key.set';
  readonly label = 'Set Event Key';
  private before: readonly EventKeyEntity[] | undefined;
  private after: readonly EventKeyEntity[] = [];
  private touchedId: KeyframeId | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly eventId: EventDefId,
    private readonly time: number,
    private readonly overrides: EventKeyOverrides,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      if (!ctx.mutate.getEventDef(this.eventId)) throw new EventEditError('notFound', this.eventId);
      const keys = animation.events;
      this.before = keys;
      const existing = keys.find((key) => key.time === this.time && key.event === this.eventId);
      if (existing) {
        this.touchedId = existing.id;
        const updated = makeEventKey(existing.id, existing.time, this.eventId, this.overrides);
        this.after = sortEventKeysByTime(keys.map((key) => (key.id === existing.id ? updated : key)));
      } else {
        const id = ctx.ids.mint('keyframe');
        this.touchedId = id;
        const inserted = makeEventKey(id, this.time, this.eventId, this.overrides);
        this.after = sortEventKeysByTime([...keys, inserted]);
      }
    }
    ctx.mutate.setEventTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setEventTimeline(this.animId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetEventKeyCommand &&
      prev.animId === this.animId &&
      prev.eventId === this.eventId &&
      prev.touchedId !== undefined &&
      prev.touchedId === this.touchedId
    ) {
      const merged = new SetEventKeyCommand(this.animId, this.eventId, this.time, this.overrides);
      merged.before = prev.before;
      merged.after = this.after;
      merged.touchedId = this.touchedId;
      return merged;
    }
    return null;
  }
}

export const setEventKeySpec: CommandSpec = {
  kind: 'event.key.set',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    const def = model.eventDefs()[0];
    if (!animation || !def) return null;
    // Fire the event at a free time (0.5) between the two existing keys: a real insert with an override.
    return {
      command: new SetEventKeyCommand(animation.id, def.id, 0.5, {
        int: 42,
        float: undefined,
        string: undefined,
      }),
    };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('event.key.set fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.events.length ?? 0;
    const a = findAnimationSnapshot(after, target.id)?.events.length ?? 0;
    if (a !== b + 1) throw new Error('event.key.set did not insert exactly one event key');
  },
};
