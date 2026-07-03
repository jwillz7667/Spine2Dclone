import { create } from 'zustand';

// The active viewport tool (handoff 8.2): ephemeral editor state, never undoable, never serialized.
// 'select' (click to select, drag the gizmo to move/rotate), 'createBone' (drag to create a bone), and
// 'mesh' (WP-2.1: edit the selected slot's mesh vertices). New tools register their id here.
export type ToolId = 'select' | 'createBone' | 'mesh';

interface ToolStore {
  readonly tool: ToolId;
  setTool(tool: ToolId): void;
}

export const useToolStore = create<ToolStore>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
}));
