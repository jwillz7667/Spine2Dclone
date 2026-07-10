import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makePathAttachment } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { defaultOpenPathVertices, recomputeLengths } from './path-support';
import type { CommandSpec } from './spec';

// The optional overrides for a new path attachment. When `vertices` is omitted the command lays down the
// default two-curve OPEN rail (defaultOpenPathVertices); the arc-length `lengths` table is always recomputed
// from the control points, never supplied by the caller (authoring owns it, ADR-0011).
export interface PathAttachmentInit {
  readonly closed?: boolean;
  readonly constantSpeed?: boolean;
  readonly vertices?: readonly number[];
}

// Add a path attachment to a slot's default-skin map (command-history catalog AddPathAttachment,
// `attach.path.add`; PP-D11). The default is a two-curve open spline; the arc-length table is computed from
// the control points at construction. Never coalesces. The (SlotId, name) pair addresses it; undo removes
// exactly what was added. The editable path is UNWEIGHTED (no `bones` manifest), the only case the command
// authors.
export class CreatePathAttachmentCommand implements Command {
  readonly kind = 'attach.path.add';
  readonly label = 'Add Path Attachment';
  private added = false;

  private readonly closed: boolean;
  private readonly constantSpeed: boolean;
  private readonly vertices: readonly number[];

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    init: PathAttachmentInit = {},
  ) {
    this.closed = init.closed ?? false;
    this.constantSpeed = init.constantSpeed ?? true;
    this.vertices = init.vertices ?? defaultOpenPathVertices();
  }

  do(ctx: CommandContext): void {
    if (ctx.mutate.getSlot(this.slotId) === undefined) {
      throw new CommandTargetMissingError(this.kind, this.slotId);
    }
    const entity = makePathAttachment({
      name: this.name,
      closed: this.closed,
      constantSpeed: this.constantSpeed,
      lengths: recomputeLengths(this.vertices, this.closed),
      vertices: this.vertices,
    });
    ctx.mutate.addAttachment(this.slotId, entity);
    this.added = true;
  }

  undo(ctx: CommandContext): void {
    if (!this.added) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.removeAttachment(this.slotId, this.name);
  }
}

export const createPathAttachmentSpec: CommandSpec = {
  kind: 'attach.path.add',
  // 'slotted' has a slot to attach to; the path attachment references no atlas region (it renders no pixels).
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const slot = model.slots()[0];
    if (!slot) return null;
    if (model.attachments(slot.id).some((a) => a.name === 'rail_new')) return null;
    return { command: new CreatePathAttachmentCommand(slot.id, 'rail_new') };
  },
  assertApplied: (before, after) => {
    if (after.attachments.length !== before.attachments.length + 1) {
      throw new Error('attach.path.add expected one more attachment');
    }
    const added = after.attachments.find((att) => att.name === 'rail_new');
    if (!added || added.kind !== 'path') {
      throw new Error('attach.path.add did not add the path attachment');
    }
    if (added.lengths.length !== 2 || added.vertices.length !== 14) {
      throw new Error('attach.path.add did not lay down the default two-curve open path');
    }
  },
};
