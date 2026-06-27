import {
  documentHost,
  openDocumentFromDialog,
  saveCurrentDocument,
  type FileActionOutcome,
} from '../document';
import { useToolStore } from '../editor-state/tool-store';

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

    // Tool switch (no modifier): V selects, B creates. Guarded by !mod so it never shadows a shortcut.
    if (mod) return;
    if (key === 'v') useToolStore.getState().setTool('select');
    else if (key === 'b') useToolStore.getState().setTool('createBone');
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

// A file action only needs to surface its FAILURE in Phase 0 (there is no notifications panel yet); a
// save/open/cancel succeeds silently. Logging at this single boundary keeps the error from vanishing.
function reportOutcome(outcome: FileActionOutcome): void {
  if (outcome.kind === 'error')
    console.error(`[marionette] file action failed: ${outcome.message}`);
}
