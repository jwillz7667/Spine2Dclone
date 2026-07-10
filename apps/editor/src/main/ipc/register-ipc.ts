// Main-process IPC wiring. Request/response only (ipcMain.handle). Handlers are registered ONLY
// for allowlisted channels, every payload is validated with Zod at this boundary, and a typed
// IpcResult is returned (never a bare throw across the wire). WP-0.8 extends this with file IO.

import { app, ipcMain } from 'electron';
import {
  IpcChannel,
  atlasImportGridRequestSchema,
  atlasImportImagesRequestSchema,
  atlasImportPremadeRequestSchema,
  atlasImportRequestSchema,
  exportCancelRequestSchema,
  exportMediaRequestSchema,
  exportProfileLoadRequestSchema,
  exportProfileSaveRequestSchema,
  exportProjectRequestSchema,
  exportWriteVideoRequestSchema,
  fileOpenRequestSchema,
  fileSaveRequestSchema,
  getVersionRequestSchema,
  getVersionResponseSchema,
  spineImportRequestSchema,
  validateWith,
  type AtlasImportResponse,
  type ExportCancelResponse,
  type ExportMediaResponse,
  type ExportProfileLoadResponse,
  type ExportProfileSaveResponse,
  type ExportProjectResponse,
  type ExportWriteVideoResponse,
  type FileOpenResponse,
  type FileSaveResponse,
  type GetVersionResponse,
  type IpcResult,
  type SpineImportResponse,
} from '../../shared';
import { importAtlasFromDirectory, importAtlasImages } from '../atlas-import';
import { importPremadeAtlasFromFile } from '../atlas-premade-import';
import { importGridAtlasFromImage } from '../atlas-premade-io';
import {
  cancelMediaExport,
  exportMediaToFile,
  exportProjectToFile,
  loadExportProfileFromDialog,
  saveExportProfileFromDialog,
  writeVideoToFile,
} from '../export';
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

  ipcMain.handle(
    IpcChannel.exportProject,
    async (_event, payload: unknown): Promise<IpcResult<ExportProjectResponse>> => {
      const request = validateWith(exportProjectRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return exportProjectToFile(request.data.document, request.data.format);
    },
  );

  ipcMain.handle(
    IpcChannel.exportMedia,
    async (event, payload: unknown): Promise<IpcResult<ExportMediaResponse>> => {
      const request = validateWith(exportMediaRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      const { jobId, document, pages, options } = request.data;
      return exportMediaToFile(event.sender, jobId, document, pages, options);
    },
  );

  ipcMain.handle(
    IpcChannel.exportCancel,
    async (_event, payload: unknown): Promise<IpcResult<ExportCancelResponse>> => {
      const request = validateWith(exportCancelRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return cancelMediaExport(request.data.jobId);
    },
  );

  ipcMain.handle(
    IpcChannel.exportWriteVideo,
    async (_event, payload: unknown): Promise<IpcResult<ExportWriteVideoResponse>> => {
      const request = validateWith(exportWriteVideoRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return writeVideoToFile(request.data.data, request.data.container, request.data.defaultName);
    },
  );

  ipcMain.handle(
    IpcChannel.exportProfileLoad,
    async (_event, payload: unknown): Promise<IpcResult<ExportProfileLoadResponse>> => {
      const request = validateWith(exportProfileLoadRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return loadExportProfileFromDialog();
    },
  );

  ipcMain.handle(
    IpcChannel.exportProfileSave,
    async (_event, payload: unknown): Promise<IpcResult<ExportProfileSaveResponse>> => {
      const request = validateWith(exportProfileSaveRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return saveExportProfileFromDialog(request.data.profile);
    },
  );

  ipcMain.handle(
    IpcChannel.atlasImportPremade,
    async (_event, payload: unknown): Promise<IpcResult<AtlasImportResponse>> => {
      const request = validateWith(atlasImportPremadeRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return importPremadeAtlasFromFile();
    },
  );

  ipcMain.handle(
    IpcChannel.atlasImportGrid,
    async (_event, payload: unknown): Promise<IpcResult<AtlasImportResponse>> => {
      const request = validateWith(atlasImportGridRequestSchema, payload, 'IPC_BAD_REQUEST');
      if (!request.ok) return request;
      return importGridAtlasFromImage(request.data.image, request.data.grid);
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
  ipcMain.removeHandler(IpcChannel.exportProject);
  ipcMain.removeHandler(IpcChannel.exportMedia);
  ipcMain.removeHandler(IpcChannel.exportCancel);
  ipcMain.removeHandler(IpcChannel.exportWriteVideo);
  ipcMain.removeHandler(IpcChannel.exportProfileLoad);
  ipcMain.removeHandler(IpcChannel.exportProfileSave);
  ipcMain.removeHandler(IpcChannel.atlasImportPremade);
  ipcMain.removeHandler(IpcChannel.atlasImportGrid);
}
