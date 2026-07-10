import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RenderPreviewError } from '@marionette/render-preview';
import { BrowserWindow, dialog, type WebContents } from 'electron';
import {
  IpcChannel,
  type AtlasImportPage,
  type ExportCancelResponse,
  type ExportMediaResponse,
  type IpcResult,
  type MediaExportOptions,
} from '../../shared';
import { MediaExportAbortedError, runMediaExport, type MediaExportSink } from './media-export-core';

// The Electron seam around the pure media-export core (PP-D6): it owns the save dialog (path-injection
// defense, mirroring file-io.ts), the disk writes, the progress push (export:progress by job id), and the
// cancel registry (export:cancel aborts the in-flight AbortController). One export per job id; only one is
// realistically in flight at a time, but the registry is keyed so a stale cancel never aborts a new job.

const inFlight = new Map<string, AbortController>();

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

const MEDIA_FILE_FILTER: Record<'gif' | 'apng', { name: string; extensions: string[] }> = {
  gif: { name: 'Animated GIF', extensions: ['gif'] },
  apng: { name: 'Animated PNG', extensions: ['png'] },
};

// Zero-padded frame filename, deterministic and lexically sortable. Padding width follows the frame count
// so `frame_0000.png` .. `frame_0119.png` stays aligned for a 120-frame clip.
function frameFileName(index: number, frameCount: number): string {
  const width = Math.max(4, String(frameCount - 1).length);
  return `frame_${String(index).padStart(width, '0')}.png`;
}

function baseName(options: MediaExportOptions): string {
  return options.animation ?? 'setup-pose';
}

async function pickSingleFilePath(
  medium: 'gif' | 'apng',
  options: MediaExportOptions,
): Promise<string | null> {
  const ext = medium === 'gif' ? 'gif' : 'png';
  const saveOptions = {
    title: `Export ${medium.toUpperCase()}`,
    defaultPath: `${baseName(options)}.${ext}`,
    filters: [MEDIA_FILE_FILTER[medium]],
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showSaveDialog(focused, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  return result.canceled || result.filePath === undefined ? null : result.filePath;
}

async function pickOutputDirectory(): Promise<string | null> {
  const openOptions = {
    title: 'Export PNG Sequence (choose an output folder)',
    properties: ['openDirectory' as const, 'createDirectory' as const],
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const dir = result.filePaths[0];
  return result.canceled || dir === undefined ? null : dir;
}

// Map a thrown export failure to a typed IpcResult. MediaExportAbortedError is a user cancel (normal
// outcome); a render-preview error surfaces its stable code; anything else surfaces its message.
function mapExportError(error: unknown): IpcResult<ExportMediaResponse> {
  if (error instanceof MediaExportAbortedError) {
    return { ok: true, data: { status: 'canceled' } };
  }
  if (error instanceof RenderPreviewError) {
    return handlerError(`media export failed (${error.code}): ${error.message}`);
  }
  const message = error instanceof Error ? error.message : 'unknown error';
  return handlerError(`media export failed: ${message}`);
}

export async function exportMediaToFile(
  sender: WebContents,
  jobId: string,
  document: unknown,
  pages: readonly AtlasImportPage[],
  options: MediaExportOptions,
): Promise<IpcResult<ExportMediaResponse>> {
  const controller = new AbortController();
  inFlight.set(jobId, controller);

  const onProgress = (completed: number, total: number): void => {
    if (!sender.isDestroyed()) {
      sender.send(IpcChannel.exportProgress, { jobId, completed, total });
    }
  };

  try {
    if (options.medium === 'gif' || options.medium === 'apng') {
      const filePath = await pickSingleFilePath(options.medium, options);
      if (filePath === null) return { ok: true, data: { status: 'canceled' } };

      // The single-image encoders never call the sink; a defensive sink makes a stray call fail loudly.
      const sink: MediaExportSink = {
        writeFrame: () =>
          Promise.reject(new Error('unexpected frame sink call for single-image export')),
      };
      const result = await runMediaExport({
        document,
        pages,
        options,
        sink,
        control: { signal: controller.signal, onProgress },
      });
      if (result.kind !== 'single') return handlerError('expected a single-image export result');
      await writeFile(filePath, result.bytes);
      return {
        ok: true,
        data: { status: 'saved', paths: [filePath], frameCount: result.frameCount },
      };
    }

    const outputDir = await pickOutputDirectory();
    if (outputDir === null) return { ok: true, data: { status: 'canceled' } };
    await mkdir(outputDir, { recursive: true });

    const written: string[] = [];
    const sink: MediaExportSink = {
      async writeFrame(index, png) {
        // frameCount is not known to the sink; pad on a running basis is unstable, so pad on index alone
        // to a fixed 5 digits (covers the render-preview MAX_SEQUENCE_FRAMES cap of 216000).
        const name = frameFileName(index, 100000);
        const dest = join(outputDir, name);
        await writeFile(dest, png);
        written.push(dest);
      },
    };
    const result = await runMediaExport({
      document,
      pages,
      options,
      sink,
      control: { signal: controller.signal, onProgress },
    });
    if (result.kind !== 'sequence' || written.length === 0) {
      return handlerError('PNG sequence export produced no frames');
    }
    return {
      ok: true,
      data: {
        status: 'saved',
        paths: written as [string, ...string[]],
        frameCount: result.frameCount,
      },
    };
  } catch (error) {
    return mapExportError(error);
  } finally {
    inFlight.delete(jobId);
  }
}

// Abort the in-flight export with this id, if any. Returns whether a job was actually aborted.
export function cancelMediaExport(jobId: string): IpcResult<ExportCancelResponse> {
  const controller = inFlight.get(jobId);
  if (controller === undefined) return { ok: true, data: { canceled: false } };
  controller.abort();
  return { ok: true, data: { canceled: true } };
}
