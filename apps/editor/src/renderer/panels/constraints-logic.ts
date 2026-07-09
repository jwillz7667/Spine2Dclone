import type { ConstraintSelection } from '../editor-state/constraint-selection-store';

// Pure decision + reconciliation logic for the Constraints panel (PP-D10). The panel (constraints-panel.tsx)
// is thin glue over the IK/transform constraint commands plus the ephemeral constraint-selection store; every
// DECISION worth a test lives here with no React, no document access, and no side effects (the house
// convention, mirrors skins-logic.ts / inspector-logic.ts). The editor vitest env is `node`, so this is
// unit-tested and the .tsx is covered by typecheck + lint.

// Reconcile the EPHEMERAL constraint selection against the constraints the document currently defines (editor
// state, never part of a command; the document/editor wall, LAW 1). Returns the same selection when its
// constraint still resolves, else null so the panel clears a dangling selection (a constraint removed by an
// undo the panel did not drive). Kept generic over id string lists so it is trivially testable.
export function reconcileConstraintSelection(
  selection: ConstraintSelection | null,
  ikIds: readonly string[],
  transformIds: readonly string[],
): ConstraintSelection | null {
  if (selection === null) return null;
  const ids = selection.kind === 'ik' ? ikIds : transformIds;
  return ids.includes(selection.id) ? selection : null;
}

// One constraint in the combined solve-order view (PP-D10): its kind, id, display name, and current explicit
// order (undefined when the document uses the default order).
export interface OrderedConstraint {
  readonly kind: 'ik' | 'transform';
  readonly id: string;
  readonly name: string;
  readonly order: number | undefined;
}

// Compute the combined constraint solve order for display (ADR-0009 section 1.3). When ANY constraint carries
// an explicit `order`, the whole set is sorted by it (all-or-none dense permutation); otherwise the default
// order is used: all IK (in array order), then all transform. Pure and total so the panel renders a stable,
// rename-responsive ordered list. Ties (which a valid document never has) keep input order via a stable sort.
export function solveOrderView(
  ik: readonly OrderedConstraint[],
  transform: readonly OrderedConstraint[],
): OrderedConstraint[] {
  const combined = [...ik, ...transform];
  const anyExplicit = combined.some((c) => c.order !== undefined);
  if (!anyExplicit) return combined;
  return combined
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      const ao = a.c.order ?? a.index;
      const bo = b.c.order ?? b.index;
      return ao !== bo ? ao - bo : a.index - b.index;
    })
    .map((entry) => entry.c);
}

// Return the id list after moving the item at `index` by `delta` (-1 up, +1 down). Returns the SAME array
// reference when the move is out of bounds (top item up, bottom item down), so the panel can skip a no-op
// command. Pure list logic, trivially testable.
export function moveInOrder(
  ids: readonly string[],
  index: number,
  delta: number,
): readonly string[] {
  const target = index + delta;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

// Parse a softness field's raw string into a non-negative finite number, or null when it is empty, not a
// number, or negative (softness is a world-unit distance >= 0, ADR-0009 section 1.1; a negative value is the
// format's IK_SOFTNESS_RANGE). The panel drops a null (no command) so a mid-edit or invalid entry never
// authors a bad value.
export function parseSoftnessInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
