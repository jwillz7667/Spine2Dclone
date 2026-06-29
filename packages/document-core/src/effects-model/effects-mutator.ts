import type { AtlasRef, BlendMode } from '@marionette/format/effects-types';
import type { BundleItemId, EffectId, EffectLayerId } from '../model/ids';
import type { EffectsModelInternal } from './effects-internal';
import type { EffectsReadModel } from './effects-read-model';
import type {
  BundleEntity,
  BundleItemEntity,
  EffectEntity,
  EffectLayerEntity,
  EffectLifeCurveEntity,
  LifeCurveField,
} from './effects-state';

// The unforgeable witness for the effects write surface (the effects mirror of the skeletal MUTATOR_BRAND).
// A real runtime symbol whose TYPE is a `unique symbol`, so `someObject as EffectsMutator` cannot fabricate
// the brand. Neither the symbol nor the EffectsMutator type nor createEffectsMutator is re-exported through
// the package barrel, so an effect command obtains a mutator only by being handed one in its CommandContext.
const EFFECTS_MUTATOR_BRAND: unique symbol = Symbol('document-core.effects-mutator');

export interface EffectsMutator extends EffectsReadModel {
  readonly [EFFECTS_MUTATOR_BRAND]: true;
  insertEffect(entity: EffectEntity, index: number): void;
  removeEffect(id: EffectId): void;
  patchEffect(
    id: EffectId,
    patch: {
      readonly name?: string;
      readonly duration?: number | null;
      readonly deterministic?: boolean;
      readonly simulationDt?: number;
      readonly blendMode?: BlendMode;
    },
  ): void;
  insertLayer(effectId: EffectId, entity: EffectLayerEntity, index: number): void;
  removeLayer(effectId: EffectId, layerId: EffectLayerId): void;
  setLayerOrder(effectId: EffectId, order: readonly EffectLayerId[]): void;
  setLayerBlendMode(effectId: EffectId, layerId: EffectLayerId, blendMode: BlendMode): void;
  setLayerBody(effectId: EffectId, layerId: EffectLayerId, body: EffectLayerEntity['body']): void;
  setLifeCurve(
    effectId: EffectId,
    layerId: EffectLayerId,
    field: LifeCurveField,
    curve: EffectLifeCurveEntity,
  ): void;
  insertBundle(entity: BundleEntity, index: number): void;
  removeBundle(name: string): void;
  insertBundleItem(bundleName: string, item: BundleItemEntity, index: number): void;
  removeBundleItem(bundleName: string, itemId: BundleItemId): void;
  setBundleItemOrder(bundleName: string, order: readonly BundleItemId[]): void;
  setBundleItem(bundleName: string, item: BundleItemEntity): void;
  setAtlas(atlas: AtlasRef): void;
}

// The ONLY factory that can produce an EffectsMutator. History receives it at construction; nothing else
// imports this. The returned object delegates reads and writes to the internal model and carries the brand.
export function createEffectsMutator(model: EffectsModelInternal): EffectsMutator {
  return {
    [EFFECTS_MUTATOR_BRAND]: true,
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
    insertEffect: (entity, index) => model.insertEffect(entity, index),
    removeEffect: (id) => model.removeEffect(id),
    patchEffect: (id, patch) => model.patchEffect(id, patch),
    insertLayer: (effectId, entity, index) => model.insertLayer(effectId, entity, index),
    removeLayer: (effectId, layerId) => model.removeLayer(effectId, layerId),
    setLayerOrder: (effectId, order) => model.setLayerOrder(effectId, order),
    setLayerBlendMode: (effectId, layerId, blendMode) =>
      model.setLayerBlendMode(effectId, layerId, blendMode),
    setLayerBody: (effectId, layerId, body) => model.setLayerBody(effectId, layerId, body),
    setLifeCurve: (effectId, layerId, field, curve) =>
      model.setLifeCurve(effectId, layerId, field, curve),
    insertBundle: (entity, index) => model.insertBundle(entity, index),
    removeBundle: (name) => model.removeBundle(name),
    insertBundleItem: (bundleName, item, index) => model.insertBundleItem(bundleName, item, index),
    removeBundleItem: (bundleName, itemId) => model.removeBundleItem(bundleName, itemId),
    setBundleItemOrder: (bundleName, order) => model.setBundleItemOrder(bundleName, order),
    setBundleItem: (bundleName, item) => model.setBundleItem(bundleName, item),
    setAtlas: (atlas) => model.setAtlas(atlas),
  };
}
