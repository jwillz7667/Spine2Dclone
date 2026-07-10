import { create } from 'zustand';
import type { BoneSubtreeClip } from '@marionette/document-core';

// Ephemeral bone clipboard (PP-D7): the last COPIED bone subtree, held as a document-independent
// BoneSubtreeClip value. EDITOR state, never document state (the document/editor wall, LAW 1): a copy is
// not a mutation, is never undoable, and is never serialized. The clip carries no internal ids (parent
// links are indices within the clip), so it survives edits between copy and paste and could even outlive
// the source document; a paste turns it into fresh id-minted entities through PasteBoneSubtreeCommand. The
// hierarchy panel is the sole reader/writer.
interface BoneClipboardStore {
  readonly clip: BoneSubtreeClip | null;
  copy(clip: BoneSubtreeClip): void;
  clear(): void;
}

export const useBoneClipboardStore = create<BoneClipboardStore>((set) => ({
  clip: null,
  copy: (clip) => set({ clip }),
  clear: () => set({ clip: null }),
}));
