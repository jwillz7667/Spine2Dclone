import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// The placement fields of a region attachment (TASK-1.2.2 / AMEND-CH-2). One logical channel: the
// authored region placement and size.
export interface RegionTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
}

// Set a region attachment's placement/size (command-history catalog SetRegionAttachmentTransform,
// `attach.region.transform`). A region attachment's placement is a document field, so LAW 2 requires a
// command. Coalesces same-target edits within one inspector/gizmo session (mirrors MoveBone): `before`
// is captured on first do and `after` is the absolute target, so undo is bit-exact and a coalesced drag
// returns to the pre-drag transform in one undo step.
export class SetRegionAttachmentTransformCommand implements Command {
  readonly kind = 'attach.region.transform';
  readonly label = 'Set Attachment Transform';
  private before: RegionTransform | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly after: RegionTransform,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const att = ctx.mutate.getAttachment(this.slotId, this.name);
      if (!att || att.kind !== 'region') {
        throw new CommandTargetMissingError(this.kind, `${this.slotId}/${this.name}`);
      }
      this.before = {
        x: att.x,
        y: att.y,
        rotation: att.rotation,
        scaleX: att.scaleX,
        scaleY: att.scaleY,
        width: att.width,
        height: att.height,
      };
    }
    ctx.mutate.patchAttachment(this.slotId, this.name, { ...this.after });
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchAttachment(this.slotId, this.name, { ...this.before });
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetRegionAttachmentTransformCommand &&
      prev.slotId === this.slotId &&
      prev.name === this.name
    ) {
      const merged = new SetRegionAttachmentTransformCommand(this.slotId, this.name, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setRegionAttachmentTransformSpec: CommandSpec = {
  kind: 'attach.region.transform',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'region');
      if (att && att.kind === 'region') {
        return {
          command: new SetRegionAttachmentTransformCommand(slot.id, att.name, {
            x: att.x + 12,
            y: att.y - 7,
            rotation: att.rotation + 30,
            scaleX: att.scaleX,
            scaleY: att.scaleY,
            width: att.width,
            height: att.height,
          }),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let changed = false;
    for (const b of before.attachments) {
      if (b.kind !== 'region') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'region' && (a.x !== b.x || a.rotation !== b.rotation)) changed = true;
    }
    if (!changed) throw new Error('attach.region.transform produced no transform delta');
  },
};
