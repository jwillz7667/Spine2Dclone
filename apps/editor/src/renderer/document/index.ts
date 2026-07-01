// Re-export the @marionette/document-core public surface so the editor renderer consumes the command
// spine through ONE barrel (ADR-0001): tools, the gizmo, the viewport, and keybindings import commands
// and types from here and never reach past the barrel into document-core internals (Mutator and the
// write surface are not exported by document-core, the structural half of LAW 2). The DocumentHost
// below owns the single live Document for the renderer. The document is deliberately NOT in Zustand;
// only selection, tool, and camera are ephemeral editor state (the editor/document wall, handoff 8.2).
export * from '@marionette/document-core';

import { exportDocument, loadDocument, type Document } from '@marionette/document-core';
import { createInitialDocument, createProductionEnvironment } from '../composition-root';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { bridge } from '../ipc-bridge';

// The renderer's single owner of the live Document. It holds the current Document (created at startup
// through the composition root) and is the ONE place that reconciles the ephemeral selection store
// after a committed mutation: every HistoryEvent applies the command's per-phase selectionHint and then
// prunes any selected id that no longer resolves in the model (for example a bone removed by undoing
// its CreateBone). Because every mutation path (the create tool, gizmo move/rotate sessions, and the
// undo/redo keybindings) routes through the same History, this single subscription keeps selection
// correct for all of them, so no call site has to apply hints itself. The viewport learns the document
// changed by polling current().model.revision each frame (the editor/document wall keeps the document
// out of Zustand). load() performs the WP-0.8 atomic swap when a file is opened.
class DocumentHost {
  private document: Document;
  // Tears down the reconciler subscription on the CURRENT document; replaced atomically on load().
  private detachReconciler: () => void;

  constructor() {
    this.document = createInitialDocument();
    this.detachReconciler = this.attachReconciler(this.document);
  }

  current(): Document {
    return this.document;
  }

  // Atomic document swap (handoff 8.2, WP-0.8): replace the live Document with one rebuilt from
  // validated format JSON. loadDocument re-validates at the boundary (LAW 3) and throws a typed error
  // on malformed input WITHOUT mutating anything, so a failed load leaves the current document intact
  // (this method lets that throw propagate to the caller, which surfaces it). On success the old
  // History subscription is detached and the reconciler is re-attached to the new History; selection is
  // cleared because loaded entities carry freshly minted BoneIds that no prior selection can reference.
  // Load is not a command and resets undo/redo: the new Document starts with empty history. The atlas
  // page textures are ephemeral editor state belonging to the previous import session, so they are cleared
  // too: this piece does NOT restore textures for a loaded document (the pages live in userData keyed by
  // the import session, so doc-relative atlas loading is a later packaging concern). The viewport renders
  // the 1x1 placeholder until sprites are re-imported.
  load(json: unknown): void {
    const next = loadDocument(json, createProductionEnvironment());
    this.detachReconciler();
    this.document = next;
    this.detachReconciler = this.attachReconciler(next);
    useSelectionStore.getState().clear();
    atlasTextureStore.clear();
  }

  // File > New: swap in a fresh, empty document (no bones, no atlas), the same atomic reconciler + cleared
  // ephemeral state as load(). Not a command and resets undo/redo (a new document starts empty). The
  // viewport shows nothing until the first CreateBone (the fresh document is genuinely empty).
  newDocument(): void {
    const next = createInitialDocument();
    this.detachReconciler();
    this.document = next;
    this.detachReconciler = this.attachReconciler(next);
    useSelectionStore.getState().clear();
    atlasTextureStore.clear();
  }

  private attachReconciler(document: Document): () => void {
    return document.history.subscribe((event) => {
      const selection = useSelectionStore.getState();
      selection.applyHint(event.selectionHint);
      selection.prune((id) => document.model.getBone(id) !== undefined);
    });
  }
}

// The renderer-wide singleton, constructed once on first import. The renderer is a DOM context, so the
// production clock and IdFactory the composition root injects are legitimate here (and only here).
export const documentHost = new DocumentHost();

// The result of a save/open action, surfaced to the caller (the keybinding handler logs failures).
// Modeled as a discriminated union so neither a user cancel nor a typed error is swallowed.
export type FileActionOutcome =
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'opened'; readonly name: string }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'error'; readonly message: string };

// Export the live document to the format and hand it to the main process to write (WP-0.8). The export
// runs in the renderer (it owns the model); exportDocument validates and stamps the content hash, so a
// corrupt projection fails loudly here before any IPC. The main process re-validates and owns the save
// dialog (the renderer never supplies a path: path-injection defense).
export async function saveCurrentDocument(): Promise<FileActionOutcome> {
  let exported: unknown;
  try {
    exported = exportDocument(documentHost.current().model);
  } catch (error) {
    return { kind: 'error', message: messageOf(error, 'export failed') };
  }
  try {
    const result = await bridge().saveDocument(exported);
    if (!result.ok) return { kind: 'error', message: result.error.message };
    if (result.data.status === 'canceled') return { kind: 'canceled' };
    return { kind: 'saved', path: result.data.path };
  } catch (error) {
    // A missing bridge (failed preload) throws here; surface it instead of an opaque rejection.
    return { kind: 'error', message: messageOf(error, 'save failed') };
  }
}

// Open a document chosen in the main-process dialog and swap it in (WP-0.8). The main process reads and
// validates the file; the renderer re-validates and rebuilds via documentHost.load (validate-on-load,
// LAW 3). A load that throws (a malformed document that slipped past the first validation) is caught
// and reported, leaving the current document untouched.
export async function openDocumentFromDialog(): Promise<FileActionOutcome> {
  try {
    const result = await bridge().openDocument();
    if (!result.ok) return { kind: 'error', message: result.error.message };
    if (result.data.status === 'canceled') return { kind: 'canceled' };
    try {
      documentHost.load(result.data.document);
    } catch (error) {
      return { kind: 'error', message: messageOf(error, 'load failed') };
    }
    return { kind: 'opened', name: result.data.name };
  } catch (error) {
    // A missing bridge (failed preload) throws here; surface it instead of an opaque rejection.
    return { kind: 'error', message: messageOf(error, 'open failed') };
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
