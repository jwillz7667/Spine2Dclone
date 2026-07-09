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
