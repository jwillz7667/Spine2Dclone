import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AttachmentEntity, SlotEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

interface RemovedSlot {
  readonly slot: SlotEntity;
  readonly index: number; // original slotOrder index, for exact restore
  readonly attachments: readonly AttachmentEntity[];
}

// Delete a slot and cascade-delete its attachments (command-history catalog DeleteSlot, `slot.delete`).
// A SINGLE command with a SET memento (the slot value, its draw-order index, and every attachment it
// owned), NOT a CompositeCommand, so the whole removal is ONE undo step. Its slot timelines cascade
// later once WP-1.5 lands (the WP-1.2 slice of the cascade memento family, TASK-1.1.2). Never
// coalesces. selectionHint clears on execute/redo and reselects the restored slot on undo.
export class DeleteSlotCommand implements Command {
  readonly kind = 'slot.delete';
  readonly label = 'Delete Slot';
  private removed: RemovedSlot | undefined;

  constructor(private readonly target: SlotId) {}

  do(ctx: CommandContext): void {
    if (!this.removed) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      const index = ctx.mutate.slots().findIndex((s) => s.id === this.target);
      this.removed = { slot, index, attachments: ctx.mutate.attachments(this.target) };
    }
    for (const att of this.removed.attachments) ctx.mutate.removeAttachment(this.target, att.name);
    ctx.mutate.removeSlot(this.target);
  }

  undo(ctx: CommandContext): void {
    if (!this.removed) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertSlot(this.removed.slot, this.removed.index);
    for (const att of this.removed.attachments) ctx.mutate.addAttachment(this.target, att);
  }

  selectionHint(phase: HistoryPhase): SelectionHint {
    if (phase === 'undo') return { kind: 'select', entities: [{ type: 'slot', id: this.target }] };
    return { kind: 'clear' };
  }
}

export const deleteSlotSpec: CommandSpec = {
  kind: 'slot.delete',
  // 'slotted' carries a slot that owns a region attachment, so delete exercises the cascade.
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const slot = model.slots()[0];
    if (!slot) return null;
    return { command: new DeleteSlotCommand(slot.id) };
  },
  assertApplied: (before, after) => {
    const targetId = before.slotOrder[0];
    if (targetId === undefined) throw new Error('slot.delete fixture seed had no slots');
    if (after.slots.some((slot) => slot.id === targetId)) {
      throw new Error('slot.delete did not remove the target slot');
    }
    if (after.slots.length >= before.slots.length) {
      throw new Error('slot.delete expected fewer slots');
    }
    if (after.attachments.some((att) => att.slotId === targetId)) {
      throw new Error('slot.delete did not cascade the slot attachments');
    }
  },
};
