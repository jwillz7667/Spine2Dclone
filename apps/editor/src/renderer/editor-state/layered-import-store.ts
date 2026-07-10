import { create } from 'zustand';
import type { LayeredImportDiagnostic, SpineImportError } from '../../shared';

// The last layered-file import report to surface in the results dialog (PP-D5): ephemeral editor state,
// never undoable, never serialized (the editor/document wall). The Import Layered File action writes it
// after the built document has already loaded through the normal validated load flow; the results component
// reads it to list every layer feature that could not be represented (and, on a failed import, each typed
// error) so nothing is dropped silently. `open` is false until the first import and after dismissal.

export interface LayeredImportReport {
  readonly status: 'imported' | 'failed';
  // The imported rig name on success; null when the import failed (no document was produced).
  readonly name: string | null;
  readonly diagnostics: readonly LayeredImportDiagnostic[];
  readonly errors: readonly SpineImportError[];
}

interface LayeredImportStore {
  readonly open: boolean;
  readonly report: LayeredImportReport | null;
  show(report: LayeredImportReport): void;
  dismiss(): void;
}

export const useLayeredImportStore = create<LayeredImportStore>((set) => ({
  open: false,
  report: null,
  show: (report) => set({ open: true, report }),
  dismiss: () => set({ open: false }),
}));
