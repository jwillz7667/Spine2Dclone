import { describe, expect, it } from 'vitest';
import {
  computeVideoTiming,
  nominalFrameDurationMicros,
  suggestedBitrate,
  validateVideoTiming,
  videoCodecFor,
} from './video-timing';

describe('computeVideoTiming', () => {
  it('emits monotonic, drift-free microsecond timestamps at 30 fps', () => {
    const timing = computeVideoTiming({ fps: 30, frameCount: 4 });

    expect(timing.frames.map((f) => f.timestampMicros)).toEqual([0, 33333, 66667, 100000]);
    // Durations are the gaps between successive timestamps; the last is the nominal frame duration.
    expect(timing.frames.map((f) => f.durationMicros)).toEqual([33333, 33334, 33333, 33333]);
    expect(timing.totalDurationMicros).toBe(133333);
  });

  it('keeps timestamps exactly on the second boundary for integer fps', () => {
    const timing = computeVideoTiming({ fps: 25, frameCount: 25 });

    // Frame 25 would be exactly 1s; frame 24 (last) sits one nominal step before it.
    expect(timing.frames[0]!.timestampMicros).toBe(0);
    expect(timing.frames[24]!.timestampMicros).toBe(960000);
    expect(nominalFrameDurationMicros(25)).toBe(40000);
  });

  it('is strictly increasing across a long clip (no repeated timestamps)', () => {
    const timing = computeVideoTiming({ fps: 60, frameCount: 300 });
    for (let i = 1; i < timing.frames.length; i += 1) {
      expect(timing.frames[i]!.timestampMicros).toBeGreaterThan(
        timing.frames[i - 1]!.timestampMicros,
      );
    }
  });

  it('throws on invalid inputs', () => {
    expect(() => computeVideoTiming({ fps: 0, frameCount: 1 })).toThrow(RangeError);
    expect(() => computeVideoTiming({ fps: 30, frameCount: 0 })).toThrow(RangeError);
  });
});

describe('validateVideoTiming', () => {
  it('accepts even dimensions and rejects odd ones', () => {
    expect(validateVideoTiming({ fps: 30, frameCount: 10, width: 512, height: 512 })).toEqual([]);
    const odd = validateVideoTiming({ fps: 30, frameCount: 10, width: 513, height: 512 });
    expect(odd.some((e) => e.includes('even'))).toBe(true);
  });

  it('rejects an out-of-range fps and an empty range', () => {
    expect(
      validateVideoTiming({ fps: 240, frameCount: 10, width: 100, height: 100 }).length,
    ).toBeGreaterThan(0);
    expect(
      validateVideoTiming({ fps: 30, frameCount: 0, width: 100, height: 100 }).length,
    ).toBeGreaterThan(0);
  });
});

describe('codec + bitrate selection', () => {
  it('maps containers to their WebCodecs + muxer codec tokens', () => {
    expect(videoCodecFor('webm').webCodecs).toBe('vp09.00.10.08');
    expect(videoCodecFor('webm').webmMuxer).toBe('V_VP9');
    expect(videoCodecFor('mp4').webCodecs).toBe('avc1.42001f');
    expect(videoCodecFor('mp4').mp4Muxer).toBe('avc');
  });

  it('suggests a bounded bitrate that scales with pixel throughput', () => {
    const small = suggestedBitrate(64, 64, 30);
    const large = suggestedBitrate(1920, 1080, 60);
    expect(small).toBeGreaterThanOrEqual(500_000);
    expect(large).toBeLessThanOrEqual(40_000_000);
    expect(large).toBeGreaterThan(small);
  });
});
