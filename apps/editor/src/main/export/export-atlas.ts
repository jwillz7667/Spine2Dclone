import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import {
  ATLAS_TARGETS_MANIFEST_FILE,
  createNodeFileStore,
  type AtlasFileStore,
} from '@marionette/atlas-pack';
import type { ExportAtlasResponse, ExportProfile, IpcResult } from '../../shared';
import { runProfileAtlasExport } from './atlas-export-build';

// The Electron seam around the pure profile-driven atlas-export core (atlas-export-build.ts). The renderer
// supplies NO filesystem path: the source-sprites directory and the output directory both come from
// main-process dialogs (path-injection defense, mirroring atlas-import.ts). A user cancel at either dialog
// is a normal 'canceled' outcome, not an error. The pure core is unit-tested with an in-memory store; this
// seam only wires the dialogs, the node file store, and the typed IpcResult.

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

async function pickDirectory(title: string): Promise<string | null> {
  const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, options)
    : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  return result.canceled || path === undefined ? null : path;
}

// The node file store does not create parent directories, but runAtlasExport writes downscale pages into
// per-variant subfolders (e.g. '@0.5x/'); ensure each parent exists before delegating the write.
function parentEnsuringFileStore(): AtlasFileStore {
  const base = createNodeFileStore();
  return {
    readBytes: base.readBytes,
    listDir: base.listDir,
    writeBytes: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await base.writeBytes(path, data);
    },
  };
}

export async function exportAtlasWithProfile(
  profile: ExportProfile,
): Promise<IpcResult<ExportAtlasResponse>> {
  const sourceDir = await pickDirectory('Select Source Sprites');
  if (sourceDir === null) return { ok: true, data: { status: 'canceled' } };

  const outputDir = await pickDirectory('Select Atlas Output Folder');
  if (outputDir === null) return { ok: true, data: { status: 'canceled' } };

  const built = await runProfileAtlasExport({
    sourceDir,
    outputDir,
    fileStore: parentEnsuringFileStore(),
    profile,
  });
  if (!built.ok) return handlerError(built.message);

  // Every variant page written on disk (canonical + downscales), relative to the output dir. The manifest
  // is 1.0-first and always has at least the canonical page, so pageFiles is non-empty.
  const pageFiles = built.result.manifest.variants.flatMap((variant) =>
    variant.pages.map((page) => page.file),
  );
  const [first, ...rest] = pageFiles;
  if (first === undefined) {
    return handlerError('atlas export produced no pages');
  }

  return {
    ok: true,
    data: {
      status: 'exported',
      outputDir,
      pageFiles: [first, ...rest],
      manifestFile: ATLAS_TARGETS_MANIFEST_FILE,
      diagnostics: built.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        target: diagnostic.target,
        message: diagnostic.message,
      })),
    },
  };
}
