import { create } from 'zustand';

// Ephemeral mesh-edit selection (WP-2.1): which vertex of the edited mesh is selected while the mesh
// tool is active. NEVER undoable, NEVER serialized, and never read by a command (the document/editor
// wall): selecting a vertex is chrome; moving one is a command. The index is positional into the edited
// mesh's vertex array; the tool sets it explicitly after add/delete, and consumers guard the index
// against the CURRENT vertex count (an undo can shrink the mesh under a stale selection, which then
// simply renders as no selection rather than crashing).
interface MeshEditStore {
  readonly selectedVertex: number | null;
  selectVertex(index: number): void;
  clearVertex(): void;
}

export const useMeshEditStore = create<MeshEditStore>((set) => ({
  selectedVertex: null,
  selectVertex: (index) => set({ selectedVertex: index }),
  clearVertex: () => set({ selectedVertex: null }),
}));
