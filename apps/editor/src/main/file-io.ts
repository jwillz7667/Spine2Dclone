import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { validateDocument } from '@marionette/format';
import { BrowserWindow, dialog } from 'electron';
import type { FileOpenResponse, FileSaveResponse, IpcResult } from '../shared';

// File IO lives in the main process only (the renderer is sandboxed, no Node). The renderer never
// supplies a filesystem path: the path always comes from a main-process dialog (path-injection
// defense). Documents are validated with @marionette/format at this boundary before any write or
// after any read, so a malformed payload or a corrupt file fails loudly with a typed IPC error.
// node:path keeps file names portable across macOS and Windows.

const FILE_FILTERS = [
  { name: 'Marionette Skeleton', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] },
];

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

function validationMessage(prefix: string, codes: readonly string[]): string {
  return `${prefix}: ${codes.join(', ')}`;
}

export async function saveDocumentToFile(document: unknown): Promise<IpcResult<FileSaveResponse>> {
  // Deep-validate before touching disk (do not write an invalid document). verifyHash true: an
  // exported document always carries the format's content hash, so a tampered payload is rejected.
  const report = validateDocument(document, { verifyHash: true });
  if (!report.ok || report.document === null) {
    return handlerError(
      validationMessage(
        'document failed validation',
        report.errors.map((e) => e.code),
      ),
    );
  }

  const saveOptions = {
    title: 'Save Skeleton',
    filters: FILE_FILTERS,
    defaultPath: `${report.document.name}.json`,
  };
  // electron's showSaveDialog overloads accept either a parent window or none; a focused window may
  // not exist, so dispatch to the matching overload rather than passing BrowserWindow | undefined.
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showSaveDialog(focused, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  try {
    await writeFile(result.filePath, `${JSON.stringify(report.document, null, 2)}\n`, 'utf8');
  } catch {
    return handlerError(`could not write file ${result.filePath}`);
  }
  return { ok: true, data: { status: 'saved', path: result.filePath } };
}

export async function openDocumentFromFile(): Promise<IpcResult<FileOpenResponse>> {
  const openOptions = {
    title: 'Open Skeleton',
    properties: ['openFile' as const],
    filters: FILE_FILTERS,
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const path = result.filePaths[0];
  if (result.canceled || path === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return handlerError(`could not read file ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return handlerError(`file ${basename(path)} is not valid JSON`);
  }

  const report = validateDocument(parsed, { verifyHash: true });
  if (!report.ok || report.document === null) {
    return handlerError(
      validationMessage(
        'document failed validation',
        report.errors.map((e) => e.code),
      ),
    );
  }

  return { ok: true, data: { status: 'opened', name: basename(path), document: report.document } };
}
