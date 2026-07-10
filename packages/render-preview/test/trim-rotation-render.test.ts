import { describe, expect, it } from 'vitest';
import type { AtlasRegion, BlendMode } from '@marionette/format/types';
import { renderFrame, type AtlasPixelSource, type Color } from '@marionette/render-preview';
import { decode, pixelAt } from './helpers';

// PP-C1 / PP-C2 end-to-end rendered pixels: trim places a packed sub-region exactly where its untrimmed
// original would sit, and a rotated region samples pixel-equivalently to the same content packed unrotated.
// These are the strongest checks the CPU rasterizer can make headlessly; runtime-web mirrors the same
// convention (PixiJS rotate=2 and attachment-sprites sizeForTexture), which the GL path exercises.

interface Rgba8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const RED: Rgba8 = { r: 220, g: 30, b: 40, a: 255 };
const CLEAR: Rgba8 = { r: 0, g: 0, b: 0, a: 0 };

// A blank straight-alpha RGBA buffer of the given size.
function blank(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function setPixel(buf: Uint8Array, width: number, x: number, y: number, c: Rgba8): void {
  const i = (y * width + x) * 4;
  buf[i] = c.r;
  buf[i + 1] = c.g;
  buf[i + 2] = c.b;
  buf[i + 3] = c.a;
}

function getPixel(buf: Uint8Array, width: number, x: number, y: number): Rgba8 {
  const i = (y * width + x) * 4;
  return { r: buf[i]!, g: buf[i + 1]!, b: buf[i + 2]!, a: buf[i + 3]! };
}

// A distinctive gradient image (a wrong rotation shows up as a channel swap): red = x, green = y.
function gradient(width: number, height: number): Uint8Array {
  const buf = blank(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(buf, width, x, y, { r: (x * 8) & 0xff, g: (y * 8) & 0xff, b: 60, a: 255 });
    }
  }
  return buf;
}

// Reference 90-degree-clockwise rotation of a w x h image into an (h x w) buffer (matches atlas-pack
// blitRotated / runtime-web ROTATE_90_CW): source (lx, ly) -> stored (h - 1 - ly, lx).
function rotate90CW(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = blank(h, w);
  for (let ly = 0; ly < h; ly += 1) {
    for (let lx = 0; lx < w; lx += 1) {
      setPixel(out, h, h - 1 - ly, lx, getPixel(src, w, lx, ly));
    }
  }
  return out;
}

function pageSource(
  file: string,
  width: number,
  height: number,
  rgba: Uint8Array,
): AtlasPixelSource {
  return { pages: new Map([[file, { width, height, rgba }]]) };
}

// A one-bone, one-slot region document over a single atlas page 'page.png'/region 'img'. The caller
// supplies the region attachment size and the atlas region record (trim/rotation live there).
function regionDoc(params: {
  readonly attachmentWidth: number;
  readonly attachmentHeight: number;
  readonly region: AtlasRegion;
  readonly page: { width: number; height: number };
  readonly blendMode?: BlendMode;
}): unknown {
  const white: Color = { r: 1, g: 1, b: 1, a: 1 };
  return {
    formatVersion: '0.2.0',
    name: 'trim-rotation',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 50,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 's',
        bone: 'root',
        color: white,
        attachment: 'img',
        blendMode: params.blendMode ?? 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          s: {
            img: {
              type: 'region',
              path: 'img',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: params.attachmentWidth,
              height: params.attachmentHeight,
              color: white,
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'page.png',
          width: params.page.width,
          height: params.page.height,
          regions: [params.region],
        },
      ],
    },
  };
}

const FIT = { x: -24, y: -24, w: 48, h: 48 } as const;
const VIEWPORT = { width: 48, height: 48, fit: FIT } as const;

function maxChannelDiff(a: ReturnType<typeof decode>, b: ReturnType<typeof decode>): number {
  let worst = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    worst = Math.max(worst, Math.abs(a.data[i]! - b.data[i]!));
  }
  return worst;
}

