import { create } from 'zustand';
import type { SlotId } from '@marionette/document-core';

// Ephemeral slot selection (handoff 8.2): which slot the inspector is editing. NEVER undoable, NEVER
// serialized, keyed by internal SlotId so it survives renames and draw-order reorders. A command never
// reads or writes this store; selecting a slot is editor state, not a document mutation (the document/
// editor wall, LAW 1). This is the slot-side counterpart to the bone selection-store; it was deferred
// from WP-1.1 (see selection-store.ts, which filters out non-bone hints) and lands with WP-1.2's
// inspector. The bone selection-store stays the authority for bones; this store owns slots only.
//
// NOTE: unlike the bone store, the DocumentHost reconciler does not drive this store (it predates the
// inspector and only knows the bone store), so there is no applyHint/prune here. The inspector instead
// (a) selects the new slot explicitly after CreateSlot, (b) reconciles after its own DeleteSlot, and
// (c) treats a selectedSlotId that no longer resolves in the model as no selection and clears it. Slot
// ids are minted monotonically and never reused, so a stale id can never alias a different slot.
interface SlotSelectionStore {
  readonly selectedSlotId: SlotId | null;
  selectSlot(id: SlotId | null): void;
  clearSlot(): void;
}

export const useSlotSelectionStore = create<SlotSelectionStore>((set) => ({
  selectedSlotId: null,
  selectSlot: (id) => set({ selectedSlotId: id }),
  clearSlot: () => set({ selectedSlotId: null }),
}));
