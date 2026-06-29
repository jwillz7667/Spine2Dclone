import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { DeformKeyframeEntity, SkinEntity } from '../model/doc-state';
import type { AnimationId, SkinId, SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

// One captured deform track keyed to the deleted skin (an animation's deform frames for one (slot,
// attachment) under this skin), so the cascade restores every track the skin owned across all animations.
interface RemovedDeformTrack {
  readonly animId: AnimationId;
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly frames: readonly DeformKeyframeEntity[];
}

interface RemovedSkin {
  readonly entity: SkinEntity;
  readonly index: number; // original skinOrder index, for exact restore
  readonly deformTracks: readonly RemovedDeformTrack[];
}

// Delete a NAMED skin, cascading every animation's deform timeline keyed to it (command-history catalog
// DeleteSkin, `skin.delete`; WP-2.8). Deform offsets are keyed per skin (DeformSkinKey), so a deleted skin
// would leave dangling deform tracks; this is a SINGLE command with a SET memento (the removed skin with
// its skinOrder index, plus the removed deform tracks), NOT a composite, so the whole cascade is ONE undo
// step. The 'default' skin is implicit and can never reach here (it is not a SkinEntity, TASK-2.8.1). Never
// coalesces. undo re-inserts the skin at its original index and restores each deform track under its id.
export class DeleteSkinCommand implements Command {
  readonly kind = 'skin.delete';
  readonly label = 'Delete Skin';
  private before: RemovedSkin | undefined;

  constructor(private readonly id: SkinId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const list = ctx.mutate.skins();
      const index = list.findIndex((s) => s.id === this.id);
      if (index < 0) throw new SkinError('notFound', this.id);
      const entity = list[index]!;
      const deformTracks: RemovedDeformTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        const bySlot = anim.deform.get(this.id);
        if (!bySlot) continue;
        for (const [slotId, byName] of bySlot) {
          for (const [attachmentName, frames] of byName) {
            deformTracks.push({ animId: anim.id, slotId, attachmentName, frames });
          }
        }
      }
      this.before = { entity, index, deformTracks };
    }
    // Prune the deform tracks first, then remove the skin, so each removal is independent.
    for (const d of this.before.deformTracks) {
      ctx.mutate.setDeformChannel(d.animId, this.id, d.slotId, d.attachmentName, []);
    }
    ctx.mutate.removeSkin(this.id);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.insertSkin(this.before.entity, this.before.index);
    // The skinKey is this.id (the SkinId), the deform dimension the restored tracks were keyed under.
    for (const d of this.before.deformTracks) {
      ctx.mutate.setDeformChannel(d.animId, this.id, d.slotId, d.attachmentName, d.frames);
    }
  }
}

export const deleteSkinSpec: CommandSpec = {
  kind: 'skin.delete',
  // 'rigged' carries the named 'variant' skin (its deform timeline is on the 'default' skin, so this seed
  // has no deform to cascade, but the command handles the general case).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins()[0];
    if (!skin) return null;
    return { command: new DeleteSkinCommand(skin.id) };
  },
  assertApplied: (before, after) => {
    if (after.skins.length !== before.skins.length - 1) {
      throw new Error('skin.delete did not remove exactly one named skin');
    }
  },
};
