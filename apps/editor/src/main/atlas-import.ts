import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { createNodeFileStore, isAtlasError, runAtlasPipeline } from './atlas';
import { confinePagePath } from './project-textures';
import type { AtlasImportImagesRequest, AtlasImportResponse, IpcResult } from '../shared';

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
// Renderer-supplied images (drag-drop / file picker) are staged here before packing, then removed. Keyed by
// a random id so concurrent imports never collide; app-owned, so it never pollutes the user's assets.
const ATLAS_STAGING_SUBDIR = 'atlas-staging';

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

// Pack a prepared source directory and read the packed page PNGs back into bytes for the sandboxed
// renderer. Shared by directory import and staged-image import. The page read fails the whole import (no
// partial success): the renderer gets every page or a typed error.
async function packAndReadPages(
  sourceDir: string,
  outputDir: string,
): Promise<IpcResult<AtlasImportResponse>> {
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
    const pages = await Promise.all(
      atlas.pages.map(async (page) => ({
        file: page.file,
        data: new Uint8Array(await readFile(join(outputDir, page.file))),
      })),
    );
    return { ok: true, data: { status: 'imported', atlas, pages } };
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
  return packAndReadPages(sourceDir, outputDir);
}

// Import images the renderer supplied as bytes (drag-drop onto the assets panel, or a file-input picker).
// The bytes are staged into an app-owned, per-import staging directory (never the user's assets), then the
// SAME deterministic pack runs on that directory. Each supplied name is untrusted: confinePagePath keeps
// every write inside the staging dir and rejects a name carrying any path component (a plain basename is
// required), so a hostile name cannot write outside staging. The staging directory is always removed
// afterward. Names the pipeline does not recognize as PNG are ignored by the packer (it filters to PNG),
// matching the folder-import behavior.
export async function importAtlasImages(
  images: AtlasImportImagesRequest['images'],
): Promise<IpcResult<AtlasImportResponse>> {
  const importId = randomUUID();
  const stagingDir = join(app.getPath('userData'), ATLAS_STAGING_SUBDIR, importId);
  try {
    await mkdir(stagingDir, { recursive: true });
  } catch {
    return handlerError(`could not create atlas staging directory ${stagingDir}`);
  }

  try {
    for (const image of images) {
      const dest = confinePagePath(stagingDir, image.name);
      if (dest === null) continue; // unsafe name (path component / traversal): skip defensively
      await writeFile(dest, image.data);
    }
    const outputDir = join(app.getPath('userData'), ATLAS_OUTPUT_SUBDIR, `images-${importId}`);
    return await packAndReadPages(stagingDir, outputDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return handlerError(`atlas import failed: ${message}`);
  } finally {
    // Best-effort cleanup of the staging bytes; the packed output lives in the app-owned atlas dir.
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
