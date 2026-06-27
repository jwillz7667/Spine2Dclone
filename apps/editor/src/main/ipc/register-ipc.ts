// Main-process IPC wiring. Request/response only (ipcMain.handle). Handlers are registered ONLY
// for allowlisted channels, every payload is validated with Zod at this boundary, and a typed
// IpcResult is returned (never a bare throw across the wire). WP-0.8 extends this with file IO.

import { app, ipcMain } from 'electron';
import {
  IpcChannel,
  atlasImportRequestSchema,
  fileOpenRequestSchema,
  fileSaveRequestSchema,
  getVersionRequestSchema,
  getVersionResponseSchema,
  validateWith,
  type AtlasImportResponse,
  type FileOpenResponse,
  type FileSaveResponse,
  type GetVersionResponse,
  type IpcResult,
} from '../../shared';
import { importAtlasFromDirectory } from '../atlas-import';
import { openDocumentFromFile, saveDocumentToFile } from '../file-io';

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
      return saveDocumentToFile(request.data.document);
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
}

export function disposeIpc(): void {
  ipcMain.removeHandler(IpcChannel.getVersion);
  ipcMain.removeHandler(IpcChannel.fileSave);
  ipcMain.removeHandler(IpcChannel.fileOpen);
  ipcMain.removeHandler(IpcChannel.atlasImport);
}
