import {
  documentHost,
  openDocumentFromDialog,
  saveCurrentDocument,
  type FileActionOutcome,
} from './document';
import { runSpriteImport } from './actions/import-sprites';
import { importSpineProjectFromDialog } from './actions/import-spine';
import { openExportDialog } from './actions/export';
import { useToolStore } from './editor-state/tool-store';
import { usePlaybackStore } from './editor-state/playback-store';
import { bridge } from './ipc-bridge';
import type { MenuActionId } from '../shared';

// Wire native application-menu clicks (pushed from the main process over menu:action) to the SAME actions
// the keybindings run, so the menu is a discoverable surface over the existing behavior, not a second
// implementation. Registered once at the renderer root (like attachKeybindings). Only allowlisted
// MenuActionId strings arrive (the preload drops unknown ids). Tolerant of a missing bridge (a failed
// preload): it logs and returns a no-op cleanup so the app still renders.
export function attachMenuActions(): () => void {
  const run = (action: MenuActionId): void => {
    switch (action) {
      case 'file:new':
        documentHost.newDocument();
        return;
      case 'file:open':
        void openDocumentFromDialog().then(reportOutcome);
        return;
      case 'file:save':
        void saveCurrentDocument().then(reportOutcome);
        return;
      case 'file:importSprites':
        void runSpriteImport().then((outcome) => {
          if (outcome.kind === 'error') {
            console.error(`[marionette] import failed: ${outcome.message}`);
          }
        });
        return;
      case 'file:importSpine':
        void importSpineProjectFromDialog().then((outcome) => {
          if (outcome.kind === 'error') {
            console.error(`[marionette] Spine import failed: ${outcome.message}`);
          }
        });
        return;
      case 'file:export':
        openExportDialog();
        return;
      case 'edit:undo':
        documentHost.current().history.undo();
        return;
      case 'edit:redo':
        documentHost.current().history.redo();
        return;
      case 'tool:select':
        useToolStore.getState().setTool('select');
        return;
      case 'tool:createBone':
        useToolStore.getState().setTool('createBone');
        return;
      case 'mode:setup':
        usePlaybackStore.getState().setMode('setup');
        return;
      case 'mode:animation':
        usePlaybackStore.getState().setMode('animation');
        return;
      case 'mode:toggleAutoKey': {
        const store = usePlaybackStore.getState();
        store.setAutoKey(!store.autoKey);
        return;
      }
    }
  };

  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = bridge().onMenuAction(run);
  } catch (error) {
    console.error(
      '[marionette] application menu actions unavailable:',
      error instanceof Error ? error.message : error,
    );
  }
  return () => unsubscribe?.();
}

function reportOutcome(outcome: FileActionOutcome): void {
  if (outcome.kind === 'error') {
    console.error(`[marionette] menu action failed: ${outcome.message}`);
  }
}
