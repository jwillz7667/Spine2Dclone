import type {
  AtlasPagePixels,
  AtlasPixelSource,
  RenderSequenceOptions,
  WorldRect,
} from '@marionette/render-preview';
import { pageSource } from './scenarios';

// Shared clip inputs for the sequence pipeline tests and the GIF/APNG byte goldens, so a golden and its
// test drive an identical clip (the same builder). The clip is a wide bar region driven by a bone that
// rotates 0 -> 90 degrees, framed with a FIXED world rect so the bar visibly rotates under a stationary
// camera (real per-frame motion, not just a changing bounding box) and the frames genuinely differ.

export const CLIP_FPS = 10;
export const CLIP_SIZE = 48;
export const CLIP_FROM_FRAME = 0;
export const CLIP_TO_FRAME = 6; // 6 frames: t = 0 .. 0.5s, bone rotating 0 -> 90 degrees
// A fixed camera large enough to hold the bar at every angle (half-diagonal ~= 32).
export const CLIP_FIT: WorldRect = { x: -40, y: -40, w: 80, h: 80 };

// A 16x16 gradient page so the rotating region shows a range of colors, giving the GIF quantizer a
// non-trivial palette to reduce (a solid page would collapse to one color).
function gradientPage(): AtlasPagePixels {
  const size = 16;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      rgba[i] = x * 16;
      rgba[i + 1] = y * 16;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

export function clipAtlas(): AtlasPixelSource {
  return pageSource('spin.png', gradientPage());
}

// A one-bone, one-slot document whose bone rotates 0 -> 90 -> 180 degrees over one second ('spin').
export function spinDocument(): unknown {
  const rotateKey = (time: number, angle: number): unknown => ({
    time,
    value: { angle },
    curve: 'linear',
  });
  return {
    formatVersion: '0.2.0',
    name: 'preview-spin',
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
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'img',
        blendMode: 'normal',
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
              width: 56,
              height: 24,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    animations: {
      spin: {
        duration: 1,
        bones: { root: { rotate: [rotateKey(0, 0), rotateKey(0.5, 90), rotateKey(1, 180)] } },
        slots: {},
        ik: {},
        transform: {},
        deform: {},
      },
    },
    atlas: {
      pages: [
        {
          file: 'spin.png',
          width: 16,
          height: 16,
          regions: [
            {
              name: 'img',
              x: 0,
              y: 0,
              w: 16,
              h: 16,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 16,
              originalH: 16,
            },
          ],
        },
      ],
    },
  };
}

// The canonical small clip: 'spin' sampled at CLIP_FPS over [CLIP_FROM_FRAME, CLIP_TO_FRAME), on a
// transparent background (so the clip has alpha: GIF transparency + APNG alpha), with the fixed camera.
export function clipSequenceOptions(): RenderSequenceOptions {
  return {
    document: spinDocument(),
    animation: 'spin',
    atlas: clipAtlas(),
    viewport: { width: CLIP_SIZE, height: CLIP_SIZE, fit: CLIP_FIT },
    background: { r: 0, g: 0, b: 0, a: 0 },
    fps: CLIP_FPS,
    from: { frame: CLIP_FROM_FRAME },
    to: { frame: CLIP_TO_FRAME },
  };
}
