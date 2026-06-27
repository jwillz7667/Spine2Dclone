// Sandboxed preload: exposes a small typed bridge on window.marionette via contextBridge. The raw
// ipcRenderer is never exposed. The renderer depends on the MarionetteApi type from editor-shared,
// not on this module, so the process split holds. Zod is bundled into this file at build time
// (the sandbox cannot require external modules at runtime).

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type MarionetteApi } from '../shared';

const api: MarionetteApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannel.getVersion),
  saveDocument: (document) => ipcRenderer.invoke(IpcChannel.fileSave, { document }),
  openDocument: () => ipcRenderer.invoke(IpcChannel.fileOpen, undefined),
  importAtlas: () => ipcRenderer.invoke(IpcChannel.atlasImport, undefined),
};

contextBridge.exposeInMainWorld('marionette', api);
