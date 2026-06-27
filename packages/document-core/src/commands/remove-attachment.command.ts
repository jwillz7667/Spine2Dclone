import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

interface RemovedAttachment {
  readonly entity: AttachmentEntity; // the full attachment value, restored verbatim on undo
  readonly priorActive: string | null; // the slot's setup attachment before removal
}

// Remove an attachment from a slot (command-history catalog RemoveAttachment, `attach.remove`). The
// memento stores the FULL attachment value (region or preserved), so undo restores it exactly. If the
// removed attachment was the slot's setup active attachment, the slot is cleared to null (otherwise the
// setup attachment would dangle, breaking the invariant and SLOT_ATTACHMENT_MISSING at export); undo
// restores the prior active attachment too. Never coalesces.
export class RemoveAttachmentCommand implements Command {
  readonly kind = 'attach.remove';
  readonly label = 'Remove Attachment';
  private removed: RemovedAttachment | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.removed) {
      const slot = ctx.mutate.getSlot(this.slotId);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.slotId);
      const entity = ctx.mutate.getAttachment(this.slotId, this.name);
      if (!entity) throw new CommandTargetMissingError(this.kind, `${this.slotId}/${this.name}`);
      this.removed = { entity, priorActive: slot.attachment };
    }
    ctx.mutate.removeAttachment(this.slotId, this.name);
    if (this.removed.priorActive === this.name) {
      ctx.mutate.setActiveAttachment(this.slotId, null);
    }
  }

  undo(ctx: CommandContext): void {
    if (!this.removed) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.addAttachment(this.slotId, this.removed.entity);
    ctx.mutate.setActiveAttachment(this.slotId, this.removed.priorActive);
  }
}

export const removeAttachmentSpec: CommandSpec = {
  kind: 'attach.remove',
  // 'slotted' slot 'body' owns the 'body' region attachment, which is also its active attachment, so
  // removal exercises the active-attachment clear.
  representativeSeedId: 'slotted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id)[0];
      if (att) return { command: new RemoveAttachmentCommand(slot.id, att.name) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    if (after.attachments.length !== before.attachments.length - 1) {
      throw new Error('attach.remove expected one fewer attachment');
    }
  },
};