describe('trim rendered placement', () => {
  it('renders a trimmed region where the untrimmed original would sit', () => {
    // Original 40x40; opaque content is a 20x16 block at (8, 10). Trimmed atlas stores only that block.
    const contentW = 20;
    const contentH = 16;
    const offsetX = 8;
    const offsetY = 10;
    const originalW = 40;
    const originalH = 40;

    const trimmedPage = blank(contentW, contentH);
    for (let i = 0; i < trimmedPage.length; i += 4) {
      trimmedPage[i] = RED.r;
      trimmedPage[i + 1] = RED.g;
      trimmedPage[i + 2] = RED.b;
      trimmedPage[i + 3] = RED.a;
    }
    const trimmedRegion: AtlasRegion = {
      name: 'img',
      x: 0,
      y: 0,
      w: contentW,
      h: contentH,
      rotated: false,
      offsetX,
      offsetY,
      originalW,
      originalH,
    };
    const trimmed = renderFrame({
      document: regionDoc({
        attachmentWidth: originalW,
        attachmentHeight: originalH,
        region: trimmedRegion,
        page: { width: contentW, height: contentH },
      }),
      atlas: pageSource('page.png', contentW, contentH, trimmedPage),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    // Reference: the FULL untrimmed 40x40 image (transparent except the same 20x16 red block at (8,10)),
    // packed untrimmed. Its content must land at the same screen pixels as the trimmed version above.
    const fullPage = blank(originalW, originalH);
    for (let y = offsetY; y < offsetY + contentH; y += 1) {
      for (let x = offsetX; x < offsetX + contentW; x += 1) {
        setPixel(fullPage, originalW, x, y, RED);
      }
    }
    const fullRegion: AtlasRegion = {
      name: 'img',
      x: 0,
      y: 0,
      w: originalW,
      h: originalH,
      rotated: false,
      offsetX: 0,
      offsetY: 0,
      originalW,
      originalH,
    };
    const reference = renderFrame({
      document: regionDoc({
        attachmentWidth: originalW,
        attachmentHeight: originalH,
        region: fullRegion,
        page: { width: originalW, height: originalH },
      }),
      atlas: pageSource('page.png', originalW, originalH, fullPage),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    expect(maxChannelDiff(decode(trimmed.png), decode(reference.png))).toBeLessThanOrEqual(1);
  });
});

describe('rotation rendered sampling', () => {
  it('samples a rotated region pixel-equivalently to the same content packed unrotated', () => {
    const w = 24;
    const h = 16;
    const src = gradient(w, h);

    const unrotated = renderFrame({
      document: regionDoc({
        attachmentWidth: w,
        attachmentHeight: h,
        region: {
          name: 'img',
          x: 0,
          y: 0,
          w,
          h,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          originalW: w,
          originalH: h,
        },
        page: { width: w, height: h },
      }),
      atlas: pageSource('page.png', w, h, src),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    // Rotated packing: the same content stored turned 90 degrees CW into an (h x w) page.
    const rotatedPage = rotate90CW(src, w, h);
    const rotated = renderFrame({
      document: regionDoc({
        attachmentWidth: w,
        attachmentHeight: h,
        region: {
          name: 'img',
          x: 0,
          y: 0,
          w,
          h,
          rotated: true,
          offsetX: 0,
          offsetY: 0,
          originalW: w,
          originalH: h,
        },
        page: { width: h, height: w },
      }),
      atlas: pageSource('page.png', h, w, rotatedPage),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    const a = decode(unrotated.png);
    const b = decode(rotated.png);
    // Same content, same placement, sampled from a rotated store: near-identical (only bilinear rounding).
    expect(maxChannelDiff(a, b)).toBeLessThanOrEqual(2);

    // A distinctive interior pixel proves orientation is right (not merely both-blank agreement).
    const center = pixelAt(a, 24, 24);
    expect(center.a).toBe(255);
    expect(pixelAt(b, 24, 24)).toEqual(center);
  });

  it('composes rotation with trim (a trimmed, rotated region lands where its original would)', () => {
    // Content 18x10 opaque, trimmed from a 30x24 original at offset (6, 8), packed ROTATED.
    const contentW = 18;
    const contentH = 10;
    const offsetX = 6;
    const offsetY = 8;
    const originalW = 30;
    const originalH = 24;
    const content = gradient(contentW, contentH);

    const rotatedPage = rotate90CW(content, contentW, contentH);
    const rotatedTrimmed = renderFrame({
      document: regionDoc({
        attachmentWidth: originalW,
        attachmentHeight: originalH,
        region: {
          name: 'img',
          x: 0,
          y: 0,
          w: contentW,
          h: contentH,
          rotated: true,
          offsetX,
          offsetY,
          originalW,
          originalH,
        },
        page: { width: contentH, height: contentW },
      }),
      atlas: pageSource('page.png', contentH, contentW, rotatedPage),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    // Reference: the same content, unrotated, trimmed the same way. Placement is rotation-independent, so
    // the two must render the same content in the same place.
    const unrotatedTrimmed = renderFrame({
      document: regionDoc({
        attachmentWidth: originalW,
        attachmentHeight: originalH,
        region: {
          name: 'img',
          x: 0,
          y: 0,
          w: contentW,
          h: contentH,
          rotated: false,
          offsetX,
          offsetY,
          originalW,
          originalH,
        },
        page: { width: contentW, height: contentH },
      }),
      atlas: pageSource('page.png', contentW, contentH, content),
      viewport: VIEWPORT,
      background: CLEAR,
    });

    expect(
      maxChannelDiff(decode(rotatedTrimmed.png), decode(unrotatedTrimmed.png)),
    ).toBeLessThanOrEqual(2);
  });
});
