import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { recomputeLengths, requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Set a path spline's `closed` flag (command-history catalog SetPathClosed, `path.setClosed`; PP-D11).
// Openness changes the control-point count a given curve count implies (open 3C+1 vs closed 3C), so the
// command adjusts the vertex stream to stay valid while preserving the curve count: CLOSING drops the
// trailing end anchor (its incoming handles now feed the wrap curve back to the first anchor); OPENING
// appends an end anchor equal to the first anchor (the wrap point), so the geometry stays continuous. The
// arc-length table is recomputed. Setting the flag to its current value is a no-op. undo restores the full
// prior geometry.
export class SetPathClosedCommand implements Command {
  readonly kind = 'path.setClosed';
  readonly label = 'Set Path Closed';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly closed: boolean,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const before = pathGeometryOf(path);
      this.before = before;
      if (before.closed === this.closed) {
        this.after = before;
      } else {
        const v = before.vertices;
        const vertices = this.closed
          ? v.slice(0, v.length - 2) // close: drop the trailing end anchor
          : [...v, v[0] ?? 0, v[1] ?? 0]; // open: append an end anchor at the first anchor (the wrap point)
        this.after = {
          ...before,
          closed: this.closed,
          vertices,
          lengths: recomputeLengths(vertices, this.closed),
        };
      }
    }
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.before);
  }
}

export const setPathClosedSpec: CommandSpec = {
  kind: 'path.setClosed',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      if (att && att.kind === 'path') {
        // Flip to the opposite of the seed's current openness so the fixture always yields a delta.
        return { command: new SetPathClosedCommand(slot.id, att.name, !att.closed) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let toggled = false;
    for (const b of before.attachments) {
      if (b.kind !== 'path') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'path') continue;
      if (a.closed !== b.closed) toggled = true;
    }
    if (!toggled) throw new Error('path.setClosed did not change the closed flag');
  },
};
