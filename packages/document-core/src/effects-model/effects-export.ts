import { computeEffectsContentHash, validateEffectsDocument } from '@marionette/format/effects';
import type { EffectsValidationReport } from '@marionette/format/effects';
import type {
  EffectBundle,
  EffectConfig,
  EffectLayer,
  EffectsDocument,
  EmitterLayer,
  LifeCurveNumber,
  LifeCurveRgb,
  RibbonTrailLayer,
  SpriteAnimatorLayer,
} from '@marionette/format/effects-types';
import { DocumentInvariantError } from '../command/errors';
import { EFFECTS_FORMAT_VERSION } from './effects-version';
import type {
  BundleEntity,
  EffectEntity,
  EffectLayerEntity,
  EffectLifeCurveEntity,
  LifeCurveField,
} from './effects-state';
import type { EffectsReadModel } from './effects-read-model';

// An effects export rejected by the effects-format validator (the effects mirror of the skeletal
// ExportValidationError). Carries the full report so the caller can surface the exact EFFECT_* codes
// (for example a duplicate effect name, EFFECT_NAME_DUPLICATE, or a dangling region, EFFECT_REGION_MISSING).
export class EffectsExportValidationError extends Error {
  override readonly name = 'EffectsExportValidationError';
  readonly code = 'EFFECTS_EXPORT_VALIDATION' as const;
  constructor(readonly report: EffectsValidationReport) {
    super(`exported effects document failed validation with ${report.errors.length} error(s)`);
  }
}

// Project an editable curve back to a format scalar LifeCurve (the curve commands keep stops strictly
// ascending with t=0/t=1 anchors, so the projection is total).
function curveToNumber(curve: EffectLifeCurveEntity): LifeCurveNumber {
  return {
    stops: curve.stops.map((stop) => {
      if (typeof stop.value !== 'number') {
        throw new DocumentInvariantError('a scalar life curve stop carries a non-numeric value');
      }
      return { t: stop.t, value: stop.value, curve: stop.curve };
    }),
  };
}

function curveToRgb(curve: EffectLifeCurveEntity): LifeCurveRgb {
  return {
    stops: curve.stops.map((stop) => {
      if (typeof stop.value === 'number') {
        throw new DocumentInvariantError('an RGB life curve stop carries a numeric value');
      }
      const { r, g, b } = stop.value;
      return { t: stop.t, value: { r, g, b }, curve: stop.curve };
    }),
  };
}

function requireCurve(layer: EffectLayerEntity, field: LifeCurveField): EffectLifeCurveEntity {
  const curve = layer.curves.get(field);
  if (curve === undefined) {
    throw new DocumentInvariantError(`layer ${layer.id} is missing the "${field}" life curve`);
  }
  return curve;
}

function layerToFormat(layer: EffectLayerEntity): EffectLayer {
  const { body } = layer;
  if (body.type === 'emitter') {
    const emitter: EmitterLayer = {
      type: 'emitter',
      name: body.name,
      blendMode: layer.blendMode,
      maxParticles: body.maxParticles,
      spawn: body.spawn,
      shape: body.shape,
      lifetime: body.lifetime,
      startSpeed: body.startSpeed,
      emissionAngle: body.emissionAngle,
      startRotation: body.startRotation,
      angularVelocity: body.angularVelocity,
      startScale: body.startScale,
      gravity: body.gravity,
      acceleration: body.acceleration,
      drag: body.drag,
      scaleOverLife: curveToNumber(requireCurve(layer, 'scaleOverLife')),
      colorOverLife: curveToRgb(requireCurve(layer, 'colorOverLife')),
      alphaOverLife: curveToNumber(requireCurve(layer, 'alphaOverLife')),
      texture: body.texture,
      particleTrail:
        body.trail === null
          ? null
          : {
              region: body.trail.region,
              maxSegments: body.trail.maxSegments,
              segmentSpacing: body.trail.segmentSpacing,
              widthOverLength: curveToNumber(requireCurve(layer, 'trailWidthOverLength')),
              alphaOverLength: curveToNumber(requireCurve(layer, 'trailAlphaOverLength')),
            },
    };
    return emitter;
  }
  if (body.type === 'spriteAnimator') {
    const sprite: SpriteAnimatorLayer = {
      type: 'spriteAnimator',
      name: body.name,
      blendMode: layer.blendMode,
      region: body.region,
      anchorSpace: body.anchorSpace,
      rotationDegPerSec: body.rotationDegPerSec,
      scaleOverLife: curveToNumber(requireCurve(layer, 'scaleOverLife')),
      colorOverLife: curveToRgb(requireCurve(layer, 'colorOverLife')),
      alphaOverLife: curveToNumber(requireCurve(layer, 'alphaOverLife')),
      loop: body.loop,
      layerDuration: body.layerDuration,
    };
    return sprite;
  }
  const ribbon: RibbonTrailLayer = {
    type: 'ribbonTrail',
    name: body.name,
    blendMode: layer.blendMode,
    region: body.region,
    anchorRef: body.anchorRef,
    maxSegments: body.maxSegments,
    segmentSpacing: body.segmentSpacing,
    widthOverLength: curveToNumber(requireCurve(layer, 'widthOverLength')),
    colorOverLength: curveToRgb(requireCurve(layer, 'colorOverLength')),
    alphaOverLength: curveToNumber(requireCurve(layer, 'alphaOverLength')),
  };
  return ribbon;
}

