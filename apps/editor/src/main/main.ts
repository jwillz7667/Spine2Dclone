// Electron main process: app lifecycle, the hardened BrowserWindow, the authoritative CSP header,
// and the secure IPC registration. The renderer is loaded from the Vite dev server in dev and from
// the bundled file in prod. No business logic lives here.

import { app, BrowserWindow, Menu, nativeImage, session } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspForMode, type BuildMode } from './csp';
import { createWindowOptions } from './window-options';
import { registerIpc } from './ipc/register-ipc';
import { buildAppMenuTemplate } from './menu/app-menu';
import { IpcChannel } from '../shared';

const currentDir = dirname(fileURLToPath(import.meta.url));
const mode: BuildMode = app.isPackaged ? 'prod' : 'dev';

// The Armature A mark (apps/editor/resources/icon.png). Packaged builds carry it in resources
// (and macOS uses build/icon.icns); in dev the source tree path applies. Cosmetic: a missing file
// is warned about, never fatal.
function resolveIconPath(): string | undefined {
  const candidate = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(currentDir, '../../resources/icon.png');
  if (existsSync(candidate)) return candidate;
  console.warn(`[marionette] app icon not found at ${candidate}`);
  return undefined;
}

// In dev on macOS the dock shows the stock Electron icon unless set explicitly (packaged builds
// get it from icon.icns instead).
function applyDevDockIcon(iconPath: string | undefined): void {
  if (app.isPackaged || process.platform !== 'darwin' || !iconPath || !app.dock) return;
  const image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) app.dock.setIcon(image);
}

function applyCspHeader(): void {
  const policy = cspForMode(mode);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

// Install the native application menu (File / Edit / View / Tools / Window). App-action clicks are pushed
// to THIS window's renderer over menu:action; the renderer maps them to the same actions its keybindings
// run. The menu is global (Menu.setApplicationMenu), so it is set once per window creation targeting the
// focused window's webContents.
function installApplicationMenu(window: BrowserWindow): void {
  const template = buildAppMenuTemplate({
    isMac: process.platform === 'darwin',
    dispatch: (action) => {
      if (!window.isDestroyed()) window.webContents.send(IpcChannel.menuAction, action);
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const preloadPath = join(currentDir, '../preload/preload.cjs');
  const iconPath = resolveIconPath();
  applyDevDockIcon(iconPath);
  const window = new BrowserWindow(createWindowOptions({ preloadPath, iconPath }));
  window.once('ready-to-show', () => window.show());

  // Surface a preload load failure loudly in the main-process console instead of a silent bridge outage
  // (a broken preload leaves window.marionette undefined, so save/open/import would fail with no clue).
  window.webContents.on('preload-error', (_event, path, error) => {
    console.error(`[marionette] preload failed to load (${path}):`, error);
  });

  installApplicationMenu(window);

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
  } else {
    await window.loadFile(join(currentDir, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  applyCspHeader();
  registerIpc();
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
