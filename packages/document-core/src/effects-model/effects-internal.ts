import type { AtlasRef, BlendMode } from '@marionette/format/effects-types';
import type { BundleItemId, EffectId, EffectLayerId } from '../model/ids';
import {
  bundleToSnapshot,
  effectToSnapshot,
  type BundleSnapshot,
  type EffectSnapshot,
  type EffectsReadModel,
  type EffectsSnapshot,
} from './effects-read-model';
import type {
  BundleEntity,
  BundleItemEntity,
  EffectEntity,
  EffectLayerEntity,
  EffectLifeCurveEntity,
  EffectsState,
  LifeCurveField,
} from './effects-state';

// Internal mutable mirrors of the immutable entities: same fields with writable maps/arrays so BATCH mode
// patches in place during a slider drag without cloning the top-level map, then takes a single copy-on-write
// boundary at commitBatch (exactly the skeletal model's two-mode design). Entity OBJECTS that are replaced
// wholesale (layer bodies, curves, stop arrays, blend modes, bundle items) carry shared frozen refs safely.

interface MutableLayer {
  id: EffectLayerId;
  blendMode: BlendMode;
  body: EffectLayerEntity['body'];
  curves: Map<LifeCurveField, EffectLifeCurveEntity>;
}

interface MutableEffect {
  id: EffectId;
  name: string;
  duration: number | null;
  deterministic: boolean;
  simulationDt: number;
  blendMode: BlendMode;
  layerOrder: EffectLayerId[];
  layers: Map<EffectLayerId, MutableLayer>;
}

interface MutableBundle {
  name: string;
  itemOrder: BundleItemId[];
  items: Map<BundleItemId, BundleItemEntity>;
}

function toMutableLayer(layer: EffectLayerEntity): MutableLayer {
  return {
    id: layer.id,
    blendMode: layer.blendMode,
    body: layer.body,
    curves: new Map(layer.curves),
  };
}

function cloneMutableLayer(layer: MutableLayer): MutableLayer {
  return {
    id: layer.id,
    blendMode: layer.blendMode,
    body: layer.body,
    curves: new Map(layer.curves),
  };
}

function freezeLayer(layer: MutableLayer): EffectLayerEntity {
  return Object.freeze({
    id: layer.id,
    blendMode: layer.blendMode,
    body: layer.body,
    curves: new Map(layer.curves) as ReadonlyMap<LifeCurveField, EffectLifeCurveEntity>,
  });
}

