import type { BoneAnchorResolver } from '@marionette/runtime-core';
import { compose } from '@marionette/runtime-core';
import type {
  AtlasPixelSource,
  Color,
  RenderComposedFrameOptions,
  RenderEffectFrameOptions,
} from '@marionette/render-preview';
import { pageSource, regionDocument, solidPage } from './scenarios';

// Shared inputs for the effect golden generator (scripts/gen-golden.mts) and the effect golden tests. As
// with the skeletal scenarios, a golden and its test import the SAME builder, so they can never disagree
// on inputs. The effects documents are tiny, hand-written, and deterministic; the atlas is a single solid
// test region, so every particle/sprite/ribbon quad samples a known solid color and pixels are derivable.

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };

// The single VFX atlas: one 8x8 page 'fx.png' with one 8x8 region 'tex'. A solid WHITE page so the tint
// (particle color) is the only thing coloring a quad and a covered pixel samples exactly (1,1,1,1).
const FX_PAGE_FILE = 'fx.png';
const FX_REGION = 'tex';
const FX_REGION_SIZE = 8;

function fxAtlasRef(): unknown {
  return {
    pages: [
      {
        file: FX_PAGE_FILE,
        width: FX_REGION_SIZE,
        height: FX_REGION_SIZE,
        regions: [
          {
            name: FX_REGION,
            x: 0,
            y: 0,
            w: FX_REGION_SIZE,
            h: FX_REGION_SIZE,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            originalW: FX_REGION_SIZE,
            originalH: FX_REGION_SIZE,
          },
        ],
      },
    ],
  };
}

export function fxAtlas(): AtlasPixelSource {
  return pageSource(FX_PAGE_FILE, solidPage(FX_REGION_SIZE, FX_REGION_SIZE, WHITE));
}

// A constant scalar over-life/over-length curve: value held from t=0 to t=1 (linear between equal stops).
function constCurveNumber(value: number): unknown {
  return {
    stops: [
      { t: 0, value, curve: 'linear' },
      { t: 1, value, curve: 'linear' },
    ],
  };
}

function constCurveRgb(r: number, g: number, b: number): unknown {
  return {
    stops: [
      { t: 0, value: { r, g, b }, curve: 'linear' },
      { t: 1, value: { r, g, b }, curve: 'linear' },
    ],
  };
}

function constRange(value: number): unknown {
  return { min: value, max: value };
}

function range(min: number, max: number): unknown {
  return { min, max };
}

// --- Effect: 'spark' -- one at-rest additive particle at the anchor (the hand-derived pixel scenario) ---

// A single particle spawned at the point origin, never moving, at scale 2, constant color/alpha. Under
// additive blend over an opaque background the center pixel is a hand-derivable sum (see effect-golden).
function sparkDocument(): unknown {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'preview-fx-spark',
    hash: '',
    atlas: fxAtlasRef(),
    effects: {
      spark: {
        name: 'spark',
        duration: null,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'additive',
        layers: [
          {
            type: 'emitter',
            name: 'sparkEmitter',
            blendMode: 'additive',
            maxParticles: 1,
            spawn: { mode: 'burst', count: 1, atTime: 0 },
            shape: { kind: 'point' },
            lifetime: constRange(100),
            startSpeed: constRange(0),
            emissionAngle: constRange(0),
            startRotation: constRange(0),
            angularVelocity: constRange(0),
            startScale: constRange(2),
            gravity: { x: 0, y: 0 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: constCurveNumber(1),
            colorOverLife: constCurveRgb(0.4, 0.4, 0.4),
            alphaOverLife: constCurveNumber(1),
            texture: { kind: 'static', region: FX_REGION },
            particleTrail: null,
          },
        ],
      },
    },
    bundles: {},
  };
}

// The additive-over-opaque scenario: the single spark centered on a dark opaque background, explicit fit
// rect (scale 1, world origin at image center) so the particle covers the center pixel exactly.
export const SPARK_BACKGROUND: Color = { r: 0.2, g: 0.2, b: 0.2, a: 1 };
export const SPARK_FIT = { x: -16, y: -16, w: 32, h: 32 } as const;

