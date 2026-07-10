import type { AtlasImportPage, ExportColor, ExportVideoContainer } from '../../shared';

// The message protocol between the renderer thread and the video-encode worker (PP-C10 slice 2). Kept in a
// plain module (not the .worker.ts) so both sides import the SAME types without pulling worker-only code
// into the main renderer bundle. The worker renders frames (render-preview), WebCodecs-encodes them, and
// muxes a WebM / MP4 container entirely off the UI thread; the renderer only kicks it off, relays progress,
// and hands the finished bytes to the main process to write.

// The clip to encode. Mirrors the raster media options but always composites onto an OPAQUE background
// (H.264 has no alpha; VP9 alpha is intentionally avoided for compatibility), so `background` is a solid
// color. `animation` null renders the setup pose (then `toFrame` bounds the clip).
export interface VideoEncodeRequest {
  readonly type: 'encode';
  readonly document: unknown;
  readonly pages: readonly AtlasImportPage[];
  readonly container: ExportVideoContainer;
  readonly animation: string | null;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly background: ExportColor;
  readonly bitrate: number;
}

export interface VideoCancelRequest {
  readonly type: 'cancel';
}

export type VideoWorkerRequest = VideoEncodeRequest | VideoCancelRequest;

export interface VideoProgressMessage {
  readonly type: 'progress';
  readonly completed: number;
  readonly total: number;
}

export interface VideoDoneMessage {
  readonly type: 'done';
  readonly data: ArrayBuffer;
  readonly frameCount: number;
}

export interface VideoCanceledMessage {
  readonly type: 'canceled';
}

export interface VideoErrorMessage {
  readonly type: 'error';
  readonly message: string;
}

export type VideoWorkerMessage =
  | VideoProgressMessage
  | VideoDoneMessage
  | VideoCanceledMessage
  | VideoErrorMessage;
