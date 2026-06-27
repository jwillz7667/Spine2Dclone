import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { createNodeFileStore, isAtlasError, runAtlasPipeline } from './atlas';
import type { AtlasImportResponse, IpcResult } from '../shared';

// Atlas import runs in the main process only (the renderer is sandboxed, no Node, no Electron). The
// renderer supplies NO filesystem path: the source directory always comes from a main-process dialog
// (path-injection defense, mirroring file-io.ts). The deterministic pack pipeline (runAtlasPipeline) is
// already unit-tested; this handler is the Electron seam around it and returns a typed IpcResult, never a
// bare throw across the wire.

// Packed page PNGs are written under the app's userData directory, never into the user's source folder.
// userData is app-owned and writable on every platform, so importing does not pollute the user's assets
// and needs no second "where to save" dialog (which would also widen the path-injection surface). The
// subdirectory is keyed by the source folder's basename; re-importing the same folder overwrites
// deterministically (same input produces the same pages), which is correct since SetAtlasRef replaces the
// whole atlas anyway.
const ATLAS_OUTPUT_SUBDIR = 'atlas';

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

export async function importAtlasFromDirectory(): Promise<IpcResult<AtlasImportResponse>> {
  const openOptions = {
    title: 'Import Sprites',
    properties: ['openDirectory' as const],
  };
  // showOpenDialog has parent-window and no-parent overloads; a focused window may not exist, so dispatch
  // to the matching overload rather than pass BrowserWindow | undefined (mirrors file-io.ts).
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const sourceDir = result.filePaths[0];
  if (result.canceled || sourceDir === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  const outputDir = join(app.getPath('userData'), ATLAS_OUTPUT_SUBDIR, basename(sourceDir));
  try {
    await mkdir(outputDir, { recursive: true });
  } catch {
    return handlerError(`could not create atlas output directory ${outputDir}`);
  }

  try {
    const atlas = await runAtlasPipeline({
      sourceDir,
      outputDir,
      fileStore: createNodeFileStore(),
    });
    return { ok: true, data: { status: 'imported', atlas } };
  } catch (error) {
    // The pack pipeline throws a typed AtlasError carrying a stable code; surface the code so the renderer
    // notice is actionable. Any other failure is reported with its message.
    if (isAtlasError(error)) {
      return handlerError(`atlas import failed (${error.code}): ${error.message}`);
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    return handlerError(`atlas import failed: ${message}`);
  }
}
