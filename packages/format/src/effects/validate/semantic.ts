import { jsonPointer } from '../../validate/structural';
import type { EffectsDocument } from '../schema/document';
import type { EffectConfig } from '../schema/effect';
import type { EffectLayer } from '../schema/layers';
import type { LifeCurveNumber, LifeCurveRgb } from '../schema/life-curve';
import type { RangeF } from '../schema/primitives';
import { effectsError } from './errors';
import type { EffectsError } from './errors';

// Semantic (graph) layer for the effects format (phase-3-vfx-particles.md section 8.1, WP-3.0
// TASK-3.0.4). Referential integrity and the invariants Zod cannot express, collected in one pass.
// Each family is independent: the checks never short-circuit each other, so one document surfaces
// every distinct fault at once (mirroring the skeletal validator's collect-all posture).

// The set of atlas region names defined in the document. Region uniqueness across pages is NOT
// re-checked here (it is the skeletal ATLAS family's job and the VFX atlas comes from the same pack
// pipeline); the effects layer only needs to confirm every referenced region RESOLVES.
function atlasRegionNames(doc: EffectsDocument): Set<string> {
  const names = new Set<string>();
  for (const page of doc.atlas.pages) {
    for (const region of page.regions) names.add(region.name);
  }
  return names;
}

// Check one RangeF for `min <= max` (EFFECT_RANGE_MIN_GT_MAX). The path points at the range node.
function checkRange(
  range: RangeF,
  path: ReadonlyArray<string | number>,
  errors: EffectsError[],
): void {
  if (range.min > range.max) {
    errors.push(
      effectsError(
        'EFFECT_RANGE_MIN_GT_MAX',
        jsonPointer(path),
        `range min ${range.min} must be less than or equal to max ${range.max}`,
        { min: range.min, max: range.max },
      ),
    );
  }
}

// Check one LifeCurve's stops: first.t === 0, last.t === 1, and strictly increasing t
// (EFFECT_LIFECURVE_STOP_ORDER). The two-stop floor is structural (.min(2)); here we verify the
// anchors and ordering. A single curve may raise more than one ordering issue, all in this family.
function checkLifeCurve(
  curve: LifeCurveNumber | LifeCurveRgb,
  path: ReadonlyArray<string | number>,
  errors: EffectsError[],
): void {
  const stops = curve.stops;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first !== undefined && first.t !== 0) {
    errors.push(
      effectsError(
        'EFFECT_LIFECURVE_STOP_ORDER',
        jsonPointer([...path, 'stops', 0, 't']),
        `life curve first stop t must be 0, received ${first.t}`,
        { t: first.t },
      ),
    );
  }
  if (last !== undefined && last.t !== 1) {
    errors.push(
      effectsError(
        'EFFECT_LIFECURVE_STOP_ORDER',
        jsonPointer([...path, 'stops', stops.length - 1, 't']),
        `life curve last stop t must be 1, received ${last.t}`,
        { t: last.t },
      ),
    );
  }
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const current = stops[i];
    if (previous !== undefined && current !== undefined && current.t <= previous.t) {
      errors.push(
        effectsError(
          'EFFECT_LIFECURVE_STOP_ORDER',
          jsonPointer([...path, 'stops', i, 't']),
          `life curve stop t must strictly ascend, ${current.t} does not follow ${previous.t}`,
          { t: current.t, previous: previous.t },
        ),
      );
    }
  }
}

// Confirm a referenced region resolves in the document atlas (EFFECT_REGION_MISSING).
function checkRegion(
  region: string,
  regionNames: ReadonlySet<string>,
  path: ReadonlyArray<string | number>,
  errors: EffectsError[],
): void {
  if (!regionNames.has(region)) {
    errors.push(
      effectsError(
        'EFFECT_REGION_MISSING',
        jsonPointer(path),
        `region "${region}" does not resolve in the document atlas`,
        { region },
      ),
    );
  }
}

// Walk one layer: range bounds, life-curve ordering, and region resolution, with paths rooted at the
// layer's index within the effect.
function checkLayer(
  layer: EffectLayer,
  regionNames: ReadonlySet<string>,
  base: ReadonlyArray<string | number>,
  errors: EffectsError[],
): void {
  if (layer.type === 'emitter') {
    for (const field of [
      'lifetime',
      'startSpeed',
      'emissionAngle',
      'startRotation',
      'angularVelocity',
      'startScale',
    ] as const) {
      checkRange(layer[field], [...base, field], errors);
    }
    checkLifeCurve(layer.scaleOverLife, [...base, 'scaleOverLife'], errors);
    checkLifeCurve(layer.colorOverLife, [...base, 'colorOverLife'], errors);
    checkLifeCurve(layer.alphaOverLife, [...base, 'alphaOverLife'], errors);
    if (layer.texture.kind === 'static') {
      checkRegion(layer.texture.region, regionNames, [...base, 'texture', 'region'], errors);
    } else {
      layer.texture.regions.forEach((region, regionIndex) => {
        checkRegion(region, regionNames, [...base, 'texture', 'regions', regionIndex], errors);
      });
    }
    // Bursts must fire in strictly ascending time (EFFECT_BURST_TIME_ORDER).
    if (layer.spawn.mode === 'bursts') {
      const bursts = layer.spawn.bursts;
      for (let i = 1; i < bursts.length; i += 1) {
        const previous = bursts[i - 1];
        const current = bursts[i];
        if (previous !== undefined && current !== undefined && current.atTime <= previous.atTime) {
          errors.push(
            effectsError(
              'EFFECT_BURST_TIME_ORDER',
              jsonPointer([...base, 'spawn', 'bursts', i, 'atTime']),
              `burst atTime must strictly ascend, ${current.atTime} does not follow ${previous.atTime}`,
              { atTime: current.atTime, previous: previous.atTime },
            ),
          );
        }
      }
    }
    if (layer.particleTrail !== null) {
      checkRegion(
        layer.particleTrail.region,
        regionNames,
        [...base, 'particleTrail', 'region'],
        errors,
      );
      checkLifeCurve(
        layer.particleTrail.widthOverLength,
        [...base, 'particleTrail', 'widthOverLength'],
        errors,
      );
      checkLifeCurve(
        layer.particleTrail.alphaOverLength,
        [...base, 'particleTrail', 'alphaOverLength'],
        errors,
      );
    }
    return;
  }
  if (layer.type === 'spriteAnimator') {
    checkRegion(layer.region, regionNames, [...base, 'region'], errors);
    checkLifeCurve(layer.scaleOverLife, [...base, 'scaleOverLife'], errors);
    checkLifeCurve(layer.colorOverLife, [...base, 'colorOverLife'], errors);
    checkLifeCurve(layer.alphaOverLife, [...base, 'alphaOverLife'], errors);
    return;
  }
  // ribbonTrail
  checkRegion(layer.region, regionNames, [...base, 'region'], errors);
  checkLifeCurve(layer.widthOverLength, [...base, 'widthOverLength'], errors);
  checkLifeCurve(layer.colorOverLength, [...base, 'colorOverLength'], errors);
  checkLifeCurve(layer.alphaOverLength, [...base, 'alphaOverLength'], errors);
}

