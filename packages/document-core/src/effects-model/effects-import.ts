import { parseEffectsDocument } from '@marionette/format/effects';
import type {
  EffectBundle,
  EffectConfig,
  EffectLayer,
  EffectsDocument,
  LifeCurve,
  LifeCurveNumber,
  LifeCurveRgb,
  RGB,
} from '@marionette/format/effects-types';
import { DocumentInvariantError } from '../command/errors';
import type { BundleItemId, EffectId, EffectLayerId, IdFactory } from '../model/ids';
import { makeLifeStop } from './effects-state';
import type {
  BundleEntity,
  BundleItemEntity,
  EffectEntity,
  EffectLayerEntity,
  EffectLifeCurveEntity,
  EffectLayerBody,
  EffectsState,
  LifeCurveField,
} from './effects-state';

// Import a validated EffectsDocument into the internal model (phase-3-vfx-particles.md WP-3.7, mirroring
// the skeletal loadDocument). Mint an EffectId per effect (in record order, which becomes effectOrder), an
// EffectLayerId per layer, a LifeStopId per life-curve stop, and a BundleItemId per bundle item; resolve a
// bundle item's effect NAME reference to its EffectId; carry the atlas verbatim. The format validator
// already guaranteed name-key consistency, region resolution, and curve ordering, so the resolutions below
// are total; a dangling bundle-item effect is corrupt input and throws (symmetry with export).

// Convert a format scalar life curve into an editable curve, minting a LifeStopId per stop.
function importNumberCurve(curve: LifeCurveNumber, ids: IdFactory): EffectLifeCurveEntity {
  return {
    stops: curve.stops.map((stop) =>
      makeLifeStop(ids.mint('lifeStop'), stop.t, stop.value, stop.curve),
    ),
  };
}

// Convert a format RGB life curve into an editable curve, minting a LifeStopId per stop (the value is the
// RGB object, copied by makeLifeStop so the model never aliases the parsed document).
function importRgbCurve(curve: LifeCurveRgb, ids: IdFactory): EffectLifeCurveEntity {
  return {
    stops: curve.stops.map((stop) =>
      makeLifeStop(
        ids.mint('lifeStop'),
        stop.t,
        { r: stop.value.r, g: stop.value.g, b: stop.value.b },
        stop.curve,
      ),
    ),
  };
}

// Build the body + curve map for one format layer. The body holds every non-curve field by value; the
// curves map holds each LifeCurve promoted to an id-keyed stop list under its LifeCurveField key.
function importLayer(layer: EffectLayer, ids: IdFactory): EffectLayerEntity {
  const id = ids.mint('effectLayer');
  const curves = new Map<LifeCurveField, EffectLifeCurveEntity>();
  if (layer.type === 'emitter') {
    curves.set('scaleOverLife', importNumberCurve(layer.scaleOverLife, ids));
    curves.set('colorOverLife', importRgbCurve(layer.colorOverLife, ids));
    curves.set('alphaOverLife', importNumberCurve(layer.alphaOverLife, ids));
    if (layer.particleTrail !== null) {
      curves.set(
        'trailWidthOverLength',
        importNumberCurve(layer.particleTrail.widthOverLength, ids),
      );
      curves.set(
        'trailAlphaOverLength',
        importNumberCurve(layer.particleTrail.alphaOverLength, ids),
      );
    }
    const body: EffectLayerBody = {
      type: 'emitter',
      name: layer.name,
      maxParticles: layer.maxParticles,
      spawn: layer.spawn,
      shape: layer.shape,
      lifetime: layer.lifetime,
      startSpeed: layer.startSpeed,
      emissionAngle: layer.emissionAngle,
      startRotation: layer.startRotation,
      angularVelocity: layer.angularVelocity,
      startScale: layer.startScale,
      gravity: layer.gravity,
      acceleration: layer.acceleration,
      drag: layer.drag,
      texture: layer.texture,
      trail:
        layer.particleTrail === null
          ? null
          : {
              region: layer.particleTrail.region,
              maxSegments: layer.particleTrail.maxSegments,
              segmentSpacing: layer.particleTrail.segmentSpacing,
            },
    };
    return { id, blendMode: layer.blendMode, body, curves };
  }
  if (layer.type === 'spriteAnimator') {
    curves.set('scaleOverLife', importNumberCurve(layer.scaleOverLife, ids));
    curves.set('colorOverLife', importRgbCurve(layer.colorOverLife, ids));
    curves.set('alphaOverLife', importNumberCurve(layer.alphaOverLife, ids));
    const body: EffectLayerBody = {
      type: 'spriteAnimator',
      name: layer.name,
      region: layer.region,
      anchorSpace: layer.anchorSpace,
      rotationDegPerSec: layer.rotationDegPerSec,
      loop: layer.loop,
      layerDuration: layer.layerDuration,
    };
    return { id, blendMode: layer.blendMode, body, curves };
  }
  // ribbonTrail
  curves.set('widthOverLength', importNumberCurve(layer.widthOverLength, ids));
  curves.set('colorOverLength', importRgbCurve(layer.colorOverLength, ids));
  curves.set('alphaOverLength', importNumberCurve(layer.alphaOverLength, ids));
  const body: EffectLayerBody = {
    type: 'ribbonTrail',
    name: layer.name,
    region: layer.region,
    anchorRef: layer.anchorRef,
    maxSegments: layer.maxSegments,
    segmentSpacing: layer.segmentSpacing,
  };
  return { id, blendMode: layer.blendMode, body, curves };
}

