import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { validateDocument } from '@marionette/format';
import type { AtlasPage } from '@marionette/format/types';
import { BrowserWindow, dialog } from 'electron';
import type { AtlasImportPage, FileOpenResponse, FileSaveResponse, IpcResult } from '../shared';
import { confinePagePath, texturesDirFor } from './project-textures';

// File IO lives in the main process only (the renderer is sandboxed, no Node). The renderer never
// supplies a filesystem path: the path always comes from a main-process dialog (path-injection
// defense). Documents are validated with @marionette/format at this boundary before any write or
// after any read, so a malformed payload or a corrupt file fails loudly with a typed IPC error.
// node:path keeps file names portable across macOS and Windows.

const FILE_FILTERS = [
  { name: 'Armature 2D Skeleton', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] },
];

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

function validationMessage(prefix: string, codes: readonly string[]): string {
  return `${prefix}: ${codes.join(', ')}`;
}

// Persist the atlas page PNGs into the project's sibling textures directory (PP-D5) so a later open can
// restore the textures. Every destination is confined to the textures dir (confinePagePath), which is
// derived from the main-controlled save path; an unsafe page name is skipped defensively. A write failure
// surfaces (the JSON is already saved, but the caller reports the incomplete texture set) rather than
// silently losing pixels.
async function writeProjectPages(
  projectPath: string,
  pages: readonly AtlasImportPage[],
): Promise<string | null> {
  if (pages.length === 0) return null;
  const texturesDir = texturesDirFor(projectPath);
  try {
    await mkdir(texturesDir, { recursive: true });
  } catch {
    return `could not create textures directory ${texturesDir}`;
  }
  for (const page of pages) {
    const dest = confinePagePath(texturesDir, page.file);
    if (dest === null) continue;
    try {
      await writeFile(dest, page.data);
    } catch {
      return `could not write texture page ${page.file}`;
    }
  }
  return null;
}

// Read back the atlas page PNGs for an opening project from its sibling textures directory (PP-D5). Each
// page listed in the document's atlas is confined to the textures dir; a missing or unreadable page is
// skipped (a partial or absent set is fine, the viewport shows the placeholder for what is missing).
async function readProjectPages(
  projectPath: string,
  atlasPages: readonly AtlasPage[],
): Promise<AtlasImportPage[]> {
  const texturesDir = texturesDirFor(projectPath);
  const pages: AtlasImportPage[] = [];
  for (const page of atlasPages) {
    const src = confinePagePath(texturesDir, page.file);
    if (src === null) continue;
    try {
      pages.push({ file: page.file, data: new Uint8Array(await readFile(src)) });
    } catch {
      // Missing or unreadable page: skip; the renderer keeps the placeholder for that page.
    }
  }
  return pages;
}

export async function saveDocumentToFile(
  document: unknown,
  pages: readonly AtlasImportPage[],
): Promise<IpcResult<FileSaveResponse>> {
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

  const pageError = await writeProjectPages(result.filePath, pages);
  if (pageError !== null) {
    return handlerError(`saved ${result.filePath} but ${pageError}`);
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

  const pages = await readProjectPages(path, report.document.atlas.pages);
  return {
    ok: true,
    data: { status: 'opened', name: basename(path), document: report.document, pages },
  };
}
