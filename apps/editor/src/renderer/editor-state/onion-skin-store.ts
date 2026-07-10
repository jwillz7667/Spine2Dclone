import { create } from 'zustand';
import { MAX_GHOSTS_PER_SIDE, type OnionSkinSettings } from '../viewport/onion-skin';

// Ephemeral onion-skinning settings (PP-D3): whether to ghost frames around the playhead and how many, how
// far apart, and how faint. NEVER undoable, NEVER serialized, never read by a command (the document/editor
// wall): onion skins are a viewport preview, not document data. The viewport reads these each frame to derive
// the ghost sample times (deriveOnionGhosts) and pools display objects to draw them.
interface OnionSkinStore extends OnionSkinSettings {
  toggle(): void;
  setEnabled(enabled: boolean): void;
  setBefore(before: number): void;
  setAfter(after: number): void;
  setFrameStep(frameStep: number): void;
  setOpacity(opacity: number): void;
  setFalloff(falloff: number): void;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_GHOSTS_PER_SIDE, Math.floor(n));
}

function clampUnit(n: number, min: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(1, Math.max(min, n));
}

export const useOnionSkinStore = create<OnionSkinStore>((set) => ({
  enabled: false,
  before: 2,
  after: 2,
  frameStep: 1,
  opacity: 0.35,
  falloff: 0.6,

  toggle: () => set((state) => ({ enabled: !state.enabled })),
  setEnabled: (enabled) => set({ enabled }),
  setBefore: (before) => set({ before: clampCount(before) }),
  setAfter: (after) => set({ after: clampCount(after) }),
  setFrameStep: (frameStep) => set({ frameStep: Math.max(1, Math.floor(frameStep) || 1) }),
  setOpacity: (opacity) => set({ opacity: clampUnit(opacity, 0.05) }),
  setFalloff: (falloff) => set({ falloff: clampUnit(falloff, 0.1) }),
}));
