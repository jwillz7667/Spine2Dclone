import { describe, expect, it, vi } from 'vitest';
import { MediaExportAbortedError, runMediaExport, type MediaExportSink } from './media-export-core';
import { spinAtlasPages, validSpinDocument } from './export-fixtures';
import type { MediaExportOptions } from '../../shared';

// Headless tests for the pure media-export pipeline (the Electron dialog + disk sink live in
// media-export.ts). A collecting sink stands in for the filesystem, so PNG-sequence writes, GIF/APNG
// encode, progress reporting, and mid-clip cancellation are all exercised without Electron.

function collectingSink(): { sink: MediaExportSink; frames: { index: number; png: Uint8Array }[] } {
  const frames: { index: number; png: Uint8Array }[] = [];
  const sink: MediaExportSink = {
    writeFrame: async (index, png) => {
      // Copy: the sequence reuses one scratch buffer per frame, so retain a snapshot.
      frames.push({ index, png: png.slice() });
    },
  };
  return { sink, frames };
}

const baseOptions = {
  animation: 'spin',
  fps: 8,
  width: 32,
  height: 32,
  from: { frame: 0 },
  to: { frame: 4 },
  background: null,
} as const;

function options(overrides: Partial<MediaExportOptions>): MediaExportOptions {
  return { medium: 'png-sequence', ...baseOptions, ...overrides } as MediaExportOptions;
}

describe('runMediaExport', () => {
  it('streams a PNG sequence frame by frame and reports progress for each', async () => {
    const { sink, frames } = collectingSink();
    const onProgress = vi.fn();

    const result = await runMediaExport({
      document: validSpinDocument(),
      pages: spinAtlasPages(),
      options: options({ medium: 'png-sequence' }),
      sink,
      control: { onProgress },
    });

    expect(result).toEqual({ kind: 'sequence', frameCount: 4 });
    expect(frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    // Each frame is a non-empty PNG (starts with the PNG signature byte).
    expect(frames.every((f) => f.png.length > 8 && f.png[0] === 0x89)).toBe(true);
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });

  it('encodes a GIF as a single image (no sink writes)', async () => {
    const { sink, frames } = collectingSink();

    const result = await runMediaExport({
      document: validSpinDocument(),
      pages: spinAtlasPages(),
      options: options({
        medium: 'gif',
        gif: { palette: 'global', loopCount: 0, alphaThreshold: 0.5 },
      }),
      sink,
    });

    expect(result.kind).toBe('single');
    if (result.kind !== 'single') return;
    expect(result.frameCount).toBe(4);
    // GIF89a magic header.
    expect(new TextDecoder().decode(result.bytes.subarray(0, 6))).toBe('GIF89a');
    expect(frames).toHaveLength(0);
  });

  it('encodes an APNG as a single image with the PNG signature', async () => {
    const { sink } = collectingSink();

    const result = await runMediaExport({
      document: validSpinDocument(),
      pages: spinAtlasPages(),
      options: options({ medium: 'apng', apng: { loopCount: 0 } }),
      sink,
    });

    expect(result.kind).toBe('single');
    if (result.kind !== 'single') return;
    expect(Array.from(result.bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('throws MediaExportAbortedError when the signal is already aborted', async () => {
    const { sink } = collectingSink();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runMediaExport({
        document: validSpinDocument(),
        pages: spinAtlasPages(),
        options: options({ medium: 'png-sequence' }),
        sink,
        control: { signal: controller.signal },
      }),
    ).rejects.toBeInstanceOf(MediaExportAbortedError);
  });

  it('aborts mid-sequence and stops pulling frames', async () => {
    const { frames } = collectingSink();
    const controller = new AbortController();
    // Abort after the second written frame.
    const sink: MediaExportSink = {
      writeFrame: async (index, png) => {
        frames.push({ index, png: png.slice() });
        if (index === 1) controller.abort();
      },
    };

    await expect(
      runMediaExport({
        document: validSpinDocument(),
        pages: spinAtlasPages(),
        options: options({ medium: 'png-sequence', to: { frame: 8 } }),
        sink,
        control: { signal: controller.signal },
      }),
    ).rejects.toBeInstanceOf(MediaExportAbortedError);
    // Frames 0 and 1 were written before the abort was observed at the next frame boundary.
    expect(frames.map((f) => f.index)).toEqual([0, 1]);
  });
});
