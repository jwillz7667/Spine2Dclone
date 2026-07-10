// PURE application-menu template factory. Extracted so the menu structure is unit-testable without
// launching Electron (the same discipline as window-options.ts and csp.ts). main.ts calls
// Menu.buildFromTemplate(buildAppMenuTemplate(...)) then Menu.setApplicationMenu, so the running app shows
// a real File / Edit / View / Tools / Window / Help menu bar instead of Electron's bare default.
//
// Two kinds of items:
//   - APP ACTIONS (New, Open, Save, Import, Undo, Redo, tool + mode switches): their click() calls the
//     injected `dispatch(actionId)`, which the caller wires to webContents.send(menu:action, id). They set
//     an accelerator for DISCOVERABILITY but with registerAccelerator:false, so the menu does NOT register
//     the shortcut: the renderer's existing keybindings stay the single active handler and nothing
//     double-fires. The single-key tool shortcuts (V, B) are shown in the label text, not as accelerators,
//     so they never fire while typing in a text field.
//   - OS ROLES (reload, devtools, zoom, copy/paste, quit, minimize, ...): standard Electron roles that DO
//     register their accelerators (there is no renderer handler for them). Reload + Toggle DevTools are
//     included deliberately so a user can inspect the console when something looks wrong.

import type { MenuItemConstructorOptions } from 'electron';
import { type MenuActionId } from '../../shared';

export interface AppMenuOptions {
  // True on macOS: adds the standard leading application menu and uses the mac Window-menu roles.
  readonly isMac: boolean;
  // Invoked with the action id when an app-action item is clicked. The caller forwards it to the renderer.
  readonly dispatch: (action: MenuActionId) => void;
}

// An app-action menu item: dispatches on click, shows (but does not register) its accelerator so the
// renderer keybindings remain the single active handler.
function action(
  label: string,
  id: MenuActionId,
  dispatch: (action: MenuActionId) => void,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
    click: () => dispatch(id),
  };
}

export function buildAppMenuTemplate(options: AppMenuOptions): MenuItemConstructorOptions[] {
  const { isMac, dispatch } = options;
  const mod = isMac ? 'Cmd' : 'Ctrl';

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      role: 'appMenu',
    });
  }

  template.push({
    label: 'File',
    submenu: [
      action('New', 'file:new', dispatch, `${mod}+N`),
      action('Open...', 'file:open', dispatch, `${mod}+O`),
      { type: 'separator' },
      action('Save...', 'file:save', dispatch, `${mod}+S`),
      { type: 'separator' },
      action('Import Sprites...', 'file:importSprites', dispatch, `${mod}+Shift+I`),
      action('Import Atlas...', 'file:importAtlas', dispatch),
      action('Slice Sprite Sheet...', 'file:importGrid', dispatch),
      action('Import Layered File (PSD/ORA)...', 'file:importLayered', dispatch),
      action('Import Spine Project...', 'file:importSpine', dispatch),
      { type: 'separator' },
      action('Export...', 'file:export', dispatch, `${mod}+E`),
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      // App History (document undo/redo), NOT the DOM 'undo'/'redo' roles. Accelerators are shown but not
      // registered here; the renderer keybindings own Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
      action('Undo', 'edit:undo', dispatch, `${mod}+Z`),
      action('Redo', 'edit:redo', dispatch, isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
      { type: 'separator' },
      // Native clipboard roles, for editing text in the inspector fields.
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: 'Tools',
    submenu: [
      // Single-key shortcuts (V, B) are shown in the label, handled by the renderer keydown (which guards
      // text fields), so they are NOT Electron accelerators here.
      action('Select (V)', 'tool:select', dispatch),
      action('Create Bone (B)', 'tool:createBone', dispatch),
      { type: 'separator' },
      action('Setup Mode', 'mode:setup', dispatch),
      action('Animation Mode', 'mode:animation', dispatch),
      action('Toggle Auto-key', 'mode:toggleAutoKey', dispatch),
    ],
  });

  template.push({
    role: 'windowMenu',
  });

  return template;
}
