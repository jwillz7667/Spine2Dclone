import type {
  EffectsDocument,
  EmitterLayer,
  LifeCurveNumber,
  LifeCurveRgb,
  RibbonTrailLayer,
  SpriteAnimatorLayer,
} from '@marionette/format/effects-types';
import { computeEffectsContentHash } from '@marionette/format/effects';
import { makeIdFactory, type DocumentEnvironment } from '../src';

// In-memory effects-format seed documents for the effects round-trip harness and effect-command tests.
// They are valid EffectsDocuments (effectsFormatVersion 1.0.0, name-key consistent, all regions resolve in
// the atlas, life curves t=0..1) carried as drafts (hash recomputed below), so loadEffectsState accepts
// them. They stand in for the packages/format / conformance fixtures without coupling the document-core
// tests to those files. Every effect command is applicable on the `library` seed with a real delta.

const EFFECTS_FORMAT_VERSION = '1.0.0';

function numberCurve(v0: number, v1: number): LifeCurveNumber {
  return {
    stops: [
      { t: 0, value: v0, curve: 'linear' },
      { t: 1, value: v1, curve: 'linear' },
    ],
  };
}

// A three-stop scalar curve (t=0, 0.5, 1) so RemoveLifeStop / MoveLifeStop have an interior stop to target.
function numberCurve3(v0: number, vMid: number, v1: number): LifeCurveNumber {
  return {
    stops: [
      { t: 0, value: v0, curve: 'linear' },
      { t: 0.5, value: vMid, curve: 'linear' },
      { t: 1, value: v1, curve: 'linear' },
    ],
  };
}

function rgbCurve(): LifeCurveRgb {
  return {
    stops: [
      { t: 0, value: { r: 1, g: 1, b: 1 }, curve: 'linear' },
      { t: 1, value: { r: 1, g: 0.5, b: 0 }, curve: 'linear' },
    ],
  };
}

// An emitter layer with a three-stop scaleOverLife curve (an interior stop for the remove/move commands).
function emitterLayer(): EmitterLayer {
  return {
    type: 'emitter',
    name: 'coins',
    blendMode: 'normal',
    maxParticles: 200,
    spawn: { mode: 'burst', count: 40, atTime: 0 },
    shape: { kind: 'point' },
    lifetime: { min: 1, max: 2 },
    startSpeed: { min: 100, max: 200 },
    emissionAngle: { min: 60, max: 120 },
    startRotation: { min: 0, max: 360 },
    angularVelocity: { min: -180, max: 180 },
    startScale: { min: 0.8, max: 1.2 },
    gravity: { x: 0, y: 400 },
    acceleration: { x: 0, y: 0 },
    drag: 0,
    scaleOverLife: numberCurve3(0, 1, 0),
    colorOverLife: rgbCurve(),
    alphaOverLife: numberCurve(1, 0),
    texture: { kind: 'static', region: 'coin' },
    particleTrail: null,
  };
}

function spriteLayer(): SpriteAnimatorLayer {
  return {
    type: 'spriteAnimator',
    name: 'rays',
    blendMode: 'additive',
    region: 'ray-fan',
    anchorSpace: 'world',
    rotationDegPerSec: 30,
    scaleOverLife: numberCurve(1, 1.5),
    colorOverLife: rgbCurve(),
    alphaOverLife: numberCurve(0, 1),
    loop: true,
    layerDuration: 2,
  };
}

function ribbonLayer(): RibbonTrailLayer {
  return {
    type: 'ribbonTrail',
    name: 'streak',
    blendMode: 'additive',
    region: 'ribbon',
    anchorRef: 'tip',
    maxSegments: 32,
    segmentSpacing: 8,
    widthOverLength: numberCurve(10, 0),
    colorOverLength: rgbCurve(),
    alphaOverLength: numberCurve(1, 0),
  };
}

function atlasRegion(name: string): EffectsDocument['atlas']['pages'][number]['regions'][number] {
  return {
    name,
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 32,
    originalH: 32,
  };
}

