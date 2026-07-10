// Sandboxed preload: exposes a small typed bridge on window.marionette via contextBridge. The raw
// ipcRenderer is never exposed. The renderer depends on the MarionetteApi type from editor-shared,
// not on this module, so the process split holds. Zod is bundled into this file at build time
// (the sandbox cannot require external modules at runtime).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, isMenuActionId, type MarionetteApi } from '../shared';

const api: MarionetteApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannel.getVersion),
  saveDocument: (document, pages) => ipcRenderer.invoke(IpcChannel.fileSave, { document, pages }),
  openDocument: () => ipcRenderer.invoke(IpcChannel.fileOpen, undefined),
  importAtlas: () => ipcRenderer.invoke(IpcChannel.atlasImport, undefined),
  importAtlasImages: (images) => ipcRenderer.invoke(IpcChannel.atlasImportImages, { images }),
  importSpineProject: () => ipcRenderer.invoke(IpcChannel.spineImport, undefined),
  onMenuAction: (callback) => {
    // Forward ONLY allowlisted menu actions (defense in depth: an unknown or spoofed payload is dropped).
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (isMenuActionId(action)) callback(action);
    };
    ipcRenderer.on(IpcChannel.menuAction, listener);
    return () => ipcRenderer.removeListener(IpcChannel.menuAction, listener);
  },
};

contextBridge.exposeInMainWorld('marionette', api);
