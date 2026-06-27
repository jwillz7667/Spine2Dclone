import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

// Set a slot's setup-pose active attachment (command-history catalog SetActiveAttachment,
// `slot.activeAttachment`). `after` is an attachment NAME (which must resolve in the slot's map) or
// null. Never coalesces. Idempotent if set to the current value; memento-based, absolute before/after.
export class SetActiveAttachmentCommand implements Command {
  readonly kind = 'slot.activeAttachment';
  readonly label = 'Set Active Attachment';
  private before: string | null | undefined;

  constructor(
    private readonly target: SlotId,
    private readonly after: string | null,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = slot.attachment;
    }
    ctx.mutate.setActiveAttachment(this.target, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setActiveAttachment(this.target, this.before);
  }
}

export const setActiveAttachmentSpec: CommandSpec = {
  kind: 'slot.activeAttachment',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      // A real delta needs a value different from the current one that still resolves: clear a set
      // attachment to null, or activate an available one on a slot with none active.
      if (slot.attachment !== null) {
        return { command: new SetActiveAttachmentCommand(slot.id, null) };
      }
      const att = model.attachments(slot.id)[0];
      if (att) return { command: new SetActiveAttachmentCommand(slot.id, att.name) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    let changed = false;
    for (const b of before.slots) {
      const a = findSlotSnapshot(after, b.id);
      if (a && a.attachment !== b.attachment) changed = true;
    }
    if (!changed) throw new Error('slot.activeAttachment produced no active-attachment delta');
  },
};
