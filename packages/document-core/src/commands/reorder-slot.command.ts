import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

// Move `target` to `toIndex` within the order, clamping the index into range. Returns a new array.
function moveToIndex(order: readonly SlotId[], target: SlotId, toIndex: number): SlotId[] {
  const next = order.filter((id) => id !== target);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, target);
  return next;
}

// Reorder a slot in the setup-pose draw order (command-history catalog ReorderSlot, `slot.reorder`).
// Mutates `slots[]` order (TASK-1.2.4). Coalesces same-target reorders within one hierarchy drag,
// mirroring MoveBone: both the prior and the computed-after order are mementos, so undo and redo are
// bit-exact and a coalesced drag returns to the pre-drag order in one undo step.
export class ReorderSlotCommand implements Command {
  readonly kind = 'slot.reorder';
  readonly label = 'Reorder Slot';
  private before: readonly SlotId[] | undefined;
  private after: readonly SlotId[] | undefined;

  constructor(
    private readonly target: SlotId,
    private readonly toIndex: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined || this.after === undefined) {
      const order = ctx.mutate.slots().map((slot) => slot.id);
      if (!order.includes(this.target)) {
        throw new CommandTargetMissingError(this.kind, this.target);
      }
      this.before = order;
      this.after = moveToIndex(order, this.target, this.toIndex);
    }
    ctx.mutate.setSlotOrder(this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotOrder(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof ReorderSlotCommand && prev.target === this.target) {
      const merged = new ReorderSlotCommand(this.target, this.toIndex);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const reorderSlotSpec: CommandSpec = {
  kind: 'slot.reorder',
  // 'slotted' has two slots, so moving the first to the end is a real draw-order delta.
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const order = model.slots();
    if (order.length < 2) return null;
    const first = order[0];
    if (!first) return null;
    return { command: new ReorderSlotCommand(first.id, order.length - 1) };
  },
  assertApplied: (before, after) => {
    if (after.slotOrder.length !== before.slotOrder.length) {
      throw new Error('slot.reorder changed the slot count');
    }
    if (before.slotOrder.join(',') === after.slotOrder.join(',')) {
      throw new Error('slot.reorder produced no draw-order delta');
    }
    if ([...before.slotOrder].sort().join(',') !== [...after.slotOrder].sort().join(',')) {
      throw new Error('slot.reorder changed the slot set, not just the order');
    }
  },
};
