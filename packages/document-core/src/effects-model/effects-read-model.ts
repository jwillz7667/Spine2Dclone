import type { AtlasRef, BlendMode, CurveType } from '@marionette/format/effects-types';
import { cloneEffectsCurve, cloneLifeStopValue } from './effects-state';
import type {
  BundleEntity,
  BundleItemEntity,
  EffectEntity,
  EffectLayerEntity,
  EffectLifeCurveEntity,
  EffectLayerBody,
  LifeCurveField,
  LifeStopValue,
} from './effects-state';
import type { BundleItemId, EffectId, EffectLayerId } from '../model/ids';

// The public read surface of the effects model, handed to the UI/MCP and to commands. Every accessor
// returns a frozen value copy or a readonly view; no accessor leaks a handle that can mutate the model.
// The only write surface is the EffectsMutator (effects-mutator.ts), reachable only from History. Mirrors
// the skeletal DocumentReadModel exactly.
export interface EffectsReadModel {
  // Bumps on every applied effects mutation. The effects model shares the skeletal model's revision
  // counter via the combined History, so a single "something changed" signal drives both.
  readonly revision: number;
  readonly name: string;
  getEffect(id: EffectId): EffectEntity | undefined;
  // All effects in effectOrder (the stable enumeration order; on disk the record is name-keyed).
  effects(): readonly EffectEntity[];
  // First effect whose name matches, or undefined. Names are not internally unique mid-edit (uniqueness is
  // an export-only contract, section 8.1.1), so this is first-match by design (like findBoneByName).
  findEffectByName(name: string): EffectEntity | undefined;
  getLayer(effectId: EffectId, layerId: EffectLayerId): EffectLayerEntity | undefined;
  getBundle(name: string): BundleEntity | undefined;
  bundles(): readonly BundleEntity[]; // in bundleOrder
  atlas(): AtlasRef;
  // Canonical, deterministically-ordered, deep-equality-comparable projection.
  snapshot(): EffectsSnapshot;
}

// Plain, JSON-serializable projections for the round-trip harness deep-equal (the effects mirror of the
// skeletal DocSnapshot). Maps serialize as arrays sorted by id; order-significant arrays (layerOrder,
// itemOrder, stop order) preserve order; numbers are verbatim (undo restores stored mementos, so the
// round-trip is bit-exact, no epsilon).

export interface LifeStopSnapshot {
  readonly id: string;
  readonly t: number;
  readonly value: LifeStopValue;
  readonly curve: CurveType;
}

export interface LifeCurveSnapshot {
  readonly field: LifeCurveField;
  readonly stops: readonly LifeStopSnapshot[];
}

export interface EffectLayerSnapshot {
  readonly id: string;
  readonly blendMode: BlendMode;
  readonly body: EffectLayerBody;
  readonly curves: readonly LifeCurveSnapshot[]; // sorted by field
}

export interface EffectSnapshot {
  readonly id: string;
  readonly name: string;
  readonly duration: number | null;
  readonly deterministic: boolean;
  readonly simulationDt: number;
  readonly blendMode: BlendMode;
  readonly layerOrder: readonly string[]; // order-significant (z order)
  readonly layers: readonly EffectLayerSnapshot[]; // sorted by id
}

export interface BundleItemSnapshot {
  readonly id: string;
  readonly effect: string; // the referenced EffectId (a reference, stable across an effect rename)
  readonly startOffset: number;
  readonly anchorRole: string;
  readonly seedSalt: number;
}

export interface BundleSnapshot {
  readonly name: string;
  readonly itemOrder: readonly string[]; // order-significant
  readonly items: readonly BundleItemSnapshot[]; // sorted by id
}

export interface EffectsSnapshot {
  readonly effectsFormatVersion: string;
  readonly name: string;
  readonly atlas: AtlasRef;
  readonly effectOrder: readonly string[]; // order-significant (enumeration order)
  readonly effects: readonly EffectSnapshot[]; // sorted by id
  readonly bundleOrder: readonly string[]; // order-significant
  readonly bundles: readonly BundleSnapshot[]; // sorted by name
}

