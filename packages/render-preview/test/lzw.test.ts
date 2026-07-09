import { describe, expect, it } from 'vitest';
import { encodeGifImageBlock, lzwCompress } from '../src/encode/lzw';
import { lzwDecode } from './decode-helpers';

describe('GIF LZW compression', () => {
  it('produces the hand-computed byte stream for a small case', () => {
    // Seven 1s at minCodeSize 2 (clear=4, end=5). Emitted codes and widths, derived by hand:
    //   clear(4)@3, 1@3, 6@3, 7@3, 1@4, end(5)@4  =>  LSB-packed bytes 0x8C 0x1F 0x05.
    const bytes = lzwCompress(Uint8Array.from([1, 1, 1, 1, 1, 1, 1]), 2);

    expect(Array.from(bytes)).toEqual([0x8c, 0x1f, 0x05]);
  });

  it('round-trips every index stream back to the original', () => {
    const cases: number[][] = [
      [0],
      [1, 1, 1, 1, 1, 1, 1],
      [0, 1, 0, 1, 0, 1, 2, 3, 2, 3],
      [3, 3, 3, 2, 2, 1, 0, 0, 0, 0, 1, 2, 3],
    ];
    for (const indices of cases) {
      const compressed = lzwCompress(Uint8Array.from(indices), 2);

      expect(lzwDecode(compressed, 2)).toEqual(indices);
    }
  });

  it('round-trips a long stream that forces code-width growth and a dictionary reset', () => {
    // A pseudo-random-but-deterministic index stream over 32 symbols, long enough to exercise the 12-bit
    // width ceiling and at least one clear-code reset.
    const minCodeSize = 5;
    const n = 60_000;
    const indices = new Uint8Array(n);
    let state = 0x1234_5678;
    for (let i = 0; i < n; i += 1) {
      state = (state * 1_103_515_245 + 12_345) & 0x7fff_ffff;
      indices[i] = (state >>> 8) & 0x1f;
    }
    const compressed = lzwCompress(indices, minCodeSize);

    expect(lzwDecode(compressed, minCodeSize)).toEqual(Array.from(indices));
  });

  it('is deterministic: the same indices compress to the same bytes', () => {
    const indices = Uint8Array.from([2, 2, 3, 3, 1, 0, 0, 2, 2, 2, 1]);

    const a = lzwCompress(indices, 3);
    const b = lzwCompress(indices, 3);

    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('frames the image block with the min-code-size byte and a zero terminator', () => {
    const block = encodeGifImageBlock(Uint8Array.from([1, 1, 1]), 2);

    expect(block[0]).toBe(2); // minimum code size
    expect(block[block.length - 1]).toBe(0); // block terminator
    expect(block[1]).toBe(block.length - 3); // single sub-block length byte
  });
});
