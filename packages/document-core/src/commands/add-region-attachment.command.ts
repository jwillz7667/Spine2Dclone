import type { RGBA } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { RegionAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import type { CommandSpec } from './spec';

// The region-attachment fields the caller supplies. The editor derives x/y/width/height from the atlas
// region (originalW/originalH/offsetX/offsetY) so trimmed sprites land pixel-correct; the command stores
// exactly what it is given (TASK-1.2.3). `path` references an AtlasRegion.name and may differ from the
// attachment NAME (which is the map key, format section 4.4).
export interface RegionAttachmentInit {
  readonly name: string;
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// Add a region attachment to a slot's default-skin map (command-history catalog AddRegionAttachment,
// `attach.region.add`). Never coalesces. The (SlotId, name) pair addresses it; undo removes exactly
// what was added. Resolution of `path` to an atlas region is the import-time validator's job
// (ATTACHMENT_REGION_MISSING); the command trusts the caller.
export class AddRegionAttachmentCommand implements Command {
  readonly kind = 'attach.region.add';
  readonly label = 'Add Region Attachment';
  private added = false;

  constructor(
    private readonly slotId: SlotId,
    private readonly init: RegionAttachmentInit,
  ) {}

  do(ctx: CommandContext): void {
    if (ctx.mutate.getSlot(this.slotId) === undefined) {
      throw new CommandTargetMissingError(this.kind, this.slotId);
    }
    const entity: RegionAttachmentEntity = {
      kind: 'region',
      name: this.init.name,
      path: this.init.path,
      x: this.init.x,
      y: this.init.y,
      rotation: this.init.rotation,
      scaleX: this.init.scaleX,
      scaleY: this.init.scaleY,
      width: this.init.width,
      height: this.init.height,
      color: { ...this.init.color },
    };
    ctx.mutate.addAttachment(this.slotId, entity);
    this.added = true;
  }

  undo(ctx: CommandContext): void {
    if (!this.added) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.removeAttachment(this.slotId, this.init.name);
  }
}

export const addRegionAttachmentSpec: CommandSpec = {
  kind: 'attach.region.add',
  // 'slotted' has a slot to attach to and an atlas region 'skin_hand' to reference.
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const slot = model.slots()[0];
    if (!slot) return null;
    return {
      command: new AddRegionAttachmentCommand(slot.id, {
        name: 'added_region',
        path: 'skin_hand',
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
    if (after.attachments.length !== before.attachments.length + 1) {
      throw new Error('attach.region.add expected one more attachment');
    }
    const added = after.attachments.find((att) => att.name === 'added_region');
    if (!added || added.kind !== 'region') {
      throw new Error('attach.region.add did not add the region attachment');
    }
    if (added.path !== 'skin_hand' || added.width !== 64) {
      throw new Error('attach.region.add did not store the fixture fields');
    }
  },
};
