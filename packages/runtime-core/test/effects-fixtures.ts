import type {
  EffectBundle,
  EffectConfig,
  EffectsDocument,
  EmitterLayer,
  LifeCurve,
  RibbonTrailLayer,
  RGB,
  SpriteAnimatorLayer,
} from '@marionette/format/types';

// Hand-built effect fixtures for the runtime-core effects-solve tests (phase-3-vfx-particles.md
// sections 8.2 to 8.8). These mirror the section 8.10 preset shapes closely enough to exercise the
// solve; they are NOT the committed preset library (that lands with WP-3.0/the conformance fixtures).

const CONST = (v: number) => ({ min: v, max: v });
const RANGE = (min: number, max: number) => ({ min, max });

// A flat scalar over-life curve (value held constant): two linear stops at the same value.
export function flatNumber(value: number): LifeCurve<number> {
  return {
    stops: [
      { t: 0, value, curve: 'linear' },
      { t: 1, value, curve: 'linear' },
    ],
  };
}

// A scalar over-life ramp from a to b (linear).
export function rampNumber(a: number, b: number): LifeCurve<number> {
  return {
    stops: [
      { t: 0, value: a, curve: 'linear' },
      { t: 1, value: b, curve: 'linear' },
    ],
  };
}

// A flat RGB over-life curve.
export function flatRgb(rgb: RGB): LifeCurve<RGB> {
  return {
    stops: [
      { t: 0, value: rgb, curve: 'linear' },
      { t: 1, value: rgb, curve: 'linear' },
    ],
  };
}

const WHITE: RGB = { r: 1, g: 1, b: 1 };

// A minimal emitter layer with sensible defaults; pass overrides to shape a specific test.
export function emitterLayer(overrides: Partial<EmitterLayer> = {}): EmitterLayer {
  return {
    type: 'emitter',
    name: 'emit',
    blendMode: 'normal',
    maxParticles: 64,
    spawn: { mode: 'rate', particlesPerSecond: 60 },
    shape: { kind: 'point' },
    lifetime: CONST(1),
    startSpeed: CONST(0),
    emissionAngle: CONST(0),
    startRotation: CONST(0),
    angularVelocity: CONST(0),
    startScale: CONST(1),
    gravity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    drag: 0,
    scaleOverLife: flatNumber(1),
    colorOverLife: flatRgb(WHITE),
    alphaOverLife: flatNumber(1),
    texture: { kind: 'static', region: 'r' },
    particleTrail: null,
    ...overrides,
  };
}

export function spriteAnimatorLayer(
  overrides: Partial<SpriteAnimatorLayer> = {},
): SpriteAnimatorLayer {
  return {
    type: 'spriteAnimator',
    name: 'sprite',
    blendMode: 'additive',
    region: 'ray',
    anchorSpace: 'world',
    rotationDegPerSec: 0,
    scaleOverLife: flatNumber(1),
    colorOverLife: flatRgb(WHITE),
    alphaOverLife: flatNumber(1),
    loop: true,
    layerDuration: 1,
    ...overrides,
  };
}

export function ribbonTrailLayer(overrides: Partial<RibbonTrailLayer> = {}): RibbonTrailLayer {
  return {
    type: 'ribbonTrail',
    name: 'ribbon',
    blendMode: 'additive',
    region: 'ribbon',
    anchorRef: 'tip',
    maxSegments: 8,
    segmentSpacing: 1,
    widthOverLength: flatNumber(2),
    colorOverLength: flatRgb(WHITE),
    alphaOverLength: rampNumber(1, 0),
    ...overrides,
  };
}

export function effectConfig(overrides: Partial<EffectConfig> = {}): EffectConfig {
  return {
    name: 'fx',
    duration: 1,
    deterministic: true,
    simulationDt: 1 / 60,
    blendMode: 'normal',
    layers: [emitterLayer()],
    ...overrides,
  };
}

// A minimal valid EffectsDocument wrapping the given effects + bundles.
export function effectsDocument(
  effects: Record<string, EffectConfig>,
  bundles: Record<string, EffectBundle> = {},
): EffectsDocument {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'test',
    hash: '',
    // The runtime-core solve never reads the atlas (regions are render-side); an empty pack suffices.
    atlas: { pages: [] },
    effects,
    bundles,
  };
}

export { CONST, RANGE };
