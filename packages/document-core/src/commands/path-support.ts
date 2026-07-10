import type { CommandContext } from '../command/command';
import { PathError } from '../command/errors';
import type { PathAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { computePathLengthsFromFlat, pathCurveCount } from '../paths';

// Shared guards and geometry defaults for the PP-D11 path attachment commands. The editable path is the
// UNWEIGHTED control-point case; every command recomputes the cumulative arc-length table from the control
// points via the pure paths/ module (ADR-0011 assigns lengths computation to authoring), so nothing here
// stores a table without recomputing it.

// Require an existing editable PATH attachment at (slotId, name); otherwise a typed PathError('notFound')
// (the attachment is absent or is a region/mesh/linked/preserved attachment, including a weighted path,
// which stays preserved). The returned entity is a frozen value copy (getAttachment hand-out), so reading
// its arrays for a memento is safe.
export function requirePath(
  ctx: CommandContext,
  slotId: SlotId,
  name: string,
): PathAttachmentEntity {
  const att = ctx.mutate.getAttachment(slotId, name);
  if (att === undefined || att.kind !== 'path') {
    throw new PathError('notFound', `${slotId}/${name}`);
  }
  return att;
}

// The control-point stream of a fresh, default path: a two-curve OPEN spline laid out along the x axis with
// its handles at the curve thirds, so it is a straight, evenly-spaced rail the author then bends. Anchors at
// x = 0, 90, 180; handles between them. V = 7 = 3 * 2 + 1 (two open curves).
export function defaultOpenPathVertices(): number[] {
  return [0, 0, 30, 0, 60, 0, 90, 0, 120, 0, 150, 0, 180, 0];
}

// The cumulative arc-length table for a control-point stream and openness, recomputed from the geometry.
// A thin re-export so the command files share one import site.
export function recomputeLengths(vertices: readonly number[], closed: boolean): number[] {
  return computePathLengthsFromFlat(vertices, closed);
}

// The number of logical control points in a flat unweighted stream.
export function controlPointCount(vertices: readonly number[]): number {
  return vertices.length / 2;
}

// The curve count of a control-point stream at the given openness, or undefined when the count fits no
// cubic spline. A re-export so the command files share one import site.
export function curveCountOf(vertices: readonly number[], closed: boolean): number | undefined {
  return pathCurveCount(controlPointCount(vertices), closed);
}
