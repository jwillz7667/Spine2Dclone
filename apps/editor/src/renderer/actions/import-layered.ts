import { documentHost } from '../document';
import { bridge } from '../ipc-bridge';
import { useLayeredImportStore } from '../editor-state/layered-import-store';
import { restoreAtlasTextures } from './restore-atlas';
import type { LayeredImportDiagnostic, SpineImportError } from '../../shared';

// The Import Layered File action (PP-D5), shared by the File menu item and the Assets panel button so every
// entry point runs the SAME flow. The main process owns the .psd/.ora dialog, parses the file OFF the
// renderer document path (no renderer filesystem path: the path-injection defense), packs the layers, and
// builds a validated document. On success the document loads through the EXISTING validated load flow
// (documentHost.load, which re-validates via loadDocument and resets History, LAW 3), the atlas page
// textures are published like a file-open restore, and the diagnostics (or the typed errors on failure) are
// pushed to the results store for the dialog. Returns a typed outcome so the caller can also log; the
// document crosses the wire as `unknown` and loadDocument re-validates it, so no narrowing assertion is
// needed for it.

export type LayeredImportOutcome =
  | {
      readonly kind: 'imported';
      readonly name: string;
      readonly diagnostics: readonly LayeredImportDiagnostic[];
    }
  | {
      readonly kind: 'failed';
      readonly errors: readonly SpineImportError[];
      readonly diagnostics: readonly LayeredImportDiagnostic[];
    }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'error'; readonly message: string };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function importLayeredFromDialog(): Promise<LayeredImportOutcome> {
  try {
    const result = await bridge().importLayeredFile();
    if (!result.ok) return { kind: 'error', message: result.error.message };
    const data = result.data;
    if (data.status === 'canceled') return { kind: 'canceled' };
    if (data.status === 'failed') {
      useLayeredImportStore
        .getState()
        .show({ status: 'failed', name: null, diagnostics: data.diagnostics, errors: data.errors });
      return { kind: 'failed', errors: data.errors, diagnostics: data.diagnostics };
    }

    try {
      documentHost.load(data.document);
    } catch (error) {
      // A built document that slips past validation still fails loudly on load; the current document is left
      // untouched (documentHost.load throws without mutating).
      return { kind: 'error', message: messageOf(error, 'load failed') };
    }

    // The atlas is baked into the loaded document, so publishing its page textures is all that remains (the
    // load already installed the atlas metadata; no SetAtlasRef command). A texture failure leaves the
    // placeholder (the document still carries the atlas) and is surfaced as a non-fatal error after the
    // report is shown.
    const atlas = documentHost.current().model.preserved().atlas;
    let textureError: string | null = null;
    try {
      await restoreAtlasTextures(atlas, data.pages);
    } catch (error) {
      textureError = messageOf(error, 'failed to load atlas page textures');
    }

    useLayeredImportStore
      .getState()
      .show({ status: 'imported', name: data.name, diagnostics: data.diagnostics, errors: [] });
    if (textureError !== null) return { kind: 'error', message: textureError };
    return { kind: 'imported', name: data.name, diagnostics: data.diagnostics };
  } catch (error) {
    // A missing bridge (failed preload) throws here; surface it instead of an opaque rejection.
    return { kind: 'error', message: messageOf(error, 'import failed') };
  }
}
