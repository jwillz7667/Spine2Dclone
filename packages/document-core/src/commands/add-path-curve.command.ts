import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { recomputeLengths, requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// The straight step (in local units) each appended curve extends by, laid out as two handles then a new
// anchor (or, for a closed spline, an anchor then two handles), so a freshly-added curve is a straight
// continuation the author then bends.
const CURVE_STEP = 30;

// Append one cubic curve to the end of a path spline (command-history catalog AddPathCurve,
// `path.addCurve`; PP-D11). Three control points are appended (two handles plus an anchor), keeping the
// control-point count valid for the spline's openness (open 3C+1 -> 3(C+1)+1; closed 3C -> 3(C+1)); the
// arc-length table is recomputed. Never coalesces. undo restores the full prior geometry.
export class AddPathCurveCommand implements Command {
  readonly kind = 'path.addCurve';
  readonly label = 'Add Path Curve';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      this.before = pathGeometryOf(path);
      const v = this.before.vertices;
      const px = v[v.length - 2] ?? 0;
      const py = v[v.length - 1] ?? 0;
      const vertices = [
        ...v,
        px + CURVE_STEP,
        py,
        px + 2 * CURVE_STEP,
        py,
        px + 3 * CURVE_STEP,
        py,
      ];
      this.after = {
        ...this.before,
        vertices,
        lengths: recomputeLengths(vertices, this.before.closed),
      };
    }
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.before);
  }
}

export const addPathCurveSpec: CommandSpec = {
  kind: 'path.addCurve',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      if (att && att.kind === 'path') {
        return { command: new AddPathCurveCommand(slot.id, att.name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let grew = false;
    for (const b of before.attachments) {
      if (b.kind !== 'path') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'path') continue;
      if (
        a.vertices.length === b.vertices.length + 6 &&
        a.lengths.length === b.lengths.length + 1
      ) {
        grew = true;
      }
    }
    if (!grew) throw new Error('path.addCurve did not append exactly one curve');
  },
};