// The full effects library seed: a 'coinShower' effect (emitter + sprite-animator layers), a 'rayBurst'
// effect (a ribbon-trail layer), and a 'megaWin' bundle referencing both. The atlas resolves every region
// (coin / ray-fan / ribbon), plus an extra unreferenced region so a SetEffectsAtlas that KEEPS the
// referenced regions has a distinguishable target.
function libraryDoc(): EffectsDocument {
  const draft: EffectsDocument = {
    effectsFormatVersion: EFFECTS_FORMAT_VERSION,
    name: 'library',
    hash: '',
    atlas: {
      pages: [
        {
          file: 'vfx.png',
          width: 256,
          height: 256,
          regions: [
            atlasRegion('coin'),
            atlasRegion('ray-fan'),
            atlasRegion('ribbon'),
            atlasRegion('spare'),
          ],
        },
      ],
    },
    effects: {
      coinShower: {
        name: 'coinShower',
        duration: 2,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'normal',
        layers: [emitterLayer(), spriteLayer()],
      },
      rayBurst: {
        name: 'rayBurst',
        duration: 1.5,
        deterministic: true,
        simulationDt: 1 / 60,
        blendMode: 'additive',
        layers: [ribbonLayer()],
      },
    },
    bundles: {
      megaWin: {
        name: 'megaWin',
        items: [
          { effect: 'coinShower', startOffset: 0, anchorRole: 'center', seedSalt: 1 },
          { effect: 'rayBurst', startOffset: 0.25, anchorRole: 'center', seedSalt: 2 },
        ],
      },
    },
  };
  return { ...draft, hash: computeEffectsContentHash(draft) };
}

// A second atlas used by the dangling-region rejection test: it keeps coin / ray-fan / ribbon (so the
// 'library' seed's references all resolve) but renames 'spare', proving a KEEP-the-referenced-regions
// atlas swap succeeds. Its sibling MISSING atlas (below) drops 'ribbon', so SetEffectsAtlas must reject it.
export function atlasKeepingRegions(): EffectsDocument['atlas'] {
  return {
    pages: [
      {
        file: 'vfx2.png',
        width: 512,
        height: 512,
        regions: [
          atlasRegion('coin'),
          atlasRegion('ray-fan'),
          atlasRegion('ribbon'),
          atlasRegion('extra'),
        ],
      },
    ],
  };
}

export function atlasDroppingRibbon(): EffectsDocument['atlas'] {
  return {
    pages: [
      {
        file: 'vfx3.png',
        width: 512,
        height: 512,
        regions: [atlasRegion('coin'), atlasRegion('ray-fan')],
      },
    ],
  };
}

export const effectsSeeds = {
  library: libraryDoc(),
} as const;

export interface EffectSeed {
  readonly id: string;
  readonly json: EffectsDocument;
}

export const effectsSeedList: readonly EffectSeed[] = [
  { id: 'library', json: effectsSeeds.library },
];

// A minimal valid SkeletonDocument the combined loader pairs with an effects seed (the effects round-trip
// harness needs a Document, which always carries a skeletal model too). One root bone, empty atlas.
export const minimalSkeletonJson = {
  formatVersion: '0.1.0',
  name: 'effects-host',
  hash: '',
  bones: [
    {
      name: 'root',
      parent: null,
      length: 100,
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
  slots: [],
  skins: [{ name: 'default', attachments: {} }],
  animations: {},
  atlas: { pages: [] },
} as const;

// A deterministic effects test environment (fake clock + fresh monotonic IdFactory per Document), the same
// shape the skeletal makeTestEnv provides.
export interface EffectsTestEnv {
  readonly env: DocumentEnvironment;
  setNow(ms: number): void;
  advance(ms: number): void;
}

export function makeEffectsTestEnv(start = 0): EffectsTestEnv {
  let now = start;
  return {
    env: { now: () => now, createIds: makeIdFactory },
    setNow: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
