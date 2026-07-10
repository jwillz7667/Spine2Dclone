import {
  DeleteMeshVertexCommand,
  documentHost,
  openDocumentFromDialog,
  saveCurrentDocument,
  type FileActionOutcome,
} from '../document';
import { useMeshEditStore } from '../editor-state/mesh-edit-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { useToolStore } from '../editor-state/tool-store';
import { MeshError } from '../modules/mesh/mesh-error';
import { deleteInteriorVertex } from '../modules/mesh/topology-edit';
import { resolveMeshEditTarget } from './mesh-edit';

// Global editor keybindings (handoff 8.1): undo/redo routed to the CURRENT document's History, save/open
// to the main-process filesystem (WP-0.8), plus the Phase-0 tool switch. Cross-platform by design: the
// command modifier is Cmd on macOS (metaKey) and Ctrl on Windows (ctrlKey), so BOTH are accepted, and
// redo is bound to Cmd/Ctrl+Shift+Z as well as Ctrl+Y. Selection reconciliation after undo/redo is NOT
// done here: it is centralized in the DocumentHost's History subscription, which fires for every
// committed event with the same per-phase selectionHint the returned HistoryEvent carries, so every
// command source (tools, gizmo, keybindings) stays consistent through one path.
export function attachKeybindings(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTextEntry(event.target)) return;

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      documentHost.current().history.undo();
      return;
    }
    if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) {
      event.preventDefault();
      documentHost.current().history.redo();
      return;
    }
    // Save / open. preventDefault stops the browser's own Save/Open. The actions are async (they cross
    // the IPC boundary); the outcome is reported, never silently swallowed, but a non-error outcome
    // (saved/opened/canceled) needs no UI in Phase 0.
    if (mod && key === 's') {
      event.preventDefault();
      void saveCurrentDocument().then(reportOutcome);
      return;
    }
    if (mod && key === 'o') {
      event.preventDefault();
      void openDocumentFromDialog().then(reportOutcome);
      return;
    }

    // Tool switch (no modifier): V selects, B creates, M edits meshes, W paints weights, P edits paths.
    // Guarded by !mod so it never shadows a shortcut.
    if (mod) return;
    if (key === 'v') useToolStore.getState().setTool('select');
    else if (key === 'b') useToolStore.getState().setTool('createBone');
    else if (key === 'm') useToolStore.getState().setTool('mesh');
    else if (key === 'w') useToolStore.getState().setTool('weights');
    else if (key === 'p') useToolStore.getState().setTool('path');
    else if (key === 'delete' || key === 'backspace') deleteSelectedMeshVertex();
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// Delete/Backspace with the mesh tool active removes the selected INTERIOR vertex as one command
// (TASK-2.1.2). Inert unless the mesh tool is active with a vertex selected on a resolvable mesh, so
// the keys stay free for future per-tool deletion semantics. A hull-vertex (or stale-index) rejection
// from the pure geometry is surfaced at this boundary, not swallowed: the author asked for a delete
// that cannot happen, and the reason (typed MeshError) is reported once here.
function deleteSelectedMeshVertex(): void {
  if (useToolStore.getState().tool !== 'mesh') return;
  const meshEdit = useMeshEditStore.getState();
  const vertexIndex = meshEdit.selectedVertex;
  if (vertexIndex === null) return;

  const host = documentHost.current();
  const target = resolveMeshEditTarget(host.model, useSlotSelectionStore.getState().selectedSlotId);
  if (target === null) return;

  try {
    const result = deleteInteriorVertex(target.mesh, vertexIndex);
    host.history.execute(
      new DeleteMeshVertexCommand(
        target.slotId,
        target.attachmentName,
        result.uvs,
        result.triangles,
        result.vertices,
      ),
    );
    meshEdit.clearVertex();
  } catch (error) {
    if (error instanceof MeshError) {
      console.error(`[marionette] delete vertex rejected: ${error.message}`);
      return;
    }
    throw error;
  }
}

// A file action only needs to surface its FAILURE in Phase 0 (there is no notifications panel yet); a
// save/open/cancel succeeds silently. Logging at this single boundary keeps the error from vanishing.
function reportOutcome(outcome: FileActionOutcome): void {
  if (outcome.kind === 'error')
    console.error(`[marionette] file action failed: ${outcome.message}`);
}
