import { create } from 'zustand';
import type { EventDefId } from '../document';

// Ephemeral event selection (Stage F1, PP-D9): which event definition the Events panel is editing and,
// equally, which event the dopesheet fires when the author adds an event key at the playhead. NEVER
// undoable, NEVER serialized, keyed by internal EventDefId so it survives renames. A command never reads or
// writes this store; selecting an event is editor state, not a document mutation (the document/editor wall,
// LAW 1). Mirrors slot-selection-store: the Events panel selects explicitly and clears a selection that no
// longer resolves in the model; event ids are minted monotonically and never reused, so a stale id can
// never alias a different event.
interface EventSelectionStore {
  readonly selectedEventId: EventDefId | null;
  selectEvent(id: EventDefId | null): void;
  clearEvent(): void;
}

export const useEventSelectionStore = create<EventSelectionStore>((set) => ({
  selectedEventId: null,
  selectEvent: (id) => set({ selectedEventId: id }),
  clearEvent: () => set({ selectedEventId: null }),
}));
