import { AtlasError } from './errors';

// TASK-1.3.3 Trim. The tight alpha bounding box of a sprite plus the trimmed RGBA region. offsetX/offsetY
// are the top-left of the opaque content inside the original sprite, so a renderer that draws the trimmed
// region offset by (offsetX, offsetY) lands every opaque pixel at its original on-screen position.

export interface TrimResult {
  // Top-left of the trimmed region within the original sprite (the alpha bounding-box origin).
  readonly offsetX: number;
  readonly offsetY: number;
  readonly trimmedW: number;
  readonly trimmedH: number;
  readonly originalW: number;
  readonly originalH: number;
  // Row-major RGBA of the trimmed region, length === trimmedW * trimmedH * 4.
  readonly pixels: Uint8Array;
}

// Edge case: a fully transparent sprite has no alpha bounding box. We return a 1x1 transparent region at
// offset (0, 0) rather than a 0x0 region. A zero-area region cannot be packed (the packer reserves
// width+padding) and would break attachment-path resolution; a 1x1 transparent texel packs and renders as
// nothing, which is the sane authoring outcome (the slot shows empty).
export function trimSprite(rgba: Uint8Array, width: number, height: number): TrimResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new AtlasError('ATLAS_INVALID_CONFIG', `invalid sprite dimensions ${width}x${height}`);
  }
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new AtlasError(
      'ATLAS_DIMENSION_MISMATCH',
      `RGBA length ${rgba.length} does not match ${width}x${height} (expected ${expected})`,
    );
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const alpha = rgba[rowStart + x * 4 + 3];
      if (alpha !== undefined && alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return {
      offsetX: 0,
      offsetY: 0,
      trimmedW: 1,
      trimmedH: 1,
      originalW: width,
      originalH: height,
      pixels: new Uint8Array(4),
    };
  }

  const trimmedW = maxX - minX + 1;
  const trimmedH = maxY - minY + 1;
  const rowBytes = trimmedW * 4;
  const pixels = new Uint8Array(trimmedH * rowBytes);
  for (let row = 0; row < trimmedH; row += 1) {
    const srcStart = ((minY + row) * width + minX) * 4;
    pixels.set(rgba.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
  }

  return {
    offsetX: minX,
    offsetY: minY,
    trimmedW,
    trimmedH,
    originalW: width,
    originalH: height,
    pixels,
  };
}