function importEffect(config: EffectConfig, ids: IdFactory): EffectEntity {
  const id = ids.mint('effect');
  const layerOrder: EffectLayerId[] = [];
  const layers = new Map<EffectLayerId, EffectLayerEntity>();
  for (const layer of config.layers) {
    const entity = importLayer(layer, ids);
    layerOrder.push(entity.id);
    layers.set(entity.id, entity);
  }
  return {
    id,
    name: config.name,
    duration: config.duration,
    deterministic: config.deterministic,
    simulationDt: config.simulationDt,
    blendMode: config.blendMode,
    layerOrder,
    layers,
  };
}

function importBundle(
  bundle: EffectBundle,
  effectNameToId: ReadonlyMap<string, EffectId>,
  ids: IdFactory,
): BundleEntity {
  const itemOrder: BundleItemId[] = [];
  const items = new Map<BundleItemId, BundleItemEntity>();
  for (const item of bundle.items) {
    const effectId = effectNameToId.get(item.effect);
    if (effectId === undefined) {
      throw new DocumentInvariantError(
        `bundle "${bundle.name}" item references effect "${item.effect}", which does not exist`,
      );
    }
    const itemId = ids.mint('bundleItem');
    itemOrder.push(itemId);
    items.set(itemId, {
      id: itemId,
      effect: effectId,
      startOffset: item.startOffset,
      anchorRole: item.anchorRole,
      seedSalt: item.seedSalt,
    });
  }
  return { name: bundle.name, itemOrder, items };
}

// Resolve a validated EffectsDocument into internal EffectsState. The effect record is iterated in
// insertion order so effectOrder is deterministic (the same effects re-import identically). Effect names
// double as the on-disk keys; the validator's EFFECT_NAME_KEY_MISMATCH guarantees the inner name equals
// the key, so we mint by the inner name.
export function effectsDocumentToState(document: EffectsDocument, ids: IdFactory): EffectsState {
  const effectOrder: EffectId[] = [];
  const effects = new Map<EffectId, EffectEntity>();
  const effectNameToId = new Map<string, EffectId>();
  for (const config of Object.values(document.effects)) {
    const entity = importEffect(config, ids);
    effectOrder.push(entity.id);
    effects.set(entity.id, entity);
    effectNameToId.set(entity.name, entity.id);
  }
  const bundleOrder: string[] = [];
  const bundles = new Map<string, BundleEntity>();
  for (const bundle of Object.values(document.bundles)) {
    bundleOrder.push(bundle.name);
    bundles.set(bundle.name, importBundle(bundle, effectNameToId, ids));
  }
  return {
    effectsFormatVersion: document.effectsFormatVersion,
    name: document.name,
    atlas: document.atlas,
    effectOrder,
    effects,
    bundleOrder,
    bundles,
  };
}

// Load an EffectsDocument from format JSON: validate at the boundary via @marionette/format/effects (a
// typed EffectsValidationError on malformed input) and resolve into state with the given id factory.
// Runtimes treat the hash as opaque, so verifyHash is false. Load is NOT a command and is NOT undoable.
export function loadEffectsState(json: unknown, ids: IdFactory): EffectsState {
  const document = parseEffectsDocument(json, { verifyHash: false });
  return effectsDocumentToState(document, ids);
}

// Re-export RGB/LifeCurve so importers that build seeds against this module's shapes have one entry point.
export type { RGB, LifeCurve };
