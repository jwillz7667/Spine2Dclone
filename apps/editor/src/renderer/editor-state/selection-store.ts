import { create } from 'zustand';
import type { BoneId, SelectionHint } from '@marionette/document-core';
import { applyClick, applyMarquee } from './selection-ops';

// Ephemeral selection (handoff 8.2): which bones are selected, as an ORDERED set (index 0 is the PRIMARY,
// the gizmo pivot). NEVER undoable, NEVER serialized, keyed by internal BoneId so it survives renames and
// reorders. A command never reads or writes this store; History events drive it through applyHint (the
// per-phase SelectionHint) and prune (reconciliation after a command removes an entity). This is the
// editor-state side of the document/editor wall (LAW 1).
interface SelectionStore {
  readonly selectedBoneIds: readonly BoneId[];
  // Replace the selection outright (used by selection hints and programmatic selects).
  select(ids: readonly BoneId[]): void;
  // Resolve a viewport/hierarchy click: plain click selects just this bone; additive (shift/cmd) toggles.
  click(id: BoneId, additive: boolean): void;
  // Resolve a marquee release with the bones it covered; additive unions onto the current selection.
  marquee(ids: readonly BoneId[], additive: boolean): void;
  clear(): void;
  // Apply a command's per-phase selection hint (resolved by History). 'preserve'/undefined are no-ops.
  applyHint(hint: SelectionHint | undefined): void;
  // Drop any selected id that no longer resolves in the document (e.g. after undoing a CreateBone).
  prune(exists: (id: BoneId) => boolean): void;
}

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedBoneIds: [],
  select: (ids) => set({ selectedBoneIds: [...ids] }),
  click: (id, additive) =>
    set((state) => ({ selectedBoneIds: applyClick(state.selectedBoneIds, id, additive) })),
  marquee: (ids, additive) =>
    set((state) => ({ selectedBoneIds: applyMarquee(state.selectedBoneIds, ids, additive) })),
  clear: () => set({ selectedBoneIds: [] }),
  applyHint: (hint) =>
    set((state) => {
      if (hint === undefined || hint.kind === 'preserve') return state;
      if (hint.kind === 'clear') return { selectedBoneIds: [] };
      // This store tracks bone selection only; slot selection (EntityRef 'slot', added in WP-1.2) gets
      // its own store when the slot inspector lands (a separate follow-up), so non-bone hints are
      // filtered out here rather than coerced into the bone selection.
      const boneIds = hint.entities.flatMap((entity) =>
        entity.type === 'bone' ? [entity.id] : [],
      );
      return { selectedBoneIds: boneIds };
    }),
  prune: (exists) =>
    set((state) => {
      const kept = state.selectedBoneIds.filter((id) => exists(id));
      return kept.length === state.selectedBoneIds.length ? state : { selectedBoneIds: kept };
    }),
}));
