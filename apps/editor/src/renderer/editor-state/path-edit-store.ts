import { create } from 'zustand';

// Ephemeral path-edit selection (PP-D11): which control point of the edited path attachment is selected
// while the path tool is active. NEVER undoable, NEVER serialized, and never read by a command (the
// document/editor wall): selecting a control point is chrome; moving one is a command. The index is the
// LOGICAL control-point index (an anchor or a Bezier handle), matching MovePathControlPoint's pointIndex;
// the tool sets it explicitly after a hit or an add, and consumers guard the index against the CURRENT
// control-point count (an undo can shrink the spline under a stale selection, which then simply renders as
// no selection rather than crashing), mirroring the mesh-edit store.
interface PathEditStore {
  readonly selectedPoint: number | null;
  selectPoint(index: number): void;
  clearPoint(): void;
}

export const usePathEditStore = create<PathEditStore>((set) => ({
  selectedPoint: null,
  selectPoint: (index) => set({ selectedPoint: index }),
  clearPoint: () => set({ selectedPoint: null }),
}));
