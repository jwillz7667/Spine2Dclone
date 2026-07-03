import { encodePng } from './png';
import type { DecodedImage } from './png';

// Test/dev support: synthesize RGBA buffers and PNG bytes with KNOWN alpha bounding boxes, so trim/pack
// tests do not depend on real image files. Not part of the production barrel (index.ts).

export interface SyntheticSpriteSpec {
  readonly width: number;
  readonly height: number;
  // Opaque content rectangle (the alpha bounding box) inside the otherwise transparent sprite.
  readonly contentX: number;
  readonly contentY: number;
  readonly contentW: number;
  readonly contentH: number;
  // Differentiates the deterministic content pattern between sprites so crop comparisons are meaningful.
  readonly seed?: number;
}

// Fills the content rectangle with a deterministic per-pixel pattern (fully opaque) on a transparent
// field, so a trimmed crop has distinguishable, reproducible pixels.
export function makeRgba(spec: SyntheticSpriteSpec): Uint8Array {
  const { width, height, contentX, contentY, contentW, contentH } = spec;
  const seed = spec.seed ?? 0;
  if (
    contentX < 0 ||
    contentY < 0 ||
    contentW < 0 ||
    contentH < 0 ||
    contentX + contentW > width ||
    contentY + contentH > height
  ) {
    throw new Error('synthetic content rectangle is out of bounds');
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = contentY; y < contentY + contentH; y += 1) {
    for (let x = contentX; x < contentX + contentW; x += 1) {
      const idx = (y * width + x) * 4;
      rgba[idx] = (x * 31 + y * 17 + seed) & 0xff;
      rgba[idx + 1] = (x * 13 + y * 29 + seed * 7) & 0xff;
      rgba[idx + 2] = (x * 7 + y * 53 + seed * 13) & 0xff;
      rgba[idx + 3] = 0xff;
    }
  }
  return rgba;
}

export function makeSpritePng(spec: SyntheticSpriteSpec): Uint8Array {
  return encodePng({ width: spec.width, height: spec.height, rgba: makeRgba(spec) });
}

// Crops a sub-rectangle of a decoded image into a fresh row-major RGBA buffer.
export function cropRgba(
  image: DecodedImage,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const rowBytes = w * 4;
  for (let row = 0; row < h; row += 1) {
    const src = ((y + row) * image.width + x) * 4;
    out.set(image.rgba.subarray(src, src + rowBytes), row * rowBytes);
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function defined<T>(value: T | undefined, message = 'expected a defined value'): T {
  if (value === undefined) throw new Error(message);
  return value;
}
