import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { IpcResult, SpineImportResponse } from '../shared';
import { convertSpineProject, type SpineFileContents } from './spine-import-convert';

// The Import Spine Project dialog + filesystem wrapper (main process only; the renderer is sandboxed, no
// Node). The renderer never supplies a filesystem path: it always comes from a main-process dialog
// (path-injection defense), exactly like file:open. The pure conversion lives in spine-import-convert.ts
// (headless-testable); this module only owns the dialog and the file read. Import only, never export.

const SPINE_FILTERS = [
  { name: 'Spine Project', extensions: ['json', 'skel'] },
  { name: 'All Files', extensions: ['*'] },
];

// Show the open dialog, read the chosen file (text for JSON, bytes for .skel), and convert it. A read
// failure is a typed IPC handler error; a cancel is a normal outcome; an import failure is a `failed`
// response (surfaced by the renderer results dialog), never a thrown IPC error.
export async function importSpineProjectFromFile(): Promise<IpcResult<SpineImportResponse>> {
  const openOptions = {
    title: 'Import Spine Project',
    properties: ['openFile' as const],
    filters: SPINE_FILTERS,
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  const isBinary = extname(path).toLowerCase() === '.skel';
  let contents: SpineFileContents;
  try {
    contents = isBinary
      ? { kind: 'skel', bytes: new Uint8Array(await readFile(path)) }
      : { kind: 'json', text: await readFile(path, 'utf8') };
  } catch {
    return {
      ok: false,
      error: { code: 'IPC_HANDLER_ERROR', message: `could not read file ${path}` },
    };
  }

  return { ok: true, data: convertSpineProject(path, contents) };
}
