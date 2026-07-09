import { describe, expect, it } from 'vitest';
import { encodeApng, renderSequence } from '@marionette/render-preview';
import { collectFrameRgba } from './helpers';
import { CLIP_FPS, clipSequenceOptions } from './media-scenarios';
import { splitApng } from './decode-helpers';

describe('APNG encoder', () => {
  it('encodes a structurally valid APNG with correct acTL and CRCs', () => {
    const apng = encodeApng(renderSequence(clipSequenceOptions()));
    const split = splitApng(apng);

    expect(split.width).toBe(48);
    expect(split.height).toBe(48);
    expect(split.numFrames).toBe(6);
    expect(split.numPlays).toBe(0);
    expect(split.allCrcValid).toBe(true);
    expect(split.frames.length).toBe(6);
  });

  it('assigns monotonic fcTL/fdAT sequence numbers', () => {
    const split = splitApng(encodeApng(renderSequence(clipSequenceOptions())));

    // frame 0: fcTL(0) + IDAT; frame i>0: fcTL + fdAT, sharing one counter => fcTL seqs 0,1,3,5,7,9.
    expect(split.fcTlSequenceNumbers).toEqual([0, 1, 3, 5, 7, 9]);
  });

  it('sets a 1/fps frame delay', () => {
    const split = splitApng(encodeApng(renderSequence(clipSequenceOptions())));

    for (const frame of split.frames) {
      expect(frame.delayNum).toBe(1);
      expect(frame.delayDen).toBe(CLIP_FPS);
    }
  });

  it('is lossless: every frame decodes back to the exact source pixels', () => {
    const options = clipSequenceOptions();
    const sourceRgba = collectFrameRgba(renderSequence(options));
    const split = splitApng(encodeApng(renderSequence(options)));

    expect(split.frames.length).toBe(sourceRgba.length);
    for (let f = 0; f < split.frames.length; f += 1) {
      const decoded = split.frames[f]!.png.data;
      const src = sourceRgba[f]!;
      expect(decoded.length).toBe(src.length);
      expect(Buffer.from(decoded).equals(Buffer.from(src))).toBe(true);
    }
  });

  it('honors an explicit finite loop count', () => {
    const split = splitApng(encodeApng(renderSequence(clipSequenceOptions()), { loopCount: 5 }));

    expect(split.numPlays).toBe(5);
  });

  it('is deterministic: two encodes produce identical bytes', () => {
    const a = encodeApng(renderSequence(clipSequenceOptions()));
    const b = encodeApng(renderSequence(clipSequenceOptions()));

    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
