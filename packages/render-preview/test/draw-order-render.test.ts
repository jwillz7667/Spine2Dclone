import { describe, expect, it } from 'vitest';
import type { AtlasPixelSource, RenderFrameOptions } from '@marionette/render-preview';
import { renderFrame, renderSequence } from '@marionette/render-preview';
import { collectFrameRgba, decode, pixelAt } from './helpers';
import { pageSource, solidPage } from './scenarios';

// Draw-order render regression (canonical solve step 6): a render must composite in the SOLVED current
// draw order, not the document slot order. A draw-order timeline permutes the render order at runtime, so a
// frame sampled where the timeline is active must draw the permuted slot on top. This exercised the latent
// bug where render-preview iterated document slot order and ignored pose.drawOrder.

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const RED: Color = { r: 1, g: 0, b: 0, a: 1 };
const BLUE: Color = { r: 0, g: 0, b: 1, a: 1 };

interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// Two slots, 'a' (index 0) then 'b' (index 1), each carrying a fully overlapping opaque 40x40 region on the
// same root bone: 'a' tinted red, 'b' tinted blue. In setup draw order 'b' (drawn last) sits on top, so the
// center is blue. The 'swap' animation carries a single draw-order key at t=0.5 that moves 'a' to the front
// (offset +1) and 'b' to the back (offset -1), so from t=0.5 the center must be red.
function overlappingSwapDocument(): unknown {
  const bone = {
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
  };
  const region = (color: Color): Record<string, unknown> => ({
    type: 'region',
    path: 'img',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 40,
    height: 40,
    color,
  });
  return {
    formatVersion: '0.6.0',
    name: 'preview-draw-order',
    hash: '',
    bones: [bone],
    slots: [
      { name: 'a', bone: 'root', color: WHITE, attachment: 'imgA', blendMode: 'normal' },
      { name: 'b', bone: 'root', color: WHITE, attachment: 'imgB', blendMode: 'normal' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          a: { imgA: region(RED) },
          b: { imgB: region(BLUE) },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [],
    physicsConstraints: [],
    animations: {
      swap: {
        duration: 1,
        bones: {},
        slots: {},
        ik: {},
        transform: {},
        path: {},
        physics: {},
        deform: {},
        drawOrder: [
          {
            time: 0.5,
            offsets: [
              { slot: 'a', offset: 1 },
              { slot: 'b', offset: -1 },
            ],
          },
        ],
        events: [],
      },
    },
    events: [],
    atlas: {
      pages: [
        {
          file: 'page.png',
          width: 8,
          height: 8,
          regions: [
            {
              name: 'img',
              x: 0,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
          ],
        },
      ],
    },
  };
}

const WHITE_ATLAS: AtlasPixelSource = pageSource('page.png', solidPage(8, 8, WHITE));

// Explicit world rect (scale 1, world origin at image center), so the 40x40 region maps to image [12, 52]
// on both axes and the geometric center (32, 32) is a solid interior pixel.
const FIT = { x: -32, y: -32, w: 64, h: 64 } as const;

function frameAt(time: number | undefined): RenderFrameOptions {
  return {
    document: overlappingSwapDocument(),
    animation: 'swap',
    time,
    atlas: WHITE_ATLAS,
    viewport: { width: 64, height: 64, fit: FIT },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

describe('render-preview draw-order timeline', () => {
  it('composites the setup draw order before the draw-order key fires', () => {
    // t = 0 is below the single key (t = 0.5): setup order holds, so 'b' (blue) is on top.
    const center = pixelAt(decode(renderFrame(frameAt(0)).png), 32, 32);

    expect(center.r).toBe(0);
    expect(center.g).toBe(0);
    expect(center.b).toBe(255);
    expect(center.a).toBe(255);
  });

  it('composites the solved draw order after the key swaps the two slots', () => {
    // t = 0.5 activates the swap key: 'a' (red) is now on top, so the center must be red, NOT the
    // document-order blue. This is the assertion that fails against document-slot-order compositing.
    const center = pixelAt(decode(renderFrame(frameAt(0.5)).png), 32, 32);

    expect(center.r).toBe(255);
    expect(center.g).toBe(0);
    expect(center.b).toBe(0);
    expect(center.a).toBe(255);
  });

  it('respects the solved draw order across a rendered sequence', () => {
    // The sequence pipeline reuses one pose across the clip and gathers each frame through the same solved
    // draw order. At 2 fps over [0, 1s) the two frames sample t = 0 (setup order, blue on top) then t = 0.5
    // (swapped, red on top), so the center pixel must flip blue -> red frame to frame.
    const frames = collectFrameRgba(
      renderSequence({
        document: overlappingSwapDocument(),
        animation: 'swap',
        atlas: WHITE_ATLAS,
        viewport: { width: 64, height: 64, fit: FIT },
        background: { r: 0, g: 0, b: 0, a: 0 },
        fps: 2,
        from: { frame: 0 },
        to: { frame: 2 },
      }),
    );
    const centerOf = (rgba: Uint8Array): readonly [number, number, number] => {
      const base = (32 * 64 + 32) * 4;
      return [rgba[base]!, rgba[base + 1]!, rgba[base + 2]!];
    };

    expect(frames).toHaveLength(2);
    expect(centerOf(frames[0]!)).toEqual([0, 0, 255]); // t = 0: blue on top
    expect(centerOf(frames[1]!)).toEqual([255, 0, 0]); // t = 0.5: red on top
  });
});
