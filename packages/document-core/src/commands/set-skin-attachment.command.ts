import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { AttachmentEntity } from '../model/doc-state';
import type { SkinId, SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

// What was at the (slotId, name) address before the set, so undo restores it exactly: the prior attachment
// value, or null when the address was empty (the set then becomes an add, and undo removes it).
interface ReplacedAttachment {
  readonly prior: AttachmentEntity | null;
}

// Set (add or replace) an attachment on a NAMED skin at a (slotId, attachment-name) address (command-
// history catalog SetSkinAttachment, `skin.setAttachment`; WP-2.8). The skin must exist (notFound) and the
// slot must be in the document (slotMissing); both checks run BEFORE any mutation. The memento captures the
// prior attachment at the SAME (slotId, name) address (null when none), so undo either restores the prior
// value or removes the freshly-added one. Resolution of an attachment's atlas `path` is the import-time
// validator's job; the command trusts the caller. Never coalesces.
export class SetSkinAttachmentCommand implements Command {
  readonly kind = 'skin.setAttachment';
  readonly label = 'Set Skin Attachment';
  private before: ReplacedAttachment | undefined;

  constructor(
    private readonly skinId: SkinId,
    private readonly slotId: SlotId,
    private readonly entity: AttachmentEntity,
  ) {}

  do(ctx: CommandContext): void {
    const skin = ctx.mutate.getSkin(this.skinId);
    if (!skin) throw new SkinError('notFound', this.skinId);
    if (!ctx.mutate.getSlot(this.slotId)) throw new SkinError('slotMissing', this.slotId);
    if (this.before === undefined) {
      const prior = skin.attachments.get(this.slotId)?.get(this.entity.name) ?? null;
      this.before = { prior };
    }
    ctx.mutate.setSkinAttachment(this.skinId, this.slotId, this.entity);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    if (this.before.prior !== null) {
      ctx.mutate.setSkinAttachment(this.skinId, this.slotId, this.before.prior);
    } else {
      ctx.mutate.removeSkinAttachment(this.skinId, this.slotId, this.entity.name);
    }
  }
}

export const setSkinAttachmentSpec: CommandSpec = {
  kind: 'skin.setAttachment',
  // 'rigged' carries the named 'variant' skin and the 'mesh_slot' slot, so adding a new region attachment
  // is a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins()[0];
    const slot = model.slots().find((s) => s.name === 'mesh_slot');
    if (!skin || !slot) return null;
    if (skin.attachments.get(slot.id)?.get('extra') !== undefined) return null;
    return {
      command: new SetSkinAttachmentCommand(skin.id, slot.id, {
        kind: 'region',
        name: 'extra',
        path: 'skin_panel',
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
    };
  },
  assertApplied: (before, after) => {
    const id = before.skins[0]?.id;
    if (id === undefined) throw new Error('skin.setAttachment fixture seed had no named skins');
    const b = before.skins.find((s) => s.id === id);
    const a = after.skins.find((s) => s.id === id);
    if (!b || !a) throw new Error('skin.setAttachment target missing from snapshot');
    if (a.attachments.length !== b.attachments.length + 1) {
      throw new Error('skin.setAttachment did not add one attachment to the skin');
    }
  },
};
