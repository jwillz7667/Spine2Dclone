// Electron main process: app lifecycle, the hardened BrowserWindow, the authoritative CSP header,
// and the secure IPC registration. The renderer is loaded from the Vite dev server in dev and from
// the bundled file in prod. No business logic lives here.

import { app, BrowserWindow, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspForMode, type BuildMode } from './csp';
import { createWindowOptions } from './window-options';
import { registerIpc } from './ipc/register-ipc';

const currentDir = dirname(fileURLToPath(import.meta.url));
const mode: BuildMode = app.isPackaged ? 'prod' : 'dev';

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

async function createWindow(): Promise<void> {
  const preloadPath = join(currentDir, '../preload/preload.cjs');
  const window = new BrowserWindow(createWindowOptions({ preloadPath }));
  window.once('ready-to-show', () => window.show());

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
