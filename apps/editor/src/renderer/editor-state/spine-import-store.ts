import { create } from 'zustand';
import type { SpineImportError, SpineImportWarning } from '../../shared';

// The last Spine-import report to surface in the results dialog (PP-A5): ephemeral editor state, never
// undoable, never serialized (the editor/document wall). The Import Spine Project action writes it after a
// converted document has already loaded through the normal validated load flow; the results component
// reads it to list each lossy-conversion warning (and, on a failed import, each typed error) so nothing is
// dropped silently. `open` is false until the first import and after the user dismisses the dialog.

export interface SpineImportReport {
  readonly status: 'imported' | 'failed';
  // The imported document name on success; null when the import failed (no document was produced).
  readonly name: string | null;
  readonly warnings: readonly SpineImportWarning[];
  readonly errors: readonly SpineImportError[];
}

interface SpineImportStore {
  readonly open: boolean;
  readonly report: SpineImportReport | null;
  show(report: SpineImportReport): void;
  dismiss(): void;
}

export const useSpineImportStore = create<SpineImportStore>((set) => ({
  open: false,
  report: null,
  show: (report) => set({ open: true, report }),
  dismiss: () => set({ open: false }),
}));