function effectToFormat(effect: EffectEntity): EffectConfig {
  const layers: EffectLayer[] = [];
  for (const layerId of effect.layerOrder) {
    const layer = effect.layers.get(layerId);
    if (layer === undefined) {
      throw new DocumentInvariantError(
        `effect "${effect.name}" lists layer ${layerId}, which does not exist`,
      );
    }
    layers.push(layerToFormat(layer));
  }
  return {
    name: effect.name,
    duration: effect.duration,
    deterministic: effect.deterministic,
    simulationDt: effect.simulationDt,
    blendMode: effect.blendMode,
    layers,
  };
}

function bundleToFormat(
  bundle: BundleEntity,
  effectIdToName: ReadonlyMap<string, string>,
): EffectBundle {
  const items = bundle.itemOrder.map((itemId) => {
    const item = bundle.items.get(itemId);
    if (item === undefined) {
      throw new DocumentInvariantError(
        `bundle "${bundle.name}" lists item ${itemId}, which does not exist`,
      );
    }
    const effectName = effectIdToName.get(item.effect);
    if (effectName === undefined) {
      throw new DocumentInvariantError(
        `bundle "${bundle.name}" item references effect ${item.effect}, which does not exist`,
      );
    }
    return {
      effect: effectName,
      startOffset: item.startOffset,
      anchorRole: item.anchorRole,
      seedSalt: item.seedSalt,
    };
  });
  return { name: bundle.name, items };
}

// Project the internal effects model to the EffectsDocument format (the effects mirror of exportDocument):
// resolve effect-id references to names, emit the effects/bundles records (name-keyed, since the validator's
// EFFECT_NAME_KEY_MISMATCH requires the inner name to equal the map key), stamp EFFECTS_FORMAT_VERSION, set
// `hash` LAST via computeEffectsContentHash, then run validateEffectsDocument on the output so name
// uniqueness (the export-only contract) and region resolution are enforced here; an invalid projection
// throws EffectsExportValidationError (LAW 3: fail loudly), never ships silently. A duplicate effect name
// cannot be represented in the name-keyed record, so it is surfaced as a typed DocumentInvariantError, the
// fail-loud sibling of the validator's EFFECT_NAME_DUPLICATE.
export function exportEffects(model: EffectsReadModel): EffectsDocument {
  const orderedEffects = model.effects();
  const effectIdToName = new Map<string, string>();
  for (const effect of orderedEffects) effectIdToName.set(effect.id, effect.name);

  const effects: Record<string, EffectConfig> = {};
  for (const effect of orderedEffects) {
    if (effect.name in effects) {
      throw new DocumentInvariantError(`effect name "${effect.name}" is not unique`);
    }
    effects[effect.name] = effectToFormat(effect);
  }

  const bundles: Record<string, EffectBundle> = {};
  for (const bundle of model.bundles()) {
    if (bundle.name in bundles) {
      throw new DocumentInvariantError(`bundle name "${bundle.name}" is not unique`);
    }
    bundles[bundle.name] = bundleToFormat(bundle, effectIdToName);
  }

  const draft: EffectsDocument = {
    effectsFormatVersion: EFFECTS_FORMAT_VERSION,
    name: model.name,
    hash: '',
    atlas: model.atlas(),
    effects,
    bundles,
  };
  const withHash: EffectsDocument = { ...draft, hash: computeEffectsContentHash(draft) };

  const report = validateEffectsDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new EffectsExportValidationError(report);
  }
  return report.document;
}