// Deep-copy a life-curve body so a snapshot never aliases the live model. The body is a discriminated
// union of plain value objects (ranges, vec2, spawn/shape/texture unions); a structured clone via JSON is
// avoided (it would drop nothing here but loses type safety), so each member is rebuilt by value. Because
// the body is treated as immutable and replaced wholesale, returning the same frozen reference is safe;
// the snapshot copies are taken only where a caller could otherwise mutate (none mutate the body), so we
// hand back the frozen body directly, exactly as the skeletal snapshot hands back frozen preserved content.
export function lifeStopToSnapshot(stop: {
  readonly id: string;
  readonly t: number;
  readonly value: LifeStopValue;
  readonly curve: CurveType;
}): LifeStopSnapshot {
  return {
    id: stop.id,
    t: stop.t,
    value: cloneLifeStopValue(stop.value),
    curve: cloneEffectsCurve(stop.curve),
  };
}

export function lifeCurveToSnapshot(
  field: LifeCurveField,
  curve: EffectLifeCurveEntity,
): LifeCurveSnapshot {
  return { field, stops: curve.stops.map(lifeStopToSnapshot) };
}

export function layerToSnapshot(layer: EffectLayerEntity): EffectLayerSnapshot {
  const curves: LifeCurveSnapshot[] = [];
  for (const [field, curve] of layer.curves) curves.push(lifeCurveToSnapshot(field, curve));
  curves.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  return { id: layer.id, blendMode: layer.blendMode, body: layer.body, curves };
}

export function effectToSnapshot(effect: EffectEntity): EffectSnapshot {
  const layers: EffectLayerSnapshot[] = [];
  for (const layer of effect.layers.values()) layers.push(layerToSnapshot(layer));
  layers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    id: effect.id,
    name: effect.name,
    duration: effect.duration,
    deterministic: effect.deterministic,
    simulationDt: effect.simulationDt,
    blendMode: effect.blendMode,
    layerOrder: effect.layerOrder.slice(),
    layers,
  };
}

export function bundleItemToSnapshot(item: BundleItemEntity): BundleItemSnapshot {
  return {
    id: item.id,
    effect: item.effect,
    startOffset: item.startOffset,
    anchorRole: item.anchorRole,
    seedSalt: item.seedSalt,
  };
}

export function bundleToSnapshot(bundle: BundleEntity): BundleSnapshot {
  const items: BundleItemSnapshot[] = [];
  for (const item of bundle.items.values()) items.push(bundleItemToSnapshot(item));
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { name: bundle.name, itemOrder: bundle.itemOrder.slice(), items };
}

// Helpers shared by spec assertions: find a projection by its addressable id within a snapshot.
export function findEffectSnapshot(
  snapshot: EffectsSnapshot,
  id: string,
): EffectSnapshot | undefined {
  return snapshot.effects.find((effect) => effect.id === id);
}

export function findLayerSnapshot(
  snapshot: EffectsSnapshot,
  effectId: string,
  layerId: string,
): EffectLayerSnapshot | undefined {
  return findEffectSnapshot(snapshot, effectId)?.layers.find((layer) => layer.id === layerId);
}

export function findBundleSnapshot(
  snapshot: EffectsSnapshot,
  name: string,
): BundleSnapshot | undefined {
  return snapshot.bundles.find((bundle) => bundle.name === name);
}

export function findBundleItemSnapshot(
  snapshot: EffectsSnapshot,
  bundleName: string,
  itemId: string,
): BundleItemSnapshot | undefined {
  return findBundleSnapshot(snapshot, bundleName)?.items.find((item) => item.id === itemId);
}

// Re-export the id brand string forms used by the helpers (the snapshots carry ids as plain strings, so a
// caller compares against `effectId` etc. directly).
export type { EffectId, EffectLayerId, BundleItemId };
