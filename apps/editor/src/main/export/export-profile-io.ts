import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import {
  exportProfileSchema,
  type ExportProfile,
  type ExportProfileLoadResponse,
  type ExportProfileSaveResponse,
  type IpcResult,
} from '../../shared';

// Export-profile IO for the Export dialog (PP-D6). Main owns the open/save dialog (the renderer supplies
// no path) and is the authoritative gate for the on-disk artifact: a loaded file is validated against
// exportProfileSchema before it crosses back to the renderer, and an edited profile is re-validated before
// it is written (LAW 3). This complements the phase-5 loadExportProfile/saveExportProfile (which resolve a
// fixed <projectRoot>/export-profile.json); here the user picks the file explicitly through the dialog.

const PROFILE_FILTER = { name: 'Export Profile', extensions: ['json'] };
const JSON_INDENT = 2;

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

export async function loadExportProfileFromDialog(): Promise<IpcResult<ExportProfileLoadResponse>> {
  const openOptions = {
    title: 'Load Export Profile',
    properties: ['openFile' as const],
    filters: [PROFILE_FILTER],
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

  const validated = exportProfileSchema.safeParse(parsed);
  if (!validated.success) {
    return handlerError(
      `export profile failed validation: ${validated.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return { ok: true, data: { status: 'loaded', profile: validated.data, path } };
}

export async function saveExportProfileFromDialog(
  profile: ExportProfile,
): Promise<IpcResult<ExportProfileSaveResponse>> {
  // The IPC schema already validated the payload against exportProfileSchema; re-validate here as the
  // on-disk gate (defense in depth: this function is the last step before the write).
  const validated = exportProfileSchema.safeParse(profile);
  if (!validated.success) {
    return handlerError(
      `export profile failed validation: ${validated.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  const saveOptions = {
    title: 'Save Export Profile',
    defaultPath: 'export-profile.json',
    filters: [PROFILE_FILTER],
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showSaveDialog(focused, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  try {
    await writeFile(
      result.filePath,
      `${JSON.stringify(validated.data, null, JSON_INDENT)}\n`,
      'utf8',
    );
  } catch {
    return handlerError(`could not write file ${result.filePath}`);
  }
  return { ok: true, data: { status: 'saved', path: result.filePath } };
}
