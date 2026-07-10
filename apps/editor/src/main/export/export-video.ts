import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import type { ExportVideoContainer, ExportWriteVideoResponse, IpcResult } from '../../shared';

// Persist renderer-muxed video bytes (PP-C10 slice 2). The WebCodecs VP9 / H.264 encode + WebM / MP4 mux
// runs in a renderer worker (main has no VideoEncoder); main only owns the save dialog + the disk write,
// keeping the path-injection defense uniform with every other export. The bytes are opaque here (already a
// finished container); main does not decode or re-encode them.

const CONTAINER_FILTER: Record<ExportVideoContainer, { name: string; extensions: string[] }> = {
  webm: { name: 'WebM Video', extensions: ['webm'] },
  mp4: { name: 'MP4 Video', extensions: ['mp4'] },
};

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

export async function writeVideoToFile(
  data: Uint8Array,
  container: ExportVideoContainer,
  defaultName: string,
): Promise<IpcResult<ExportWriteVideoResponse>> {
  const saveOptions = {
    title: `Export ${container.toUpperCase()}`,
    defaultPath: defaultName,
    filters: [CONTAINER_FILTER[container]],
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showSaveDialog(focused, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (result.canceled || result.filePath === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }

  try {
    await writeFile(result.filePath, data);
  } catch {
    return handlerError(`could not write file ${result.filePath}`);
  }
  return { ok: true, data: { status: 'saved', path: result.filePath } };
}
