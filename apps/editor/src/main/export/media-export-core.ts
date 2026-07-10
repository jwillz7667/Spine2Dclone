import { decodePng } from '@marionette/atlas-pack';
import {
  encodeApng,
  encodeGif,
  renderSequence,
  TRANSPARENT,
  type AtlasPagePixels,
  type AtlasPixelSource,
  type GifEncodeOptions,
  type RenderedSequence,
  type RenderSequenceOptions,
  type SequenceFrame,
} from '@marionette/render-preview';
import type { AtlasImportPage, MediaExportOptions } from '../../shared';

// The PURE media-export pipeline (PP-D6, over the PP-C10 slice-1 render-preview backend). It decodes the
// atlas page bytes to a pixel source, builds a deterministic RenderedSequence from the dialog options, and
// either encodes a single animated image (GIF / APNG) or streams a PNG sequence frame by frame to a sink.
// It holds NO Electron and NO filesystem: the dialog + disk writes live in the Electron wrapper
// (media-export.ts), so this core is unit-testable headless exactly like the render-preview media tests.
// Progress + cancellation are injected: the frame walk is wrapped so a pulled frame reports progress and
// an aborted signal throws MediaExportAbortedError (checked between frames, never mid-frame).

// Thrown when the injected AbortSignal fires between frames. The Electron wrapper maps it to a 'canceled'
// IPC result; the renderer treats cancel as a normal outcome, not an error.
export class MediaExportAbortedError extends Error {
  constructor() {
    super('media export aborted');
    this.name = 'MediaExportAbortedError';
  }
}

// A PNG-sequence frame sink. Called once per frame in index order; a rejected promise fails the export.
export interface MediaExportSink {
  writeFrame(index: number, png: Uint8Array): Promise<void>;
}

export interface MediaExportControl {
  readonly signal?: AbortSignal;
  onProgress?(completed: number, total: number): void;
}

export type MediaExportResult =
  | { readonly kind: 'single'; readonly bytes: Uint8Array; readonly frameCount: number }
  | { readonly kind: 'sequence'; readonly frameCount: number };

export interface RunMediaExportParams {
  readonly document: unknown;
  readonly pages: readonly AtlasImportPage[];
  readonly options: MediaExportOptions;
  readonly sink: MediaExportSink;
  readonly control?: MediaExportControl;
}

// Decode the atlas page PNG bytes into the render-preview pixel source. A page that fails to decode is
// skipped (the region renders as the white placeholder, matching runtime-web's unresolved-texture path),
// so a partially-corrupt atlas still previews rather than failing the whole export.
function toAtlasPixelSource(pages: readonly AtlasImportPage[]): AtlasPixelSource {
  const map = new Map<string, AtlasPagePixels>();
  for (const page of pages) {
    try {
      const decoded = decodePng(page.data);
      map.set(page.file, { width: decoded.width, height: decoded.height, rgba: decoded.rgba });
    } catch {
      // Skip an undecodable page; the region falls back to the placeholder sampler.
    }
  }
  return { pages: map };
}

function buildSequenceOptions(
  document: unknown,
  atlas: AtlasPixelSource,
  options: MediaExportOptions,
): RenderSequenceOptions {
  return {
    document,
    atlas,
    viewport: { width: options.width, height: options.height, fit: 'content' },
    background: options.background ?? TRANSPARENT,
    fps: options.fps,
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    // null animation renders the setup pose (render-preview treats an omitted animation as setup pose).
    ...(options.animation !== null ? { animation: options.animation } : {}),
  };
}

// Wrap a RenderedSequence so every pulled frame checks the abort signal and reports progress. The counter
// resets each time frames() is re-iterated (a global-palette GIF walks the clip twice), so progress always
// reflects the current pass over `frameCount` frames. The wrapper delegates all metadata to the source and
// only interposes on the frame stream.
function withProgress(
  sequence: RenderedSequence,
  control: MediaExportControl | undefined,
): RenderedSequence {
  const total = sequence.frameCount;
  function* frames(): Generator<SequenceFrame> {
    let completed = 0;
    for (const frame of sequence.frames()) {
      if (control?.signal?.aborted === true) throw new MediaExportAbortedError();
      yield frame;
      completed += 1;
      control?.onProgress?.(completed, total);
    }
  }
  return {
    frameCount: sequence.frameCount,
    fps: sequence.fps,
    width: sequence.width,
    height: sequence.height,
    durationSeconds: sequence.durationSeconds,
    frames,
    forEach(onFrame: (frame: SequenceFrame) => void): void {
      for (const frame of frames()) onFrame(frame);
    },
  };
}

function toGifOptions(options: MediaExportOptions): GifEncodeOptions {
  const gif = options.gif;
  if (gif === undefined) return { transparency: 'auto' };
  return {
    palette: gif.palette,
    loopCount: gif.loopCount,
    alphaThreshold: gif.alphaThreshold,
    transparency: 'auto',
  };
}

export async function runMediaExport(params: RunMediaExportParams): Promise<MediaExportResult> {
  const { document, pages, options, sink, control } = params;
  const atlas = toAtlasPixelSource(pages);
  const base = renderSequence(buildSequenceOptions(document, atlas, options));
  const sequence = withProgress(base, control);
  const frameCount = sequence.frameCount;

  if (options.medium === 'gif') {
    return { kind: 'single', bytes: encodeGif(sequence, toGifOptions(options)), frameCount };
  }
  if (options.medium === 'apng') {
    const loopCount = options.apng?.loopCount ?? 0;
    return { kind: 'single', bytes: encodeApng(sequence, { loopCount }), frameCount };
  }

  // png-sequence: stream each frame's PNG to the sink in order (progress + abort handled by the wrapper).
  for (const frame of sequence.frames()) {
    await sink.writeFrame(frame.index, frame.png());
  }
  return { kind: 'sequence', frameCount };
}
