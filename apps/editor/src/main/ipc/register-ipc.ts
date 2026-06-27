// Main-process IPC wiring. Request/response only (ipcMain.handle). Handlers are registered ONLY
// for allowlisted channels, every payload is validated with Zod at this boundary, and a typed
// IpcResult is returned (never a bare throw across the wire). WP-0.8 extends this with file IO.

import { app, ipcMain } from 'electron';
import {
  IpcChannel,
  getVersionRequestSchema,
  getVersionResponseSchema,
  validateWith,
  type GetVersionResponse,
  type IpcResult,
} from '../../shared';

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
}

export function disposeIpc(): void {
  ipcMain.removeHandler(IpcChannel.getVersion);
}
