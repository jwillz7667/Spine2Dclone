import { describe, expect, it } from 'vitest';
import { renderFrame, sequenceRegionName, type AtlasPixelSource } from '@marionette/render-preview';
import { decode, pixelAt } from './helpers';

// A sequence attachment (ADR-0009 section 3) plays a numbered run of atlas regions over time. runtime-core
// resolves the discrete frame index; render-preview names the region (sequenceRegionName) and samples it.
// These tests use a synthetic 3-frame atlas (frame00 red, frame01 green, frame02 blue) so the selected
// frame is visible as the interior pixel color.

// A region 'seq' whose path is the template 'frame' with a 3-frame sequence (setup frame 0). A 'loop'
// sequence timeline at 0.1s/frame drives it.
function sequenceDoc(): unknown {
  return {
    formatVersion: '0.4.0',
    name: 'sequence',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 40,
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
        name: 'seqSlot',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'seq',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          seqSlot: {
            seq: {
              type: 'region',
              path: 'frame',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 40,
              height: 40,
              color: { r: 1, g: 1, b: 1, a: 1 },
              sequence: { count: 3, start: 0, digits: 2, setupIndex: 0 },
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    events: [],
    animations: {
      play: {
        duration: 1,
        bones: {},
        slots: { seqSlot: { sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }] } },
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [],
        events: [],
      },
    },
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 32,
          height: 8,
          regions: [
            // The NUMBERED frame regions the renderer samples (path + zero-padded index).
            {
              name: 'frame00',
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
            {
              name: 'frame01',
              x: 8,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
            {
              name: 'frame02',
              x: 16,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
            // The BASE `path` region: the validator requires it to exist (ATTACHMENT_REGION_MISSING), like
            // the conformance sequence rig. The renderer never samples it (a resolved frame is always a
            // numbered region), so its color (gray) proves it is not what shows.
            {
              name: 'frame',
              x: 24,
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

// frame00 red, frame01 green, frame02 blue, base 'frame' gray (each an 8x8 block of the 32x8 page).
function threeFrameAtlas(): AtlasPixelSource {
  const rgba = new Uint8Array(32 * 8 * 4);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const base = (y * 32 + x) * 4;
      const frame = Math.floor(x / 8); // 0, 1, 2, 3(base)
      rgba[base] = frame === 0 ? 255 : frame === 3 ? 128 : 0;
      rgba[base + 1] = frame === 1 ? 255 : frame === 3 ? 128 : 0;
      rgba[base + 2] = frame === 2 ? 255 : frame === 3 ? 128 : 0;
      rgba[base + 3] = 255;
    }
  }
  return { pages: new Map([['atlas.png', { width: 32, height: 8, rgba }]]) };
}

function center(document: unknown, animation?: string, time?: number) {
  const png = renderFrame({
    document,
    animation,
    time,
    atlas: threeFrameAtlas(),
    viewport: { width: 64, height: 64, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  }).png;
  return pixelAt(decode(png), 32, 32);
}

describe('sequenceRegionName', () => {
  it('appends the zero-padded (start + frame) to the path', () => {
    const seq = { count: 3, start: 0, digits: 2, setupIndex: 0 };
    expect(sequenceRegionName('frame', seq, 0)).toBe('frame00');
    expect(sequenceRegionName('frame', seq, 1)).toBe('frame01');
    expect(sequenceRegionName('frame', seq, 12)).toBe('frame12');
  });

  it('offsets by start and pads to digits width', () => {
    expect(sequenceRegionName('img', { count: 10, start: 5, digits: 3, setupIndex: 0 }, 2)).toBe(
      'img007',
    );
    // A value already wider than digits is not truncated.
    expect(sequenceRegionName('img', { count: 200, start: 0, digits: 2, setupIndex: 0 }, 150)).toBe(
      'img150',
    );
  });
});

describe('render-preview sequence attachments', () => {
  it('shows the setup frame (frame00, red) at the setup pose', () => {
    const p = center(sequenceDoc());
    expect(p.r).toBeGreaterThan(200);
    expect(p.g).toBeLessThan(50);
    expect(p.b).toBeLessThan(50);
  });

  it('advances the frame region as the sequence timeline plays', () => {
    // loop, 0.1s/frame: t in [0.1, 0.2) -> frame 1 (green); t in [0.2, 0.3) -> frame 2 (blue).
    const green = center(sequenceDoc(), 'play', 0.15);
    expect(green.g).toBeGreaterThan(200);
    expect(green.r).toBeLessThan(50);
    expect(green.b).toBeLessThan(50);

    const blue = center(sequenceDoc(), 'play', 0.25);
    expect(blue.b).toBeGreaterThan(200);
    expect(blue.r).toBeLessThan(50);
    expect(blue.g).toBeLessThan(50);
  });
});
