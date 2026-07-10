// Sandboxed preload: exposes a small typed bridge on window.marionette via contextBridge. The raw
// ipcRenderer is never exposed. The renderer depends on the MarionetteApi type from editor-shared,
// not on this module, so the process split holds. Zod is bundled into this file at build time
// (the sandbox cannot require external modules at runtime).

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, exportProgressSchema, isMenuActionId, type MarionetteApi } from '../shared';

const api: MarionetteApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannel.getVersion),
  saveDocument: (document, pages) => ipcRenderer.invoke(IpcChannel.fileSave, { document, pages }),
  openDocument: () => ipcRenderer.invoke(IpcChannel.fileOpen, undefined),
  importAtlas: () => ipcRenderer.invoke(IpcChannel.atlasImport, undefined),
  importAtlasImages: (images) => ipcRenderer.invoke(IpcChannel.atlasImportImages, { images }),
  importSpineProject: () => ipcRenderer.invoke(IpcChannel.spineImport, undefined),
  importPremadeAtlas: () => ipcRenderer.invoke(IpcChannel.atlasImportPremade, undefined),
  importGridAtlas: (image, grid) => ipcRenderer.invoke(IpcChannel.atlasImportGrid, { image, grid }),
  importLayeredFile: () => ipcRenderer.invoke(IpcChannel.layeredImport, undefined),
  onMenuAction: (callback) => {
    // Forward ONLY allowlisted menu actions (defense in depth: an unknown or spoofed payload is dropped).
    const listener = (_event: IpcRendererEvent, action: unknown): void => {
      if (isMenuActionId(action)) callback(action);
    };
    ipcRenderer.on(IpcChannel.menuAction, listener);
    return () => ipcRenderer.removeListener(IpcChannel.menuAction, listener);
  },
  exportProject: (document, format) =>
    ipcRenderer.invoke(IpcChannel.exportProject, { document, format }),
  exportMedia: (jobId, document, pages, options) =>
    ipcRenderer.invoke(IpcChannel.exportMedia, { jobId, document, pages, options }),
  cancelExport: (jobId) => ipcRenderer.invoke(IpcChannel.exportCancel, { jobId }),
  onExportProgress: (callback) => {
    // Forward only well-formed progress payloads for the export:progress push (defense in depth).
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      const parsed = exportProgressSchema.safeParse(payload);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on(IpcChannel.exportProgress, listener);
    return () => ipcRenderer.removeListener(IpcChannel.exportProgress, listener);
  },
  writeVideo: (data, container, defaultName) =>
    ipcRenderer.invoke(IpcChannel.exportWriteVideo, { data, container, defaultName }),
  loadExportProfile: () => ipcRenderer.invoke(IpcChannel.exportProfileLoad, undefined),
  saveExportProfile: (profile) => ipcRenderer.invoke(IpcChannel.exportProfileSave, { profile }),
  exportAtlas: (profile) => ipcRenderer.invoke(IpcChannel.exportAtlas, { profile }),
};

contextBridge.exposeInMainWorld('marionette', api);
