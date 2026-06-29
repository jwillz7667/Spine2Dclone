import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { DeformKeyframeEntity, DeformSkinKey } from '../model/doc-state';
import type { AnimationId, SlotId } from '../model/ids';
import { type CommandSpec } from './spec';

// One captured deform track for the cleared (slot, attachment), keyed to its owning animation and skin
// dimension, so undo restores every track that was removed across all animations and all skins.
interface CapturedDeformTrack {
  readonly animId: AnimationId;
  readonly skinKey: DeformSkinKey;
  readonly frames: readonly DeformKeyframeEntity[];
}

// Remove ALL deform keyframes for one (slot, attachment) across EVERY animation and EVERY skin key
// (command-history catalog ClearAttachmentDeform, `deform.clearAttachment`; WP-2.9). This is the prerequisite
// the topology-lock policy requires before a mesh can be re-topologized (an add/delete/auto vertex edit is
// blocked while deform keyframes exist, because the offset arrays are indexed by vertex position;
// MeshTopologyLockedError 'deformed'). It is a SINGLE command with a SET memento (every removed track with
// its animation and skin dimension), NOT a composite, so the whole clear is ONE undo step. Never coalesces.
export class ClearAttachmentDeformCommand implements Command {
  readonly kind = 'deform.clearAttachment';
  readonly label = 'Clear Attachment Deform';
  private before: readonly CapturedDeformTrack[] | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly attachmentName: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const captured: CapturedDeformTrack[] = [];
      for (const anim of ctx.mutate.animations()) {
        for (const [skinKey, bySlot] of anim.deform) {
          const frames = bySlot.get(this.slotId)?.get(this.attachmentName);
          if (frames && frames.length > 0) {
            captured.push({ animId: anim.id, skinKey, frames });
          }
        }
      }
      this.before = captured;
    }
    for (const c of this.before) {
      ctx.mutate.setDeformChannel(c.animId, c.skinKey, this.slotId, this.attachmentName, []);
    }
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    for (const c of this.before) {
      ctx.mutate.setDeformChannel(c.animId, c.skinKey, this.slotId, this.attachmentName, c.frames);
    }
  }
}

export const clearAttachmentDeformSpec: CommandSpec = {
  kind: 'deform.clearAttachment',
  // 'rigged' carries a deform timeline on the default skin's 'panel' mesh on 'mesh_slot'; clearing it removes
  // that track across every animation, a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const slot = model.slots().find((s) => s.name === 'mesh_slot');
    if (!slot) return null;
    // Only applicable when some animation actually carries deform for this (slot, attachment).
    const attachmentName = 'panel';
    const hasDeform = model.animations().some((anim) => {
      for (const [, bySlot] of anim.deform) {
        const frames = bySlot.get(slot.id)?.get(attachmentName);
        if (frames && frames.length > 0) return true;
      }
      return false;
    });
    if (!hasDeform) return null;
    return { command: new ClearAttachmentDeformCommand(slot.id, attachmentName) };
  },
  assertApplied: (before, after) => {
    const hasPanelDeform = (snapshot: typeof before): boolean =>
      snapshot.animations.some((anim) =>
        anim.deform.some((track) => track.attachment === 'panel' && track.keyframes.length > 0),
      );
    if (!hasPanelDeform(before)) {
      throw new Error('deform.clearAttachment fixture seed had no deform to clear');
    }
    if (hasPanelDeform(after)) {
      throw new Error('deform.clearAttachment left deform keyframes for the attachment');
    }
  },
};
