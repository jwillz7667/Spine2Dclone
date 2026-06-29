// Barrel for the effect-editing commands (WP-3.7). Mirrors the skeletal commands barrel: exports each
// command class (for the UI / MCP), the init/patch types, and the registry + spec for the effects
// round-trip harness.

export { CreateEffectCommand, createEffectSpec } from './create-effect.command';
export type { CreateEffectInit } from './create-effect.command';
export { DeleteEffectCommand, deleteEffectSpec } from './delete-effect.command';
export { RenameEffectCommand, renameEffectSpec } from './rename-effect.command';
export { SetEffectMetaCommand, setEffectMetaSpec } from './set-effect-meta.command';
export type { EffectMetaPatch } from './set-effect-meta.command';
export {
  SetEffectsAtlasCommand,
  setEffectsAtlasSpec,
  atlasKeepingSeedRegions,
} from './set-effects-atlas.command';

export { AddLayerCommand, addLayerSpec } from './add-layer.command';
export { RemoveLayerCommand, removeLayerSpec } from './remove-layer.command';
export { ReorderLayersCommand, reorderLayersSpec } from './reorder-layers.command';
export {
  SetLayerFieldCommand,
  setLayerFieldSpec,
  withEmitterDrag,
} from './set-layer-field.command';
export { SetLayerBlendModeCommand, setLayerBlendModeSpec } from './set-layer-blend-mode.command';
export { buildDefaultLayer } from './layer-defaults';
export type { NewLayerKind } from './layer-defaults';

export { AddLifeStopCommand, addLifeStopSpec } from './add-life-stop.command';
export { RemoveLifeStopCommand, removeLifeStopSpec } from './remove-life-stop.command';
export { MoveLifeStopCommand, moveLifeStopSpec } from './move-life-stop.command';
export { SetLifeStopValueCommand, setLifeStopValueSpec } from './set-life-stop-value.command';
export { SetLifeStopCurveCommand, setLifeStopCurveSpec } from './set-life-stop-curve.command';
export { assertValidStopOrder, locateStop } from './life-curve-support';
export type { LocatedStop } from './life-curve-support';

export { CreateBundleCommand, createBundleSpec } from './create-bundle.command';
export { DeleteBundleCommand, deleteBundleSpec } from './delete-bundle.command';
export { AddBundleItemCommand, addBundleItemSpec } from './add-bundle-item.command';
export type { BundleItemInit } from './add-bundle-item.command';
export { RemoveBundleItemCommand, removeBundleItemSpec } from './remove-bundle-item.command';
export { ReorderBundleItemsCommand, reorderBundleItemsSpec } from './reorder-bundle-items.command';
export { SetBundleItemCommand, setBundleItemSpec } from './set-bundle-item.command';
export type { BundleItemPatch } from './set-bundle-item.command';

export { effectsCommandRegistry } from './registry';
export type { EffectCommandSpec, EffectCommandFixture } from './effects-spec';
