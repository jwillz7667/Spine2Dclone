import type { RGBA } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

function cloneColor(color: RGBA): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

// Set (or clear) a slot's setup DARK color (`slot.darkColor`, PP-D10; two-color tint, ADR-0009 section 4.3).
// A non-null RGBA enables the two-color tint (and is what a keyable `dark` timeline requires); null disables
// it. Coalesces same-target edits within one color-picker session, mirroring SetSlotColor: `before` is a deep
// value copy captured on first do and `after` is the absolute target, so undo is bit-exact and a coalesced
// drag never accumulates drift. A merged command keeps the ORIGINAL before and the latest after.
export class SetSlotDarkColorCommand implements Command {
  readonly kind = 'slot.darkColor';
  readonly label = 'Set Slot Dark Color';
  private before: RGBA | null | undefined;
  private captured = false;

  constructor(
    private readonly target: SlotId,
    private readonly after: RGBA | null,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.captured) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = slot.darkColor === null ? null : cloneColor(slot.darkColor);
      this.captured = true;
    }
    ctx.mutate.patchSlot(this.target, {
      darkColor: this.after === null ? null : cloneColor(this.after),
    });
  }

  undo(ctx: CommandContext): void {
    if (!this.captured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchSlot(this.target, {
      darkColor: this.before == null ? null : cloneColor(this.before),
    });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetSlotDarkColorCommand && prev.target === this.target) {
      const merged = new SetSlotDarkColorCommand(this.target, this.after);
      merged.before = prev.before;
      merged.captured = prev.captured;
      return merged;
    }
    return null;
  }
}

export const setSlotDarkColorSpec: CommandSpec = {
  kind: 'slot.darkColor',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const target = model.slots()[0];
    if (!target) return null;
    // The seed slots have no dark color; enabling one is a real delta.
    return { command: new SetSlotDarkColorCommand(target.id, { r: 0.1, g: 0.2, b: 0.3, a: 1 }) };
  },
  assertApplied: (before, after) => {
    const id = before.slotOrder[0];
    if (id === undefined) throw new Error('slot.darkColor fixture seed had no slots');
    const b = findSlotSnapshot(before, id);
    const a = findSlotSnapshot(after, id);
    if (!b || !a) throw new Error('slot.darkColor target missing from snapshot');
    if (JSON.stringify(a.darkColor) === JSON.stringify(b.darkColor)) {
      throw new Error('slot.darkColor produced no delta');
    }
  },
};
