import type { ExportVideoContainer } from '../../shared';

// The deterministic frame-timing math for WebM / MP4 export (PP-C10 slice 2). WebCodecs' VideoEncoder and
// the WebM/MP4 muxers work in integer MICROSECONDS; feeding drifting or non-monotonic timestamps produces
// stutter or a muxer rejection. This module is the single source of that timing and the codec strings, kept
// PURE (no WebCodecs, no DOM) so it is unit-testable headless even though the encode itself runs only in a
// Chromium renderer worker. The frame renderer (render-preview) emits frames at fixed 1/fps steps, so the
// timestamps are a pure function of (fps, frameCount): timestamp[i] = round(i * 1e6 / fps), and each
// frame's duration is the gap to the next timestamp (the last frame takes the nominal 1e6/fps), which is
// drift-free (timestamps never accumulate rounding error) and strictly monotonic.

const MICROS_PER_SECOND = 1_000_000;
const MIN_FPS = 1;
const MAX_FPS = 120;
const MAX_DIMENSION = 4096;

export interface VideoTimingParams {
  readonly fps: number;
  readonly frameCount: number;
}

// One frame's presentation timestamp and duration, both in integer microseconds.
export interface FrameTiming {
  readonly index: number;
  readonly timestampMicros: number;
  readonly durationMicros: number;
}

export interface VideoTiming {
  readonly fps: number;
  readonly frameCount: number;
  readonly frames: readonly FrameTiming[];
  readonly totalDurationMicros: number;
}

// The nominal (rounded) microsecond duration of a single frame at this fps. Used for the final frame,
// whose "next timestamp" does not exist.
export function nominalFrameDurationMicros(fps: number): number {
  return Math.round(MICROS_PER_SECOND / fps);
}

function timestampMicrosAt(index: number, fps: number): number {
  return Math.round((index * MICROS_PER_SECOND) / fps);
}

// Compute the full per-frame timing. Throws on out-of-range inputs (the caller validates first via
// validateVideoTiming; this guard makes a misuse fail loudly rather than emit garbage timestamps).
export function computeVideoTiming(params: VideoTimingParams): VideoTiming {
  const { fps, frameCount } = params;
  if (!Number.isInteger(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    throw new RangeError(`fps must be an integer in [${MIN_FPS}, ${MAX_FPS}], got ${fps}`);
  }
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new RangeError(`frameCount must be a positive integer, got ${frameCount}`);
  }

  const frames: FrameTiming[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const timestampMicros = timestampMicrosAt(i, fps);
    const durationMicros =
      i + 1 < frameCount
        ? timestampMicrosAt(i + 1, fps) - timestampMicros
        : nominalFrameDurationMicros(fps);
    frames.push({ index: i, timestampMicros, durationMicros });
  }
  const last = frames[frames.length - 1]!;
  return {
    fps,
    frameCount,
    frames,
    totalDurationMicros: last.timestampMicros + last.durationMicros,
  };
}

export interface VideoValidationParams {
  readonly fps: number;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
}

// Validate the video export parameters. Returns every problem so the dialog can list them all. WebCodecs
// H.264/VP9 encoders require even dimensions (chroma subsampling), so an odd width/height is rejected here
// rather than failing opaquely inside the encoder.
export function validateVideoTiming(params: VideoValidationParams): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(params.fps) || params.fps < MIN_FPS || params.fps > MAX_FPS) {
    errors.push(`Frame rate must be a whole number between ${MIN_FPS} and ${MAX_FPS}.`);
  }
  if (!Number.isInteger(params.frameCount) || params.frameCount < 1) {
    errors.push('The frame range must contain at least one frame.');
  }
  for (const [label, value] of [
    ['Width', params.width],
    ['Height', params.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 2 || value > MAX_DIMENSION) {
      errors.push(`${label} must be a whole number between 2 and ${MAX_DIMENSION}.`);
    } else if (value % 2 !== 0) {
      errors.push(`${label} must be even for video encoding (got ${value}).`);
    }
  }
  return errors;
}

// The codec strings the two paths need. `webCodecs` configures the WebCodecs VideoEncoder; `muxer` is the
// codec token the container muxer expects. VP9 profile 0, 8-bit (vp09.00.10.08) for WebM; H.264
// Constrained Baseline level 3.1 (avc1.42001f) for MP4, the widest-compatibility pairing.
export interface VideoCodec {
  readonly webCodecs: string;
  readonly webmMuxer: 'V_VP9';
  readonly mp4Muxer: 'avc';
}

export function videoCodecFor(container: ExportVideoContainer): VideoCodec {
  return container === 'webm'
    ? { webCodecs: 'vp09.00.10.08', webmMuxer: 'V_VP9', mp4Muxer: 'avc' }
    : { webCodecs: 'avc1.42001f', webmMuxer: 'V_VP9', mp4Muxer: 'avc' };
}

// A reasonable target bitrate (bits per second) for the given frame size and rate. Scales with pixel
// throughput so a small clip is not overallocated and a large one is not starved. Bounded to a sane range.
export function suggestedBitrate(width: number, height: number, fps: number): number {
  const bitsPerPixelPerFrame = 0.1;
  const raw = Math.round(width * height * fps * bitsPerPixelPerFrame);
  const min = 500_000;
  const max = 40_000_000;
  return Math.min(max, Math.max(min, raw));
}
