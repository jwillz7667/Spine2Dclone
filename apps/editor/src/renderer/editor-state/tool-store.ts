import { create } from 'zustand';

// The active viewport tool (handoff 8.2): ephemeral editor state, never undoable, never serialized.
// 'select' (click to select, drag the gizmo to move/rotate), 'createBone' (drag to create a bone),
// 'mesh' (WP-2.1: edit the selected slot's mesh vertices), and 'weights' (WP-2.4: paint the active bone's
// weight onto the selected slot's weighted mesh). New tools register their id here.
export type ToolId = 'select' | 'createBone' | 'mesh' | 'weights';

interface ToolStore {
  readonly tool: ToolId;
  setTool(tool: ToolId): void;
}

export const useToolStore = create<ToolStore>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
}));