function toMutableEffect(effect: EffectEntity): MutableEffect {
  const layers = new Map<EffectLayerId, MutableLayer>();
  for (const [id, layer] of effect.layers) layers.set(id, toMutableLayer(layer));
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

function cloneMutableEffect(effect: MutableEffect): MutableEffect {
  const layers = new Map<EffectLayerId, MutableLayer>();
  for (const [id, layer] of effect.layers) layers.set(id, cloneMutableLayer(layer));
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

function freezeEffect(effect: MutableEffect): EffectEntity {
  const layers = new Map<EffectLayerId, EffectLayerEntity>();
  for (const [id, layer] of effect.layers) layers.set(id, freezeLayer(layer));
  return Object.freeze({
    id: effect.id,
    name: effect.name,
    duration: effect.duration,
    deterministic: effect.deterministic,
    simulationDt: effect.simulationDt,
    blendMode: effect.blendMode,
    layerOrder: effect.layerOrder.slice(),
    layers,
  });
}

function toMutableBundle(bundle: BundleEntity): MutableBundle {
  return { name: bundle.name, itemOrder: bundle.itemOrder.slice(), items: new Map(bundle.items) };
}

function cloneMutableBundle(bundle: MutableBundle): MutableBundle {
  return { name: bundle.name, itemOrder: bundle.itemOrder.slice(), items: new Map(bundle.items) };
}

function freezeBundle(bundle: MutableBundle): BundleEntity {
  return Object.freeze({
    name: bundle.name,
    itemOrder: bundle.itemOrder.slice(),
    items: new Map(bundle.items) as ReadonlyMap<BundleItemId, BundleItemEntity>,
  });
}

// Recursively freeze the atlas so a read accessor or snapshot cannot mutate it (held verbatim, the same way
// the skeletal model freezes its preserved atlas).
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// The write-capable effects model (the effects mirror of DocumentModelInternal). NEVER exported through the
// package barrel: only createEffectsMutator (history-internal) and History reach it, the structural half of
// LAW 2 for effects. Two mutation modes: DISCRETE (default) replaces the changed map by copy-on-write;
// BATCH (between beginBatch/commitBatch, one gesture) mutates in place and takes a single copy-on-write
// boundary at commitBatch, so a 40-step field drag allocates O(1) per step instead of cloning the map each
// step. Change detection is revision-based, like the skeletal model.
export class EffectsModelInternal implements EffectsReadModel {
  private effectsFormatVersionValue: string;
  private nameValue: string;
  private atlasValue: AtlasRef;
  private effectOrderArr: EffectId[];
  private effectsMap: Map<EffectId, MutableEffect>;
  private bundleOrderArr: string[];
  private bundlesMap: Map<string, MutableBundle>;
  private batching = false;
  private revisionValue = 0;

  constructor(state: EffectsState) {
    this.effectsFormatVersionValue = state.effectsFormatVersion;
    this.nameValue = state.name;
    this.atlasValue = deepFreeze(structuredAtlasCopy(state.atlas));
    this.effectOrderArr = state.effectOrder.slice();
    this.effectsMap = new Map();
    for (const [id, effect] of state.effects) this.effectsMap.set(id, toMutableEffect(effect));
    this.bundleOrderArr = state.bundleOrder.slice();
    this.bundlesMap = new Map();
    for (const [name, bundle] of state.bundles) this.bundlesMap.set(name, toMutableBundle(bundle));
  }

  get revision(): number {
    return this.revisionValue;
  }

  get name(): string {
    return this.nameValue;
  }

  get effectsFormatVersion(): string {
    return this.effectsFormatVersionValue;
  }

  getEffect(id: EffectId): EffectEntity | undefined {
    const effect = this.effectsMap.get(id);
    return effect ? freezeEffect(effect) : undefined;
  }

  effects(): readonly EffectEntity[] {
    const out: EffectEntity[] = [];
    for (const id of this.effectOrderArr) {
      const effect = this.effectsMap.get(id);
      if (effect) out.push(freezeEffect(effect));
    }
    return out;
  }

  findEffectByName(name: string): EffectEntity | undefined {
    for (const id of this.effectOrderArr) {
      const effect = this.effectsMap.get(id);
      if (effect && effect.name === name) return freezeEffect(effect);
    }
    return undefined;
  }

  getLayer(effectId: EffectId, layerId: EffectLayerId): EffectLayerEntity | undefined {
    const layer = this.effectsMap.get(effectId)?.layers.get(layerId);
    return layer ? freezeLayer(layer) : undefined;
  }

  getBundle(name: string): BundleEntity | undefined {
    const bundle = this.bundlesMap.get(name);
    return bundle ? freezeBundle(bundle) : undefined;
  }

  bundles(): readonly BundleEntity[] {
    const out: BundleEntity[] = [];
    for (const name of this.bundleOrderArr) {
      const bundle = this.bundlesMap.get(name);
      if (bundle) out.push(freezeBundle(bundle));
    }
    return out;
  }

  atlas(): AtlasRef {
    return this.atlasValue;
  }

  snapshot(): EffectsSnapshot {
    const effects: EffectSnapshot[] = [...this.effectsMap.values()]
      .map((effect) => effectToSnapshot(freezeEffect(effect)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const bundles: BundleSnapshot[] = [...this.bundlesMap.values()]
      .map((bundle) => bundleToSnapshot(freezeBundle(bundle)))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return {
      effectsFormatVersion: this.effectsFormatVersionValue,
      name: this.nameValue,
      atlas: this.atlasValue,
      effectOrder: this.effectOrderArr.slice(),
      effects,
      bundleOrder: this.bundleOrderArr.slice(),
      bundles,
    };
  }

  // ----- effect write surface (reached only through the EffectsMutator) -----

  insertEffect(entity: EffectEntity, index: number): void {
    const effect = toMutableEffect(entity);
    if (this.batching) {
      this.effectsMap.set(effect.id, effect);
      this.effectOrderArr.splice(index, 0, effect.id);
    } else {
      const next = new Map(this.effectsMap);
      next.set(effect.id, effect);
      this.effectsMap = next;
      const order = this.effectOrderArr.slice();
      order.splice(index, 0, effect.id);
      this.effectOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeEffect(id: EffectId): void {
    if (this.batching) {
      this.effectsMap.delete(id);
      const i = this.effectOrderArr.indexOf(id);
      if (i >= 0) this.effectOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.effectsMap);
      next.delete(id);
      this.effectsMap = next;
      this.effectOrderArr = this.effectOrderArr.filter((x) => x !== id);
    }
    this.revisionValue += 1;
  }

  // Patch an effect's scalar fields (name / duration / deterministic / simulationDt / blendMode). Layer and
  // curve edits go through the dedicated write methods, so the patch paths never overlap.
  patchEffect(
    id: EffectId,
    patch: Partial<
      Pick<MutableEffect, 'name' | 'duration' | 'deterministic' | 'simulationDt' | 'blendMode'>
    >,
  ): void {
    this.writeEffect(id, (effect) => {
      if (patch.name !== undefined) effect.name = patch.name;
      if (patch.duration !== undefined) effect.duration = patch.duration;
      if (patch.deterministic !== undefined) effect.deterministic = patch.deterministic;
      if (patch.simulationDt !== undefined) effect.simulationDt = patch.simulationDt;
      if (patch.blendMode !== undefined) effect.blendMode = patch.blendMode;
    });
  }

  // ----- layer write surface -----

  insertLayer(effectId: EffectId, entity: EffectLayerEntity, index: number): void {
    this.writeEffect(effectId, (effect) => {
      effect.layers.set(entity.id, toMutableLayer(entity));
      effect.layerOrder.splice(index, 0, entity.id);
    });
  }

  removeLayer(effectId: EffectId, layerId: EffectLayerId): void {
    this.writeEffect(effectId, (effect) => {
      effect.layers.delete(layerId);
      const i = effect.layerOrder.indexOf(layerId);
      if (i >= 0) effect.layerOrder.splice(i, 1);
    });
  }

  setLayerOrder(effectId: EffectId, order: readonly EffectLayerId[]): void {
    this.writeEffect(effectId, (effect) => {
      effect.layerOrder.length = 0;
      for (const id of order) effect.layerOrder.push(id);
    });
  }

  setLayerBlendMode(effectId: EffectId, layerId: EffectLayerId, blendMode: BlendMode): void {
    this.writeLayer(effectId, layerId, (layer) => {
      layer.blendMode = blendMode;
    });
  }

  // Replace a layer's body wholesale (the SetLayerField command rebuilds the body with the changed field
  // and hands it in, so the model never patches a body in place). The body is treated as immutable.
  setLayerBody(effectId: EffectId, layerId: EffectLayerId, body: EffectLayerEntity['body']): void {
    this.writeLayer(effectId, layerId, (layer) => {
      layer.body = body;
    });
  }

  // Replace one of a layer's life curves wholesale (every curve command rebuilds the stop list and hands a
  // fresh EffectLifeCurveEntity in, so the model never patches stops in place; the round-trip relies on
  // this whole-curve memento symmetry).
  setLifeCurve(
    effectId: EffectId,
    layerId: EffectLayerId,
    field: LifeCurveField,
    curve: EffectLifeCurveEntity,
  ): void {
    this.writeLayer(effectId, layerId, (layer) => {
      const curves = new Map(layer.curves);
      curves.set(field, curve);
      layer.curves = curves;
    });
  }

  // ----- bundle write surface -----

  insertBundle(entity: BundleEntity, index: number): void {
    const bundle = toMutableBundle(entity);
    if (this.batching) {
      this.bundlesMap.set(bundle.name, bundle);
      this.bundleOrderArr.splice(index, 0, bundle.name);
    } else {
      const next = new Map(this.bundlesMap);
      next.set(bundle.name, bundle);
      this.bundlesMap = next;
      const order = this.bundleOrderArr.slice();
      order.splice(index, 0, bundle.name);
      this.bundleOrderArr = order;
    }
    this.revisionValue += 1;
  }

  removeBundle(name: string): void {
    if (this.batching) {
      this.bundlesMap.delete(name);
      const i = this.bundleOrderArr.indexOf(name);
      if (i >= 0) this.bundleOrderArr.splice(i, 1);
    } else {
      const next = new Map(this.bundlesMap);
      next.delete(name);
      this.bundlesMap = next;
      this.bundleOrderArr = this.bundleOrderArr.filter((x) => x !== name);
    }
    this.revisionValue += 1;
  }

  insertBundleItem(bundleName: string, item: BundleItemEntity, index: number): void {
    this.writeBundle(bundleName, (bundle) => {
      bundle.items.set(item.id, item);
      bundle.itemOrder.splice(index, 0, item.id);
    });
  }

  removeBundleItem(bundleName: string, itemId: BundleItemId): void {
    this.writeBundle(bundleName, (bundle) => {
      bundle.items.delete(itemId);
      const i = bundle.itemOrder.indexOf(itemId);
      if (i >= 0) bundle.itemOrder.splice(i, 1);
    });
  }

  setBundleItemOrder(bundleName: string, order: readonly BundleItemId[]): void {
    this.writeBundle(bundleName, (bundle) => {
      bundle.itemOrder.length = 0;
      for (const id of order) bundle.itemOrder.push(id);
    });
  }

  // Replace a bundle item wholesale (the SetBundleItem command rebuilds the item with the changed field).
  setBundleItem(bundleName: string, item: BundleItemEntity): void {
    this.writeBundle(bundleName, (bundle) => {
      bundle.items.set(item.id, item);
    });
  }

  // ----- atlas write surface -----

  setAtlas(atlas: AtlasRef): void {
    this.atlasValue = deepFreeze(structuredAtlasCopy(atlas));
    this.revisionValue += 1;
  }

  // The single copy-on-write boundary for an effect edit: DISCRETE clones the target effect (so a sibling
  // stays shared and a reference-equality selector sees exactly one change), BATCH mutates it in place. A
  // missing id is a no-op (commands assert existence before writing).
  private writeEffect(id: EffectId, mutate: (effect: MutableEffect) => void): void {
    const current = this.effectsMap.get(id);
    if (!current) return;
    if (this.batching) {
      mutate(current);
    } else {
      const clone = cloneMutableEffect(current);
      mutate(clone);
      const next = new Map(this.effectsMap);
      next.set(id, clone);
      this.effectsMap = next;
    }
    this.revisionValue += 1;
  }

  private writeLayer(
    effectId: EffectId,
    layerId: EffectLayerId,
    mutate: (layer: MutableLayer) => void,
  ): void {
    this.writeEffect(effectId, (effect) => {
      const layer = effect.layers.get(layerId);
      if (!layer) return;
      mutate(layer);
    });
  }

  private writeBundle(name: string, mutate: (bundle: MutableBundle) => void): void {
    const current = this.bundlesMap.get(name);
    if (!current) return;
    if (this.batching) {
      mutate(current);
    } else {
      const clone = cloneMutableBundle(current);
      mutate(clone);
      const next = new Map(this.bundlesMap);
      next.set(name, clone);
      this.bundlesMap = next;
    }
    this.revisionValue += 1;
  }

  beginBatch(): void {
    this.batching = true;
  }

  commitBatch(): void {
    // Single copy-on-write boundary for the whole gesture: fresh top-level maps and order arrays so a
    // reference-equality selector sees one change, not one per step. Inner effect/bundle objects edited
    // in place during the batch are re-cloned so the post-gesture state never aliases a memento.
    const effects = new Map<EffectId, MutableEffect>();
    for (const [id, effect] of this.effectsMap) effects.set(id, cloneMutableEffect(effect));
    this.effectsMap = effects;
    this.effectOrderArr = this.effectOrderArr.slice();
    const bundles = new Map<string, MutableBundle>();
    for (const [name, bundle] of this.bundlesMap) bundles.set(name, cloneMutableBundle(bundle));
    this.bundlesMap = bundles;
    this.bundleOrderArr = this.bundleOrderArr.slice();
    this.batching = false;
  }

  cancelBatch(): void {
    this.batching = false;
  }
}

// Copy the atlas into a fresh plain structure so the deep-freeze never freezes a caller's object. The atlas
// is a small nested record; rebuilding it by value keeps the model free of any aliasing with the import or
// a command's memento.
function structuredAtlasCopy(atlas: AtlasRef): AtlasRef {
  return {
    pages: atlas.pages.map((page) => ({
      file: page.file,
      width: page.width,
      height: page.height,
      regions: page.regions.map((region) => ({ ...region })),
    })),
  };
}

// A read-only facade over the internal effects model, handed to UI and the MCP server as
// Document.effects. The internal instance has PUBLIC write methods, so returning it directly (even typed
// as EffectsReadModel) would let a holder reach the write surface through an `as` cast and bypass LAW 2.
// This facade exposes ONLY the read methods, so the write capability is reachable solely through History
// via the EffectsMutator (the exact structural guard the skeletal createReadModel applies).
export function createEffectsReadModel(model: EffectsModelInternal): EffectsReadModel {
  return {
    get revision(): number {
      return model.revision;
    },
    get name(): string {
      return model.name;
    },
    getEffect: (id) => model.getEffect(id),
    effects: () => model.effects(),
    findEffectByName: (name) => model.findEffectByName(name),
    getLayer: (effectId, layerId) => model.getLayer(effectId, layerId),
    getBundle: (name) => model.getBundle(name),
    bundles: () => model.bundles(),
    atlas: () => model.atlas(),
    snapshot: () => model.snapshot(),
  };
}
