import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import { projectLayeredFile } from './layered-project';
import type { IpcResult, LayeredImportResponse } from '../shared';

// The Electron dialog wrapper for the layered-file import (PP-D5). Main owns the .psd/.ora open dialog (the
// renderer never supplies a filesystem path: the path-injection defense, mirroring spine-import.ts). All the
// parsing and projection live in the Electron-free layered-project.ts so they stay unit testable; this module
// only opens the dialog, reads the bytes, and delegates. Import only, never export.

const LAYERED_FILTERS = [
  { name: 'Layered Image', extensions: ['psd', 'ora'] },
  { name: 'All Files', extensions: ['*'] },
];

function nameFromPath(path: string): string {
  const stem = basename(path, extname(path));
  return stem.length > 0 ? stem : 'imported-rig';
}

export async function importLayeredFromFile(): Promise<IpcResult<LayeredImportResponse>> {
  const openOptions = {
    title: 'Import Layered File',
    properties: ['openFile' as const],
    filters: LAYERED_FILTERS,
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  const format = extname(path).toLowerCase() === '.ora' ? 'ora' : 'psd';
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch {
    return {
      ok: false,
      error: { code: 'IPC_HANDLER_ERROR', message: `could not read file ${path}` },
    };
  }

  return { ok: true, data: projectLayeredFile(bytes, nameFromPath(path), format) };
}
