import { PNG } from 'pngjs';

// Encode straight-alpha 8-bit RGBA pixels to PNG bytes via pngjs (pure JS, no native code). The encoder
// options are pinned (no adaptive filtering, fixed deflate level and strategy) so the compressed bytes
// are reproducible: same pixels in => same PNG bytes out on a given zlib. The repo's byte-exact golden
// gate runs on a pinned Node version, which pins zlib; two renders in one process are always identical.
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const png = new PNG({ width, height, colorType: 6, inputColorType: 6, inputHasAlpha: true });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  // Width/height come from the PNG object; the packer options pin the byte stream (RGBA, no filtering,
  // fixed deflate) for reproducibility.
  const encoded = PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    bitDepth: 8,
    filterType: 0,
    deflateLevel: 9,
    deflateStrategy: 3,
  });
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
}
