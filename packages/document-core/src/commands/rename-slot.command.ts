import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

// Rename a slot (command-history catalog RenameSlot, `slot.rename`, AMEND-CH-2). A single-field change
// with zero cascade because identity is the internal id, not the name (Section 2, D2). Name uniqueness
// is the validator's SLOT_NAME_DUPLICATE at export, NOT a command guard. Never coalesces. Memento-based.
export class RenameSlotCommand implements Command {
  readonly kind = 'slot.rename';
  readonly label = 'Rename Slot';
  private before: string | undefined;

  constructor(
    private readonly target: SlotId,
    private readonly after: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = slot.name;
    }
    ctx.mutate.patchSlot(this.target, { name: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchSlot(this.target, { name: this.before });
  }
}

export const renameSlotSpec: CommandSpec = {
  kind: 'slot.rename',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const target = model.slots()[0];
    if (!target) return null;
    return { command: new RenameSlotCommand(target.id, `${target.name}_renamed`) };
  },
  assertApplied: (before, after) => {
    const id = before.slotOrder[0];
    if (id === undefined) throw new Error('slot.rename fixture seed had no slots');
    const b = findSlotSnapshot(before, id);
    const a = findSlotSnapshot(after, id);
    if (!b || !a) throw new Error('slot.rename target missing from snapshot');
    if (a.name === b.name) throw new Error('slot.rename produced no name delta');
    if (a.bone !== b.bone || a.blendMode !== b.blendMode) {
      throw new Error('slot.rename changed a field outside the name');
    }
  },
};