// One effect: the map key must equal the inner `name` (EFFECT_NAME_KEY_MISMATCH), `simulationDt > 0`
// (EFFECT_SIMULATION_DT), and every layer's ranges/curves/regions are checked.
function checkEffect(
  key: string,
  effect: EffectConfig,
  regionNames: ReadonlySet<string>,
  errors: EffectsError[],
): void {
  if (effect.name !== key) {
    errors.push(
      effectsError(
        'EFFECT_NAME_KEY_MISMATCH',
        jsonPointer(['effects', key, 'name']),
        `effect map key "${key}" must equal the effect name "${effect.name}"`,
        { key, name: effect.name },
      ),
    );
  }
  if (!(effect.simulationDt > 0)) {
    errors.push(
      effectsError(
        'EFFECT_SIMULATION_DT',
        jsonPointer(['effects', key, 'simulationDt']),
        `simulationDt must be greater than zero, received ${effect.simulationDt}`,
        { simulationDt: effect.simulationDt },
      ),
    );
  }
  effect.layers.forEach((layer, layerIndex) => {
    checkLayer(layer, regionNames, ['effects', key, 'layers', layerIndex], errors);
  });
}

// EFFECTS family: name-key consistency, effect-name uniqueness (export contract), and per-effect
// invariants over a structurally valid document.
function checkEffects(doc: EffectsDocument): EffectsError[] {
  const errors: EffectsError[] = [];
  const regionNames = atlasRegionNames(doc);
  const seenNames = new Set<string>();
  for (const [key, effect] of Object.entries(doc.effects)) {
    // Name uniqueness is an EXPORT-only contract (section 8.1.1). Here the inner names form a set;
    // a collision across two entries is surfaced once for the second occurrence.
    if (seenNames.has(effect.name)) {
      errors.push(
        effectsError(
          'EFFECT_NAME_DUPLICATE',
          jsonPointer(['effects', key, 'name']),
          `effect name "${effect.name}" is not unique across the library`,
          { name: effect.name },
        ),
      );
    } else {
      seenNames.add(effect.name);
    }
    checkEffect(key, effect, regionNames, errors);
  }
  return errors;
}

// BUNDLE family: bundle map key equals inner name; each item's `effect` resolves to a defined effect;
// `anchorRole` is non-empty (the .min(1) schema bound makes the empty-string case structural, so the
// semantic guard catches a whitespace-only role the schema admits).
function checkBundles(doc: EffectsDocument): EffectsError[] {
  const errors: EffectsError[] = [];
  const effectNames = new Set(Object.values(doc.effects).map((effect) => effect.name));
  for (const [key, bundle] of Object.entries(doc.bundles)) {
    if (bundle.name !== key) {
      errors.push(
        effectsError(
          'BUNDLE_NAME_KEY_MISMATCH',
          jsonPointer(['bundles', key, 'name']),
          `bundle map key "${key}" must equal the bundle name "${bundle.name}"`,
          { key, name: bundle.name },
        ),
      );
    }
    bundle.items.forEach((item, itemIndex) => {
      if (!effectNames.has(item.effect)) {
        errors.push(
          effectsError(
            'BUNDLE_EFFECT_MISSING',
            jsonPointer(['bundles', key, 'items', itemIndex, 'effect']),
            `bundle item references effect "${item.effect}", which the library does not define`,
            { effect: item.effect },
          ),
        );
      }
      if (item.anchorRole.trim() === '') {
        errors.push(
          effectsError(
            'BUNDLE_ANCHOR_ROLE_EMPTY',
            jsonPointer(['bundles', key, 'items', itemIndex, 'anchorRole']),
            'bundle item anchorRole must be a non-empty string',
          ),
        );
      }
    });
  }
  return errors;
}

// Run every effects semantic family over a structurally valid document and collect all errors.
export function validateEffectsSemantic(doc: EffectsDocument): EffectsError[] {
  return [...checkEffects(doc), ...checkBundles(doc)];
}
