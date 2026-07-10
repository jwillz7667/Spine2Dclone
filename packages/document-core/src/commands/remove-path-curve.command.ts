import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, PathError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { curveCountOf, recomputeLengths, requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Remove the last cubic curve from a path spline (command-history catalog RemovePathCurve,
// `path.removeCurve`; PP-D11). The trailing three control points are dropped, keeping the control-point
// count valid for the openness; a path must keep at least one curve, so a single-curve path is rejected
// with PathError('minCurves') BEFORE any mutation. The arc-length table is recomputed. undo restores the
// full prior geometry.
export class RemovePathCurveCommand implements Command {
  readonly kind = 'path.removeCurve';
  readonly label = 'Remove Path Curve';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const before = pathGeometryOf(path);
      const curves = curveCountOf(before.vertices, before.closed);
      if (curves === undefined || curves <= 1) {
        throw new PathError('minCurves', `${this.slotId}/${this.name}`);
      }
      this.before = before;
      const vertices = before.vertices.slice(0, before.vertices.length - 6);
      this.after = {
        ...before,
        vertices,
        lengths: recomputeLengths(vertices, before.closed),
      };
    }
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.before);
  }
}

export const removePathCurveSpec: CommandSpec = {
  kind: 'path.removeCurve',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      // Need a path with at least two curves so removing one leaves a valid single-curve spline.
      if (att && att.kind === 'path' && curveCountOf(att.vertices, att.closed) === 2) {
        return { command: new RemovePathCurveCommand(slot.id, att.name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let shrank = false;
    for (const b of before.attachments) {
      if (b.kind !== 'path') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'path') continue;
      if (
        a.vertices.length === b.vertices.length - 6 &&
        a.lengths.length === b.lengths.length - 1
      ) {
        shrank = true;
      }
    }
    if (!shrank) throw new Error('path.removeCurve did not drop exactly one curve');
  },
};
