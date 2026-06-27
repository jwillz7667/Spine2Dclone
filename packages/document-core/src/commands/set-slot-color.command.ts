import type { RGBA } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

function cloneColor(color: RGBA): RGBA {
  return { r: color.r, g: color.g, b: color.b, a: color.a };
}

// Set a slot's tint color (command-history catalog SetSlotColor, `slot.color`). Coalesces same-target
// color edits within one color-picker session, mirroring MoveBone: `before` is captured (a deep value
// copy) on first do and `after` is the absolute target, so undo is bit-exact and a coalesced drag never
// accumulates drift. A merged command keeps the ORIGINAL before and the latest after.
export class SetSlotColorCommand implements Command {
  readonly kind = 'slot.color';
  readonly label = 'Set Slot Color';
  private before: RGBA | undefined;

  constructor(
    private readonly target: SlotId,
    private readonly after: RGBA,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = cloneColor(slot.color);
    }
    ctx.mutate.patchSlot(this.target, { color: cloneColor(this.after) });
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchSlot(this.target, { color: cloneColor(this.before) });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetSlotColorCommand && prev.target === this.target) {
      const merged = new SetSlotColorCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setSlotColorSpec: CommandSpec = {
  kind: 'slot.color',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const target = model.slots()[0];
    if (!target) return null;
    const after: RGBA = { r: target.color.r, g: target.color.g, b: target.color.b, a: 0.25 };
    return { command: new SetSlotColorCommand(target.id, after) };
  },
  assertApplied: (before, after) => {
    const id = before.slotOrder[0];
    if (id === undefined) throw new Error('slot.color fixture seed had no slots');
    const b = findSlotSnapshot(before, id);
    const a = findSlotSnapshot(after, id);
    if (!b || !a) throw new Error('slot.color target missing from snapshot');
    if (a.color.a === b.color.a) throw new Error('slot.color produced no color delta');
    if (a.blendMode !== b.blendMode)
      throw new Error('slot.color changed a field outside the color');
  },
};
