import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, PathError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { controlPointCount, curveCountOf, recomputeLengths, requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Delete one ANCHOR control point from a path spline, collapsing the curve it bounds (command-history catalog
// DeletePathControlPoint, `path.deleteControlPoint`; PP-D11 Lane D remainder). A Bezier chain lays its control
// points out anchor, out-handle, in-handle, anchor, ... so anchors sit at logical indices 0, 3, 6, ...;
// deleting an anchor removes it together with its two flanking handles (three control points, six numbers),
// dropping the curve count by one. `pointIndex` MUST be an anchor (index % 3 === 0), else PathError('pointRange');
// deleting an anchor is only meaningful on a handle-bounded curve. A path must keep at least one curve, so a
// single-curve path is rejected with PathError('minCurves') BEFORE any mutation. The arc-length table is
// recomputed. undo restores the full prior geometry. Handles both open (3C+1 control points) and closed (3C,
// cyclic) splines. NOT coalescing (a delete is a discrete edit).
export class DeletePathControlPointCommand implements Command {
  readonly kind = 'path.deleteControlPoint';
  readonly label = 'Delete Path Point';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly pointIndex: number,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const before = pathGeometryOf(path);
      const cp = controlPointCount(before.vertices);
      // The index must be a real anchor (multiple of 3, in range); a handle or out-of-range index is a range
      // fault. Deleting an anchor collapses a curve, so a path with only one curve cannot lose it.
      if (this.pointIndex < 0 || this.pointIndex >= cp || this.pointIndex % 3 !== 0) {
        throw new PathError('pointRange', `${this.slotId}/${this.name}#${this.pointIndex}`);
      }
      const curves = curveCountOf(before.vertices, before.closed);
      if (curves === undefined || curves <= 1) {
        throw new PathError('minCurves', `${this.slotId}/${this.name}`);
      }
      const remove = anchorTripleIndices(this.pointIndex, cp, before.closed, curves);
      const removeSet = new Set(remove);
      const vertices: number[] = [];
      for (let i = 0; i < cp; i += 1) {
        if (removeSet.has(i)) continue;
        vertices.push(before.vertices[i * 2]!, before.vertices[i * 2 + 1]!);
      }
      this.before = before;
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

// The three control-point indices removed when deleting the anchor at `pointIndex`: the anchor plus its two
// flanking handles. For an OPEN spline the endpoints have a handle on only one side, so the leading/trailing
// triple is removed instead; interior anchors and every CLOSED anchor drop the cyclic {a-1, a, a+1} triple.
function anchorTripleIndices(
  pointIndex: number,
  cp: number,
  closed: boolean,
  curves: number,
): readonly number[] {
  const anchorCount = closed ? curves : curves + 1;
  const anchorIndex = pointIndex / 3;
  if (!closed && anchorIndex === 0) return [0, 1, 2];
  if (!closed && anchorIndex === anchorCount - 1) return [cp - 3, cp - 2, cp - 1];
  return [(pointIndex - 1 + cp) % cp, pointIndex, (pointIndex + 1) % cp];
}

export const deletePathControlPointSpec: CommandSpec = {
  kind: 'path.deleteControlPoint',
  // 'pathed' carries an unweighted OPEN path ('rail') with two curves, so deleting an anchor leaves a valid
  // single-curve spline (the minimum the format allows).
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      if (att && att.kind === 'path' && curveCountOf(att.vertices, att.closed) === 2) {
        // Delete the FIRST anchor (index 0), dropping the leading curve.
        return { command: new DeletePathControlPointCommand(slot.id, att.name, 0) };
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
    if (!shrank) throw new Error('path.deleteControlPoint did not drop exactly one anchor + curve');
  },
};
