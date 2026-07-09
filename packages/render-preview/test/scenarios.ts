import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BlendMode } from '@marionette/format/types';
import type {
  AtlasPagePixels,
  AtlasPixelSource,
  Color,
  RenderFrameOptions,
} from '@marionette/render-preview';

// Shared inputs for the golden generator (scripts/gen-golden.mts) and the golden byte-equality tests, so
// both drive identical documents/atlases/viewports. Kept in one module: a golden and its test can never
// disagree on inputs (they import the same builder), which is the whole point of a byte-locked golden.

// A solid-color atlas page of the given size (straight-alpha RGBA).
export function solidPage(width: number, height: number, color: Color): AtlasPagePixels {
  const rgba = new Uint8Array(width * height * 4);
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * 255);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }
  return { width, height, rgba };
}

export function pageSource(file: string, page: AtlasPagePixels): AtlasPixelSource {
  return { pages: new Map([[file, page]]) };
}

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

// A one-bone, one-slot, one-region document. `boneRotation` rotates the driving bone; the region is a
// `regionWidth` x `regionHeight` quad centered on the bone origin. The atlas page 'page.png' fills the
// single region named 'img'.
export function regionDocument(params: {
  readonly boneRotation: number;
  readonly regionWidth: number;
  readonly regionHeight: number;
  readonly regionColor: Color;
  readonly slotColor: Color;
  readonly blendMode: BlendMode;
  // Optional setup two-color DARK tint on the slot (PP-C8). Present enables two-color tinting; absent
  // (the default) keeps the single-color path. darkColor is a Phase-0 optional field, valid at 0.2.0.
  readonly slotDarkColor?: Color;
}): unknown {
  const slot: Record<string, unknown> = {
    name: 's',
    bone: 'root',
    color: params.slotColor,
    attachment: 'img',
    blendMode: params.blendMode,
  };
  if (params.slotDarkColor !== undefined) slot.darkColor = params.slotDarkColor;
  return {
    formatVersion: '0.2.0',
    name: 'preview-region',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 50,
        x: 0,
        y: 0,
        rotation: params.boneRotation,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [slot],
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
              width: params.regionWidth,
              height: params.regionHeight,
              color: params.regionColor,
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

const WHITE_PAGE = solidPage(8, 8, WHITE);
const WHITE_ATLAS = pageSource('page.png', WHITE_PAGE);

// A tinted (red) region quad on a transparent frame, framed to content. The white page tinted red proves
// the slot x attachment tint path.
export function tintedRegionScenario(): RenderFrameOptions {
  return {
    document: regionDocument({
      boneRotation: 0,
      regionWidth: 40,
      regionHeight: 40,
      regionColor: { r: 1, g: 0, b: 0, a: 1 },
      slotColor: WHITE,
      blendMode: 'normal',
    }),
    atlas: WHITE_ATLAS,
    viewport: { width: 64, height: 64, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// A wide bar region driven by a bone rotated 90 degrees, framed with an EXPLICIT world rect so pixel
// coordinates are exactly predictable (scale 1, world origin at image center). The bar (60 wide x 20
// tall, centered) becomes vertical when the bone rotates 90 degrees; the placement-parity test asserts
// known pixels from this. White page, opaque.
export const ROTATED_FIT = { x: -32, y: -32, w: 64, h: 64 } as const;

export function rotatedRegionScenario(): RenderFrameOptions {
  return {
    document: regionDocument({
      boneRotation: 90,
      regionWidth: 60,
      regionHeight: 20,
      regionColor: WHITE,
      slotColor: WHITE,
      blendMode: 'normal',
    }),
    atlas: WHITE_ATLAS,
    viewport: { width: 64, height: 64, fit: ROTATED_FIT },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// The background and source colors for the blend-mode goldens (both opaque, so the blend math is clean).
export const BLEND_BACKGROUND: Color = { r: 0.4, g: 0.6, b: 0.8, a: 1 };
export const BLEND_SOURCE: Color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

// A grey region over a colored opaque background under one blend mode, framed to content (the region
// covers the frame center). Used one golden per mode.
export function blendScenario(mode: BlendMode): RenderFrameOptions {
  return {
    document: regionDocument({
      boneRotation: 0,
      regionWidth: 40,
      regionHeight: 40,
      regionColor: BLEND_SOURCE,
      slotColor: WHITE,
      blendMode: mode,
    }),
    atlas: WHITE_ATLAS,
    viewport: { width: 32, height: 32, fit: 'content' },
    background: BLEND_BACKGROUND,
  };
}

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'additive', 'multiply', 'screen'];

// A two-color (light + dark) tint region (PP-C8): a mid-gray page (every interior texel is 0.5), a WHITE
// light (slot x attachment color), and a pure-RED dark tint. The shared two-color combine yields the
// interior straight color out = 0.5*white + (1 - 0.5)*red = (1, 0.5, 0.5), a fully predictable pixel that
// the pixel-assertion test checks and the golden byte-locks. Framed to content, transparent background.
export const TWO_COLOR_TEXEL: Color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
export const TWO_COLOR_DARK: Color = { r: 1, g: 0, b: 0, a: 1 };
const TWO_COLOR_PAGE = solidPage(8, 8, TWO_COLOR_TEXEL);
const TWO_COLOR_ATLAS = pageSource('page.png', TWO_COLOR_PAGE);

export function twoColorRegionScenario(): RenderFrameOptions {
  return {
    document: regionDocument({
      boneRotation: 0,
      regionWidth: 40,
      regionHeight: 40,
      regionColor: WHITE,
      slotColor: WHITE,
      blendMode: 'normal',
      slotDarkColor: TWO_COLOR_DARK,
    }),
    atlas: TWO_COLOR_ATLAS,
    viewport: { width: 64, height: 64, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// The committed conformance rig (read-only): a weighted mesh limb with an ik chain and a deform timeline.
export function meshLimbDocument(): unknown {
  const path = fileURLToPath(
    new URL('../../conformance/assets/mesh-limb-rig/mesh-limb-rig.rig.json', import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The rig's atlas page ('mesh-limb-rig.png', 128x128); the region 'limb' occupies its left 64x128. A
// solid opaque teal page so mesh texture sampling is exercised and interior pixels are predictable.
export const MESH_REGION_COLOR: Color = { r: 40 / 255, g: 200 / 255, b: 120 / 255, a: 1 };

export function meshAtlas(): AtlasPixelSource {
  return pageSource('mesh-limb-rig.png', solidPage(128, 128, MESH_REGION_COLOR));
}

// A skinned + deformed mesh frame: the 'wave' animation at t=0.5, where the deform offsets are non-zero.
export function meshScenario(): RenderFrameOptions {
  return {
    document: meshLimbDocument(),
    animation: 'wave',
    time: 0.5,
    atlas: meshAtlas(),
    viewport: { width: 96, height: 96, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// Every golden scenario, by stable file name (the golden basename under test/goldens/).
export function goldenScenarios(): readonly {
  readonly name: string;
  readonly options: RenderFrameOptions;
}[] {
  return [
    { name: 'tinted-region', options: tintedRegionScenario() },
    { name: 'rotated-region', options: rotatedRegionScenario() },
    { name: 'mesh-limb-deformed', options: meshScenario() },
    { name: 'two-color-region', options: twoColorRegionScenario() },
    ...BLEND_MODES.map((mode) => ({ name: `blend-${mode}`, options: blendScenario(mode) })),
  ];
}
