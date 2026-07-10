import { documentHost } from '../document';
import { bridge } from '../ipc-bridge';
import { useSpineImportStore } from '../editor-state/spine-import-store';
import type { SpineImportError, SpineImportWarning } from '../../shared';

// The Import Spine Project action (PP-A5), shared by the File menu item (and any future assets/hierarchy
// affordance) so every entry point runs the SAME flow. The main process owns the file dialog and runs the
// clean-room importer OUTSIDE the renderer document path (no renderer filesystem path: the path-injection
// defense). On success the converted, already-validated document loads through the EXISTING validated load
// flow (documentHost.load, which re-validates via loadDocument and resets History, LAW 3), and the report
// (warnings, or the typed errors on failure) is published to the results store for the dialog to list.
// Returns a typed outcome so the caller can also log; the document crosses the wire as `unknown` and is
// re-validated by loadDocument, so no narrowing assertion is needed here.

export type SpineProjectImportOutcome =
  | {
      readonly kind: 'imported';
      readonly name: string;
      readonly warnings: readonly SpineImportWarning[];
    }
  | {
      readonly kind: 'failed';
      readonly errors: readonly SpineImportError[];
      readonly warnings: readonly SpineImportWarning[];
    }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'error'; readonly message: string };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function importSpineProjectFromDialog(): Promise<SpineProjectImportOutcome> {
  try {
    const result = await bridge().importSpineProject();
    if (!result.ok) return { kind: 'error', message: result.error.message };
    const data = result.data;
    if (data.status === 'canceled') return { kind: 'canceled' };
    if (data.status === 'failed') {
      useSpineImportStore.getState().show({
        status: 'failed',
        name: null,
        warnings: data.warnings,
        errors: data.errors,
      });
      return { kind: 'failed', errors: data.errors, warnings: data.warnings };
    }
    try {
      documentHost.load(data.document);
    } catch (error) {
      // A converted document that slips past the importer's validation still fails loudly on load; the
      // current document is left untouched (documentHost.load throws without mutating).
      return { kind: 'error', message: messageOf(error, 'load failed') };
    }
    useSpineImportStore.getState().show({
      status: 'imported',
      name: data.name,
      warnings: data.warnings,
      errors: [],
    });
    return { kind: 'imported', name: data.name, warnings: data.warnings };
  } catch (error) {
    // A missing bridge (failed preload) throws here; surface it instead of an opaque rejection.
    return { kind: 'error', message: messageOf(error, 'import failed') };
  }
}
