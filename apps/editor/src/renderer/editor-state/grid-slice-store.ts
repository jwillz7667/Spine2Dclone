import { create } from 'zustand';

// Whether the grid-slice dialog is open (PP-D5): ephemeral editor state, never undoable, never serialized
// (the editor/document wall). Both the Assets panel button and the File > Slice Sprite Sheet menu item flip
// it open through the same store, so the two entry points drive one dialog. The dialog reads the flag,
// collects the sheet image and grid parameters, runs the grid import, and closes itself.
interface GridSliceStore {
  readonly open: boolean;
  show(): void;
  dismiss(): void;
}

export const useGridSliceStore = create<GridSliceStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  dismiss: () => set({ open: false }),
}));
