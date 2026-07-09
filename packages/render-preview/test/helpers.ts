import { PNG } from 'pngjs';
import type { RenderedSequence } from '@marionette/render-preview';

// Encode every frame PNG DURING iteration. renderSequence reuses one RGBA scratch buffer across frames, so
// a frame's png() must be called before the iterator advances; `[...seq.frames()].map(f => f.png())` is
// wrong (it drains first, then every png() reads the last frame). This helper does it correctly.
export function collectFramePngs(sequence: RenderedSequence): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const frame of sequence.frames()) out.push(frame.png());
  return out;
}

// Copy each frame's RGBA scratch during iteration (same streaming-consumption rule as collectFramePngs).
export function collectFrameRgba(sequence: RenderedSequence): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const frame of sequence.frames()) out.push(frame.rgba.slice());
  return out;
}

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
