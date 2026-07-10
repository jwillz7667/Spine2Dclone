import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import type { ExportProjectFormat, ExportProjectResponse, IpcResult } from '../../shared';
import { buildProjectExport, type ProjectExportArtifact } from './project-export-build';

// The Electron seam around the pure project-export builder (project-export-build.ts). The renderer never
// supplies a path: the path always comes from a main-process save dialog (path-injection defense,
// mirroring file-io.ts). A user cancel is a normal 'canceled' outcome, not an error.

const FORMAT_FILTERS: Record<ProjectExportArtifact['ext'], { name: string; extensions: string[] }> =
  {
    mrnt: { name: 'Armature 2D Binary', extensions: ['mrnt'] },
    json: { name: 'Armature 2D Skeleton', extensions: ['json'] },
  };

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

export async function exportProjectToFile(
  document: unknown,
  format: ExportProjectFormat,
): Promise<IpcResult<ExportProjectResponse>> {
  const built = buildProjectExport(document, format);
  if (!built.ok) return handlerError(built.message);

  const saveOptions = {
    title: 'Export Project',
    defaultPath: built.artifact.defaultName,
    filters: [FORMAT_FILTERS[built.artifact.ext]],
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showSaveDialog(focused, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  try {
    await writeFile(result.filePath, built.artifact.bytes);
  } catch {
    return handlerError(`could not write file ${result.filePath}`);
  }
  return { ok: true, data: { status: 'saved', path: result.filePath } };
}
