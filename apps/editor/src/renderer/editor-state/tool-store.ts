import { create } from 'zustand';

// The active viewport tool (handoff 8.2): ephemeral editor state, never undoable, never serialized.
// Phase 0 has two tools: 'select' (click to select, drag the gizmo to move/rotate) and 'createBone'
// (drag to create a bone). New tools register their id here as later phases add them.
export type ToolId = 'select' | 'createBone';

interface ToolStore {
  readonly tool: ToolId;
  setTool(tool: ToolId): void;
}

export const useToolStore = create<ToolStore>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
}));
