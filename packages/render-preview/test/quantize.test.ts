import { describe, expect, it } from 'vitest';
import { ColorHistogram, quantizeMedianCut } from '../src/encode/quantize';

// Build an opaque RGBA buffer from a list of [r,g,b] colors (each repeated `repeat` times).
function rgbaOf(colors: readonly [number, number, number][], repeat = 1): Uint8Array {
  const out = new Uint8Array(colors.length * repeat * 4);
  let i = 0;
  for (let r = 0; r < repeat; r += 1) {
    for (const [cr, cg, cb] of colors) {
      out[i] = cr;
      out[i + 1] = cg;
      out[i + 2] = cb;
      out[i + 3] = 255;
      i += 4;
    }
  }
  return out;
}

describe('median-cut quantizer', () => {
  it('keeps every color when the palette is large enough', () => {
    const colors: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
    const histogram = new ColorHistogram();
    histogram.addFrame(rgbaOf(colors), 128);

    const quant = quantizeMedianCut(histogram, 256);

    expect(quant.colorCount).toBe(4);
    // Every source color maps to an entry whose color is close to it (5-bit bucket rounding aside).
    for (const [r, g, b] of colors) {
      const idx = quant.indexOf(r, g, b);
      expect(Math.abs(quant.palette[idx * 3]! - r)).toBeLessThanOrEqual(8);
      expect(Math.abs(quant.palette[idx * 3 + 1]! - g)).toBeLessThanOrEqual(8);
      expect(Math.abs(quant.palette[idx * 3 + 2]! - b)).toBeLessThanOrEqual(8);
    }
  });

  it('reduces to the requested color count', () => {
    const colors: [number, number, number][] = [];
    for (let r = 0; r < 8; r += 1) {
      for (let g = 0; g < 8; g += 1) colors.push([r * 32, g * 32, 64]);
    }
    const histogram = new ColorHistogram();
    histogram.addFrame(rgbaOf(colors), 1);

    const quant = quantizeMedianCut(histogram, 16);

    expect(quant.colorCount).toBeLessThanOrEqual(16);
    expect(quant.colorCount).toBeGreaterThan(1);
  });

  it('skips pixels below the alpha threshold (they contribute no color)', () => {
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 10]); // red opaque, green almost transparent
    const histogram = new ColorHistogram();
    histogram.addFrame(rgba, 128);

    const quant = quantizeMedianCut(histogram, 256);

    expect(quant.colorCount).toBe(1);
    expect(quant.palette[0]).toBe(255);
  });

  it('is deterministic: identical pixels yield an identical palette', () => {
    const colors: [number, number, number][] = [];
    let seed = 7;
    for (let i = 0; i < 200; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      colors.push([(seed >> 1) & 0xff, (seed >> 9) & 0xff, (seed >> 17) & 0xff]);
    }
    const build = (): Uint8Array => {
      const h = new ColorHistogram();
      h.addFrame(rgbaOf(colors), 1);
      return quantizeMedianCut(h, 32).palette;
    };

    expect(Array.from(build())).toEqual(Array.from(build()));
  });

  it('averages a bucket toward its dominant color by population', () => {
    // Many near-black pixels and a few near-white ones fall in different 5-bit buckets, so they stay
    // distinct with a 256-entry palette; each entry sits near its source cluster.
    const dark = rgbaOf([[10, 10, 10]], 100);
    const light = rgbaOf([[240, 240, 240]], 5);
    const histogram = new ColorHistogram();
    histogram.addFrame(dark, 128);
    histogram.addFrame(light, 128);

    const quant = quantizeMedianCut(histogram, 256);

    const darkIdx = quant.indexOf(10, 10, 10);
    const lightIdx = quant.indexOf(240, 240, 240);
    expect(quant.palette[darkIdx * 3]!).toBeLessThan(64);
    expect(quant.palette[lightIdx * 3]!).toBeGreaterThan(192);
  });
});
