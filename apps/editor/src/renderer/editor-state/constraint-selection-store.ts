import { create } from 'zustand';

// The currently EDITED constraint in the Constraints panel (PP-D10, extended for path by PP-D11). IK,
// transform, and path constraints share one name namespace (ADR-0004/ADR-0011) but distinct id brands, so the
// selection is tagged by kind. Stored as the raw id string (all brands are strings) plus the kind, so
// reconciliation compares against the model's id lists.
export type ConstraintSelection =
  | { readonly kind: 'ik'; readonly id: string }
  | { readonly kind: 'transform'; readonly id: string }
  | { readonly kind: 'path'; readonly id: string };

// Ephemeral constraint selection: which constraint the Constraints panel is editing. EDITOR state, never
// document state (the document/editor wall, LAW 1): selecting a constraint is not a mutation, is never
// undoable, and is never serialized. The panel reconciles it (drops a selection whose constraint an undo
// removed) via the pure reconciler in constraints-logic.ts.
interface ConstraintSelectionStore {
  readonly selection: ConstraintSelection | null;
  select(selection: ConstraintSelection | null): void;
}

export const useConstraintSelectionStore = create<ConstraintSelectionStore>((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
}));
