// Main-process IPC wiring. Request/response only (ipcMain.handle). Handlers are registered ONLY
// for allowlisted channels, every payload is validated with Zod at this boundary, and a typed
// IpcResult is returned (never a bare throw across the wire). WP-0.8 extends this with file IO.

import { app, ipcMain } from 'electron';
import {
  IpcChannel,
  atlasImportImagesRequestSchema,
  atlasImportRequestSchema,
  fileOpenRequestSchema,
  fileSaveRequestSchema,
  getVersionRequestSchema,
  getVersionResponseSchema,
  spineImportRequestSchema,
  validateWith,
  type AtlasImportResponse,
  type FileOpenResponse,
  type FileSaveResponse,
  type GetVersionResponse,
  type IpcResult,
  type SpineImportResponse,
} from '../../shared';
import { importAtlasFromDirectory, importAtlasImages } from '../atlas-import';
import { openDocumentFromFile, saveDocumentToFile } from '../file-io';
import { importSpineProjectFromFile } from '../spine-import';

export function registerIpc(): void {
  ipcMain.handle(
    IpcChannel.getVersion,
    async (_event, payload: unknown): Promise<IpcResult<GetVersionResponse>> => {
      const request = validateWith(getVersionRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return validateWith(
        getVersionResponseSchema,
        { version: app.getVersion() },
        'IPC_BAD_RESPONSE',
      );
    },
  );

  ipcMain.handle(
    IpcChannel.fileSave,
    async (_event, payload: unknown): Promise<IpcResult<FileSaveResponse>> => {
      const request = validateWith(fileSaveRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return saveDocumentToFile(request.data.document, request.data.pages);
    },
  );

  ipcMain.handle(
    IpcChannel.fileOpen,
    async (_event, payload: unknown): Promise<IpcResult<FileOpenResponse>> => {
      const request = validateWith(fileOpenRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return openDocumentFromFile();
    },
  );

  ipcMain.handle(
    IpcChannel.atlasImport,
    async (_event, payload: unknown): Promise<IpcResult<AtlasImportResponse>> => {
      const request = validateWith(atlasImportRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return importAtlasFromDirectory();
    },
  );

  ipcMain.handle(
    IpcChannel.atlasImportImages,
    async (_event, payload: unknown): Promise<IpcResult<AtlasImportResponse>> => {
      const request = validateWith(atlasImportImagesRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return importAtlasImages(request.data.images);
    },
  );

  ipcMain.handle(
    IpcChannel.spineImport,
    async (_event, payload: unknown): Promise<IpcResult<SpineImportResponse>> => {
      const request = validateWith(spineImportRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return importSpineProjectFromFile();
    },
  );
}

export function disposeIpc(): void {
  ipcMain.removeHandler(IpcChannel.getVersion);
  ipcMain.removeHandler(IpcChannel.fileSave);
  ipcMain.removeHandler(IpcChannel.fileOpen);
  ipcMain.removeHandler(IpcChannel.atlasImport);
  ipcMain.removeHandler(IpcChannel.atlasImportImages);
  ipcMain.removeHandler(IpcChannel.spineImport);
}