export function sparkScenario(): RenderEffectFrameOptions {
  return {
    effectsDocument: sparkDocument(),
    trigger: { effect: 'spark', seed: 1, anchors: { default: { x: 0, y: 0 } } },
    time: 0.1,
    atlas: fxAtlas(),
    viewport: { width: 32, height: 32, fit: SPARK_FIT },
    background: SPARK_BACKGROUND,
  };
}

// --- Effect: 'burst' -- a circle of gold particles mid-flight (the single-emitter mid-burst golden) ---

function burstDocument(): unknown {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'preview-fx-burst',
    hash: '',
    atlas: fxAtlasRef(),
    effects: {
      burst: {
        name: 'burst',
        duration: 2,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'normal',
        layers: [
          {
            type: 'emitter',
            name: 'burstEmitter',
            blendMode: 'normal',
            maxParticles: 32,
            spawn: { mode: 'burst', count: 16, atTime: 0 },
            shape: { kind: 'circle', radius: 4, edgeOnly: false },
            lifetime: constRange(2),
            startSpeed: range(60, 140),
            emissionAngle: range(0, 360),
            startRotation: constRange(0),
            angularVelocity: constRange(0),
            startScale: constRange(1.5),
            gravity: { x: 0, y: 200 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: constCurveNumber(1),
            colorOverLife: constCurveRgb(1, 0.84, 0),
            alphaOverLife: constCurveNumber(1),
            texture: { kind: 'static', region: FX_REGION },
            particleTrail: null,
          },
        ],
      },
    },
    bundles: {},
  };
}

