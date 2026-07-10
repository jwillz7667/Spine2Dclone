import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, PathError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { controlPointCount, recomputeLengths, requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Move one path control point (command-history catalog MovePathControlPoint, `path.moveControlPoint`;
// PP-D11). The drag runs inside an interaction group (beginInteraction/endInteraction); each pointer-move is
// one command, and consecutive moves of the SAME (slot, attachment, pointIndex) coalesce into one undo step
// keeping the gesture-start geometry as the single before memento. The arc-length `lengths` table is
// RECOMPUTED from the moved control points on every move (ADR-0011: authoring owns the table). `pointIndex`
// addresses a logical control point (anchor or handle); index 2i, 2i+1 are its x, y in the flat stream.
export class MovePathControlPointCommand implements Command {
  readonly kind = 'path.moveControlPoint';
  readonly label = 'Move Path Point';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly pointIndex: number,
    private readonly x: number,
    private readonly y: number,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      this.before = pathGeometryOf(path);
      if (this.pointIndex < 0 || this.pointIndex >= controlPointCount(this.before.vertices)) {
        throw new PathError('pointRange', `${this.slotId}/${this.name}#${this.pointIndex}`);
      }
      const vertices = this.before.vertices.slice();
      vertices[this.pointIndex * 2] = this.x;
      vertices[this.pointIndex * 2 + 1] = this.y;
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

  // Same slot + attachment + pointIndex only. The merged command keeps the ORIGINAL before (gesture start)
  // and the latest after, so one undo of a coalesced drag returns to the pre-drag geometry (command-history
  // Section 5.3). A different point index does not merge.
  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MovePathControlPointCommand &&
      prev.slotId === this.slotId &&
      prev.name === this.name &&
      prev.pointIndex === this.pointIndex
    ) {
      const merged = new MovePathControlPointCommand(
        this.slotId,
        this.name,
        this.pointIndex,
        this.x,
        this.y,
      );
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const movePathControlPointSpec: CommandSpec = {
  kind: 'path.moveControlPoint',
  // 'pathed' carries an unweighted path ('rail' on 'path_slot') with movable control points.
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      if (att && att.kind === 'path' && att.vertices.length >= 2) {
        return { command: new MovePathControlPointCommand(slot.id, att.name, 0, 5, 7) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let moved = false;
    for (const b of before.attachments) {
      if (b.kind !== 'path') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'path') continue;
      if (a.vertices.join(',') !== b.vertices.join(',')) {
        if (a.vertices.length !== b.vertices.length) {
          throw new Error('path.moveControlPoint changed the control-point count (it must not)');
        }
        moved = true;
      }
    }
    if (!moved) throw new Error('path.moveControlPoint produced no control-point delta');
  },
};
