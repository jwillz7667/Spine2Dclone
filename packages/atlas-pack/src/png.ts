import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { AtlasError } from './errors';

// PNG codec wrapper over pngjs, a PURE-JS implementation. Determinism of the decoded-pixel contract
// must not depend on a native library's version, so the service decodes and encodes here, never via
// sharp or any native codec. Decoded RGBA buffers are always copied out of pngjs internal Buffers so
// callers own their pixels.

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  // Row-major RGBA, length === width * height * 4.
  readonly rgba: Uint8Array;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  let png;
  try {
    png = PNG.sync.read(Buffer.from(bytes));
  } catch (cause) {
    throw new AtlasError('ATLAS_DECODE_FAILED', 'failed to decode PNG bytes', { cause });
  }
  return { width: png.width, height: png.height, rgba: Uint8Array.from(png.data) };
}

export function encodePng(image: DecodedImage): Uint8Array {
  const expected = image.width * image.height * 4;
  if (image.rgba.length !== expected) {
    throw new AtlasError(
      'ATLAS_DIMENSION_MISMATCH',
      `RGBA length ${image.rgba.length} does not match ${image.width}x${image.height} (expected ${expected})`,
    );
  }
  try {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.rgba);
    return new Uint8Array(PNG.sync.write(png));
  } catch (cause) {
    if (cause instanceof AtlasError) throw cause;
    throw new AtlasError('ATLAS_ENCODE_FAILED', 'failed to encode PNG bytes', { cause });
  }
}

// Raw sha256 (hex) of an arbitrary byte buffer. Used by the compressed-texture manifest to record the
// source PNG's byte identity (TASK-5.2.6): unlike decodedPagePixelHash this hashes the exact file bytes,
// which is what a runtime re-checks against a committed page.
export function bytesSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Hashes the DECODED pixels of a PNG (plus its dimensions), NOT the PNG bytes. PNG byte-identity
// depends on the zlib/encoder version and the OS, so the determinism contract is asserted on decoded
// pixels (phase-1 TASK-1.3.4). Two PNGs with identical pixels hash equal even if their bytes differ.
export function decodedPagePixelHash(pngBytes: Uint8Array): string {
  const image = decodePng(pngBytes);
  const hash = createHash('sha256');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  hash.update(header);
  hash.update(image.rgba);
  return hash.digest('hex');
}