export function burstScenario(): RenderEffectFrameOptions {
  return {
    effectsDocument: burstDocument(),
    trigger: { effect: 'burst', seed: 0x51ee, anchors: { default: { x: 0, y: 0 } } },
    time: 0.25,
    atlas: fxAtlas(),
    viewport: { width: 96, height: 96, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// --- Effect: 'trail' -- a ribbon trail following a bone that translates +x each frame ---

function trailDocument(): unknown {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'preview-fx-trail',
    hash: '',
    atlas: fxAtlasRef(),
    effects: {
      trail: {
        name: 'trail',
        duration: null,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'normal',
        layers: [
          {
            type: 'ribbonTrail',
            name: 'trailRibbon',
            blendMode: 'normal',
            region: FX_REGION,
            anchorRef: 'tip',
            maxSegments: 48,
            segmentSpacing: 4,
            widthOverLength: constCurveNumber(6),
            colorOverLength: constCurveRgb(1, 0.8, 0),
            alphaOverLength: constCurveNumber(1),
          },
        ],
      },
    },
    bundles: {},
  };
}

// A resolver whose bone tip translates +8 world units per call (a synthetic moving skeleton). The system
// calls it once at trigger and once per active frame, so a fresh resolver per render is deterministic. A
// step of 8 exceeds segmentSpacing (4), so the ribbon records a point every frame -> a straight strip.
function movingTipResolver(): BoneAnchorResolver {
  let callCount = 0;
  return () => {
    const x = callCount * 8;
    callCount += 1;
    return compose(x, 0, 0, 1, 1, 0, 0);
  };
}

export function trailScenario(): RenderEffectFrameOptions {
  return {
    effectsDocument: trailDocument(),
    trigger: { effect: 'trail', seed: 1, anchors: { default: { bone: 'tip' } } },
    time: 0.3,
    atlas: fxAtlas(),
    viewport: { width: 192, height: 48, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
    resolveBone: movingTipResolver(),
  };
}

// --- Bundle: 'win' -- gold coins (t=0) plus an additive glow sprite that starts at t=0.1 ---

function winBundleDocument(): unknown {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'preview-fx-win',
    hash: '',
    atlas: fxAtlasRef(),
    effects: {
      coins: {
        name: 'coins',
        duration: 2,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'normal',
        layers: [
          {
            type: 'emitter',
            name: 'coinEmitter',
            blendMode: 'normal',
            maxParticles: 24,
            spawn: { mode: 'burst', count: 12, atTime: 0 },
            shape: { kind: 'circle', radius: 3, edgeOnly: false },
            lifetime: constRange(2),
            startSpeed: range(50, 120),
            emissionAngle: range(200, 340),
            startRotation: constRange(0),
            angularVelocity: constRange(0),
            startScale: constRange(1.5),
            gravity: { x: 0, y: 240 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: constCurveNumber(1),
            colorOverLife: constCurveRgb(1, 0.84, 0),
            alphaOverLife: constCurveNumber(1),
            texture: { kind: 'static', region: FX_REGION },
            particleTrail: null,
          },
        ],
      },
      glow: {
        name: 'glow',
        duration: 1,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'additive',
        layers: [
          {
            type: 'spriteAnimator',
            name: 'glowSprite',
            blendMode: 'additive',
            region: FX_REGION,
            anchorSpace: 'world',
            rotationDegPerSec: 0,
            scaleOverLife: constCurveNumber(6),
            colorOverLife: constCurveRgb(0.5, 0.5, 0.3),
            alphaOverLife: constCurveNumber(1),
            loop: false,
            layerDuration: 1,
          },
        ],
      },
    },
    bundles: {
      win: {
        name: 'win',
        items: [
          { effect: 'coins', startOffset: 0, anchorRole: 'center', seedSalt: 1 },
          { effect: 'glow', startOffset: 0.1, anchorRole: 'center', seedSalt: 2 },
        ],
      },
    },
  };
}

export const WIN_FIT = { x: -80, y: -80, w: 160, h: 160 } as const;

// The bundle at two distinct times: t=0.05 (only coins have emitted; the glow is still dormant) and
// t=0.2 (coins have spread and the glow sprite is active). Same trigger, two times -> two goldens.
export function winBundleScenario(time: number): RenderEffectFrameOptions {
  return {
    effectsDocument: winBundleDocument(),
    trigger: { bundle: 'win', seed: 0x5eed, anchors: { center: { x: 0, y: 0 } } },
    time,
    atlas: fxAtlas(),
    viewport: { width: 128, height: 128, fit: WIN_FIT },
    background: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
  };
}

// --- Composed: a skeleton region + an additive coin burst overlaid into one framebuffer ---

export function composedScenario(): RenderComposedFrameOptions {
  return {
    skeleton: {
      document: regionDocument({
        boneRotation: 0,
        regionWidth: 40,
        regionHeight: 40,
        regionColor: { r: 0.15, g: 0.25, b: 0.6, a: 1 },
        slotColor: WHITE,
        blendMode: 'normal',
      }),
      atlas: pageSource('page.png', solidPage(8, 8, WHITE)),
    },
    effect: {
      effectsDocument: burstDocument(),
      trigger: { effect: 'burst', seed: 0x51ee, anchors: { default: { x: 0, y: 0 } } },
      time: 0.2,
      atlas: fxAtlas(),
    },
    viewport: { width: 96, height: 96, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
  };
}

// Every effect golden scenario, by stable file name (basename under test/goldens/).
export function effectGoldenScenarios(): readonly {
  readonly name: string;
  readonly options: RenderEffectFrameOptions;
}[] {
  return [
    { name: 'effect-emitter-burst', options: burstScenario() },
    { name: 'effect-additive-spark', options: sparkScenario() },
    { name: 'effect-ribbon-trail', options: trailScenario() },
    { name: 'effect-bundle-early', options: winBundleScenario(0.05) },
    { name: 'effect-bundle-late', options: winBundleScenario(0.2) },
  ];
}

export function composedGoldenScenarios(): readonly {
  readonly name: string;
  readonly options: RenderComposedFrameOptions;
}[] {
  return [{ name: 'composed-skeleton-effect', options: composedScenario() }];
}
