import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { AttachmentEntity } from '../model/doc-state';
import type { SkinId, SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

// Remove an attachment from a NAMED skin at a (slotId, attachment-name) address (command-history catalog
// RemoveSkinAttachment, `skin.removeAttachment`; WP-2.8). The skin must exist and own that attachment;
// both are checked BEFORE any mutation (notFound, the detail carrying the full skin/slot/name address), so
// an invalid remove leaves no document change and no history entry. The memento stores the FULL attachment
// value, so undo restores it verbatim at the same address. Never coalesces.
export class RemoveSkinAttachmentCommand implements Command {
  readonly kind = 'skin.removeAttachment';
  readonly label = 'Remove Skin Attachment';
  private before: AttachmentEntity | undefined;

  constructor(
    private readonly skinId: SkinId,
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const skin = ctx.mutate.getSkin(this.skinId);
    if (!skin) throw new SkinError('notFound', this.skinId);
    const att = skin.attachments.get(this.slotId)?.get(this.name);
    if (att === undefined) {
      throw new SkinError('notFound', `${this.skinId}/${this.slotId}/${this.name}`);
    }
    if (this.before === undefined) this.before = att;
    ctx.mutate.removeSkinAttachment(this.skinId, this.slotId, this.name);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSkinAttachment(this.skinId, this.slotId, this.before);
  }
}

export const removeSkinAttachmentSpec: CommandSpec = {
  kind: 'skin.removeAttachment',
  // 'rigged' carries the named 'variant' skin with a region attachment 'alt' on 'mesh_slot', so removing
  // it is a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins()[0];
    if (!skin) return null;
    for (const [slotId, byName] of skin.attachments) {
      for (const name of byName.keys()) {
        return { command: new RemoveSkinAttachmentCommand(skin.id, slotId, name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const id = before.skins[0]?.id;
    if (id === undefined) throw new Error('skin.removeAttachment fixture seed had no named skins');
    const b = before.skins.find((s) => s.id === id);
    const a = after.skins.find((s) => s.id === id);
    if (!b || !a) throw new Error('skin.removeAttachment target missing from snapshot');
    if (a.attachments.length !== b.attachments.length - 1) {
      throw new Error('skin.removeAttachment did not remove one attachment from the skin');
    }
  },
};
