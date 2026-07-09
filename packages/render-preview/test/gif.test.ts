import { describe, expect, it } from 'vitest';
import { encodeGif, renderSequence } from '@marionette/render-preview';
import { collectFrameRgba } from './helpers';
import { clipSequenceOptions, CLIP_FPS } from './media-scenarios';
import { decodeGif, type DecodedGifFrame } from './decode-helpers';

// Rasterize one decoded GIF frame back to straight-alpha RGBA (transparent index -> alpha 0).
function gifFrameToRgba(frame: DecodedGifFrame): Uint8Array {
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let p = 0; p < frame.indices.length; p += 1) {
    const idx = frame.indices[p]!;
    if (idx === frame.transparentIndex) continue; // stays transparent (0,0,0,0)
    rgba[p * 4] = frame.palette[idx * 3]!;
    rgba[p * 4 + 1] = frame.palette[idx * 3 + 1]!;
    rgba[p * 4 + 2] = frame.palette[idx * 3 + 2]!;
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

describe('animated GIF encoder', () => {
  it('encodes a decodable GIF with the right dimensions, frame count and infinite loop', () => {
    const gif = encodeGif(renderSequence(clipSequenceOptions()));
    const decoded = decodeGif(gif);

    expect(decoded.width).toBe(48);
    expect(decoded.height).toBe(48);
    expect(decoded.frames.length).toBe(6);
    expect(decoded.loopCount).toBe(0);
  });

  it('derives the per-frame delay from the clip fps', () => {
    const decoded = decodeGif(encodeGif(renderSequence(clipSequenceOptions())));

    for (const frame of decoded.frames) {
      expect(frame.delayCentiseconds).toBe(Math.round(100 / CLIP_FPS));
    }
  });

  it('reserves a transparent index for a clip with alpha', () => {
    const decoded = decodeGif(encodeGif(renderSequence(clipSequenceOptions())));

    for (const frame of decoded.frames) expect(frame.transparentIndex).toBeGreaterThanOrEqual(0);
  });

  it('reproduces each frame faithfully within the quantization tolerance (global palette)', () => {
    const options = clipSequenceOptions();
    const sourceRgba = collectFrameRgba(renderSequence(options));
    const decoded = decodeGif(encodeGif(renderSequence(options)));

    for (let f = 0; f < decoded.frames.length; f += 1) {
      const gifRgba = gifFrameToRgba(decoded.frames[f]!);
      const src = sourceRgba[f]!;
      for (let i = 0; i < src.length; i += 4) {
        const srcOpaque = src[i + 3]! >= 128;
        const gifOpaque = gifRgba[i + 3]! === 255;
        expect(gifOpaque).toBe(srcOpaque);
        if (srcOpaque) {
          expect(Math.abs(gifRgba[i]! - src[i]!)).toBeLessThanOrEqual(24);
          expect(Math.abs(gifRgba[i + 1]! - src[i + 1]!)).toBeLessThanOrEqual(24);
          expect(Math.abs(gifRgba[i + 2]! - src[i + 2]!)).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it('supports a per-frame local palette', () => {
    const gif = encodeGif(renderSequence(clipSequenceOptions()), { palette: 'per-frame' });
    const decoded = decodeGif(gif);

    expect(decoded.frames.length).toBe(6);
    // Each frame carries its own (local) color table with real entries.
    for (const frame of decoded.frames) expect(frame.palette.length).toBeGreaterThan(0);
  });

  it('honors an explicit finite loop count', () => {
    const decoded = decodeGif(encodeGif(renderSequence(clipSequenceOptions()), { loopCount: 3 }));

    expect(decoded.loopCount).toBe(3);
  });

  it('is deterministic: two encodes produce identical bytes', () => {
    const a = encodeGif(renderSequence(clipSequenceOptions()));
    const b = encodeGif(renderSequence(clipSequenceOptions()));

    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
