import { create } from 'zustand';

// The always-present base skin name (mirrors runtime-core DEFAULT_SKIN_NAME; the format validator rejects
// a document without it). Kept as a local literal so this store imports nothing from runtime-core.
export const DEFAULT_SKIN_NAME = 'default';

// Ephemeral active-skin PREVIEW (PP-D4): which skin the viewport renders. This is EDITOR state, never
// document state (the document/editor wall, LAW 1): switching the previewed costume is not a mutation, is
// never undoable, and is never serialized. It is the editor-side driver of runtime-core's SkinState via
// SkeletonView.setActiveSkin. Keyed by skin NAME (what the runtime consumes); the skins panel keeps it in
// sync with renames and resets it to 'default' when the previewed skin is deleted or undone away, and the
// viewport additionally validates the name against the rendered document so an unknown skin never throws.
interface SkinPreviewStore {
  readonly activeSkin: string;
  setActiveSkin(name: string): void;
  reset(): void;
}

export const useSkinPreviewStore = create<SkinPreviewStore>((set) => ({
  activeSkin: DEFAULT_SKIN_NAME,
  setActiveSkin: (name) => set({ activeSkin: name }),
  reset: () => set({ activeSkin: DEFAULT_SKIN_NAME }),
}));
