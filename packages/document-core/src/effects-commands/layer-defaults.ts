import type { BlendMode } from '@marionette/format/effects-types';
import type { IdFactory } from '../model/ids';
import { makeLifeStop } from '../effects-model/effects-state';
import type {
  EffectLayerEntity,
  EffectLifeCurveEntity,
  LifeCurveField,
} from '../effects-model/effects-state';

// The three layer kinds AddLayer can create (the format layer discriminant). The command takes the kind and
// builds a valid default layer (so a freshly-added layer exports without further edits).
export type NewLayerKind = 'emitter' | 'spriteAnimator' | 'ribbonTrail';

// A two-stop linear scalar curve (the t=0 / t=1 anchor floor), minting a LifeStopId per stop.
function defaultNumberCurve(v0: number, v1: number, ids: IdFactory): EffectLifeCurveEntity {
  return {
    stops: [
      makeLifeStop(ids.mint('lifeStop'), 0, v0, 'linear'),
      makeLifeStop(ids.mint('lifeStop'), 1, v1, 'linear'),
    ],
  };
}

// A two-stop linear RGB curve (white head to white tail), minting a LifeStopId per stop.
function defaultRgbCurve(ids: IdFactory): EffectLifeCurveEntity {
  return {
    stops: [
      makeLifeStop(ids.mint('lifeStop'), 0, { r: 1, g: 1, b: 1 }, 'linear'),
      makeLifeStop(ids.mint('lifeStop'), 1, { r: 1, g: 1, b: 1 }, 'linear'),
    ],
  };
}

// Build a valid default layer of the given kind, minting an EffectLayerId and a LifeStopId per curve stop.
// `region` is the atlas region the layer references (a freshly-added layer must reference a region the
// document atlas resolves, or export would fail EFFECT_REGION_MISSING; the caller passes a resolvable one).
// The default values are conservative and authored to validate (ranges with min<=max, curves t=0..1).
export function buildDefaultLayer(
  kind: NewLayerKind,
  blendMode: BlendMode,
  region: string,
  ids: IdFactory,
): EffectLayerEntity {
  const id = ids.mint('effectLayer');
  const curves = new Map<LifeCurveField, EffectLifeCurveEntity>();
  if (kind === 'emitter') {
    curves.set('scaleOverLife', defaultNumberCurve(1, 1, ids));
    curves.set('colorOverLife', defaultRgbCurve(ids));
    curves.set('alphaOverLife', defaultNumberCurve(1, 0, ids));
    return {
      id,
      blendMode,
      body: {
        type: 'emitter',
        name: 'emitter',
        maxParticles: 100,
        spawn: { mode: 'rate', particlesPerSecond: 20 },
        shape: { kind: 'point' },
        lifetime: { min: 1, max: 1 },
        startSpeed: { min: 50, max: 50 },
        emissionAngle: { min: 0, max: 360 },
        startRotation: { min: 0, max: 0 },
        angularVelocity: { min: 0, max: 0 },
        startScale: { min: 1, max: 1 },
        gravity: { x: 0, y: 0 },
        acceleration: { x: 0, y: 0 },
        drag: 0,
        texture: { kind: 'static', region },
        trail: null,
      },
      curves,
    };
  }
  if (kind === 'spriteAnimator') {
    curves.set('scaleOverLife', defaultNumberCurve(1, 1, ids));
    curves.set('colorOverLife', defaultRgbCurve(ids));
    curves.set('alphaOverLife', defaultNumberCurve(1, 0, ids));
    return {
      id,
      blendMode,
      body: {
        type: 'spriteAnimator',
        name: 'sprite',
        region,
        anchorSpace: 'world',
        rotationDegPerSec: 0,
        loop: true,
        layerDuration: 1,
      },
      curves,
    };
  }
  // ribbonTrail
  curves.set('widthOverLength', defaultNumberCurve(10, 0, ids));
  curves.set('colorOverLength', defaultRgbCurve(ids));
  curves.set('alphaOverLength', defaultNumberCurve(1, 0, ids));
  return {
    id,
    blendMode,
    body: {
      type: 'ribbonTrail',
      name: 'ribbon',
      region,
      anchorRef: 'tip',
      maxSegments: 32,
      segmentSpacing: 8,
    },
    curves,
  };
}
