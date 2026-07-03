import { PNG } from 'pngjs';

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function decode(png: Uint8Array): PNG {
  return PNG.sync.read(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
}

export function pixelAt(img: PNG, x: number, y: number): Rgba {
  const base = (y * img.width + x) * 4;
  return {
    r: img.data[base]!,
    g: img.data[base + 1]!,
    b: img.data[base + 2]!,
    a: img.data[base + 3]!,
  };
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}
