import {
  renderSequence,
  type AtlasPagePixels,
  type AtlasPixelSource,
  type RenderSequenceOptions,
} from '@marionette/render-preview';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMTarget } from 'webm-muxer';
import { computeVideoTiming, suggestedBitrate, videoCodecFor } from './video-timing';
import type {
  VideoEncodeRequest,
  VideoWorkerMessage,
  VideoWorkerRequest,
} from './video-encode-protocol';

// The video-encode worker (PP-C10 slice 2): the ONE place WebM (VP9) / MP4 (H.264) export happens. It runs
// entirely off the UI thread. render-preview (pure TS, no DOM) rasterizes each frame to RGBA; a WebCodecs
// VideoEncoder (Chromium built-in, no dependency) encodes it; a pinned pure-JS muxer (webm-muxer /
// mp4-muxer, both MIT) wraps the chunks into a container. Frame timing comes from the deterministic
// video-timing module so the encoded presentation timestamps are drift-free and monotonic.
//
// HEADLESS-VERIFIABILITY NOTE: VideoEncoder + VideoFrame exist only in a Chromium context, so this file is
// NOT exercised by the Node test suite (the same carve-out class as WebGL pixel parity, per CLAUDE.md). Its
// deterministic inputs (frame timing, codec selection, option validation) ARE covered by video-timing's
// unit tests; only the Chromium encode + mux is edge-only.

// The worker global surface we use, obtained without touching `self` (whose DOM-lib typing conflicts with
// the worker scope). Strict, no `any`.
interface WorkerScope {
  postMessage(message: VideoWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { data: VideoWorkerRequest }) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

let canceled = false;

ctx.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'cancel') {
    canceled = true;
    return;
  }
  void encode(request);
});

// Decode a page PNG to straight-alpha RGBA using the worker's native codec (createImageBitmap +
// OffscreenCanvas), so the worker never imports the Node-only atlas-pack file store. A page that fails to
// decode is skipped (the region falls back to render-preview's white placeholder, parity with the
// main-process media core, which decodes via atlas-pack in Node instead).
async function toAtlasPixelSource(pages: VideoEncodeRequest['pages']): Promise<AtlasPixelSource> {
  const map = new Map<string, AtlasPagePixels>();
  for (const page of pages) {
    try {
      const bitmap = await createImageBitmap(new Blob([page.data]));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (context === null) continue;
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      map.set(page.file, {
        width: bitmap.width,
        height: bitmap.height,
        rgba: new Uint8Array(image.data.buffer.slice(0)),
      });
      bitmap.close();
    } catch {
      // Skip an undecodable page.
    }
  }
  return { pages: map };
}

function sequenceOptions(
  request: VideoEncodeRequest,
  atlas: AtlasPixelSource,
): RenderSequenceOptions {
  return {
    document: request.document,
    atlas,
    viewport: { width: request.width, height: request.height, fit: 'content' },
    // Video has no alpha channel here: composite onto the opaque background.
    background: request.background,
    fps: request.fps,
    from: { frame: request.fromFrame },
    to: { frame: request.toFrame },
    ...(request.animation !== null ? { animation: request.animation } : {}),
  };
}

async function encode(request: VideoEncodeRequest): Promise<void> {
  canceled = false;
  try {
    const atlas = await toAtlasPixelSource(request.pages);
    const sequence = renderSequence(sequenceOptions(request, atlas));
    const frameCount = sequence.frameCount;
    const timing = computeVideoTiming({ fps: request.fps, frameCount });
    const codec = videoCodecFor(request.container);
    const bitrate =
      request.bitrate > 0
        ? request.bitrate
        : suggestedBitrate(request.width, request.height, request.fps);

    const { addChunk, finalize } = makeMuxer(request, codec.webmMuxer);

    const encoder = new VideoEncoder({
      output: (chunk, meta) => addChunk(chunk, meta),
      error: (error) => ctx.postMessage({ type: 'error', message: error.message }),
    });
    encoder.configure({
      codec: codec.webCodecs,
      width: request.width,
      height: request.height,
      bitrate,
      framerate: request.fps,
    });

    // A keyframe at the start and roughly once per second keeps seeking usable without bloating the file.
    const keyEvery = Math.max(1, request.fps);
    let index = 0;
    for (const frame of sequence.frames()) {
      if (canceled) {
        encoder.close();
        ctx.postMessage({ type: 'canceled' });
        return;
      }
      const timestamp = timing.frames[index]!;
      const videoFrame = new VideoFrame(frame.rgba, {
        format: 'RGBA',
        codedWidth: request.width,
        codedHeight: request.height,
        timestamp: timestamp.timestampMicros,
        duration: timestamp.durationMicros,
      });
      encoder.encode(videoFrame, { keyFrame: index % keyEvery === 0 });
      videoFrame.close();
      index += 1;
      ctx.postMessage({ type: 'progress', completed: index, total: frameCount });
    }

    await encoder.flush();
    encoder.close();
    const data = finalize();
    ctx.postMessage({ type: 'done', data, frameCount }, [data]);
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'video encode failed',
    });
  }
}

// Build the container-specific muxer behind a uniform addChunk/finalize surface. WebM takes VP9 chunks,
// MP4 takes H.264 chunks; both accept the WebCodecs EncodedVideoChunk + metadata directly.
function makeMuxer(
  request: VideoEncodeRequest,
  webmCodec: 'V_VP9',
): {
  addChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined): void;
  finalize(): ArrayBuffer;
} {
  if (request.container === 'webm') {
    const target = new WebMTarget();
    const muxer = new WebMMuxer({
      target,
      video: {
        codec: webmCodec,
        width: request.width,
        height: request.height,
        frameRate: request.fps,
      },
      firstTimestampBehavior: 'offset',
    });
    return {
      addChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      finalize: () => {
        muxer.finalize();
        return target.buffer;
      },
    };
  }
  const target = new Mp4Target();
  const muxer = new Mp4Muxer({
    target,
    video: { codec: 'avc', width: request.width, height: request.height },
    fastStart: 'in-memory',
  });
  return {
    addChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    finalize: () => {
      muxer.finalize();
      return target.buffer;
    },
  };
}
