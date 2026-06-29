import { addBundleItemSpec } from './add-bundle-item.command';
import { addLayerSpec } from './add-layer.command';
import { addLifeStopSpec } from './add-life-stop.command';
import { createBundleSpec } from './create-bundle.command';
import { createEffectSpec } from './create-effect.command';
import { deleteBundleSpec } from './delete-bundle.command';
import { deleteEffectSpec } from './delete-effect.command';
import { moveLifeStopSpec } from './move-life-stop.command';
import { removeBundleItemSpec } from './remove-bundle-item.command';
import { removeLayerSpec } from './remove-layer.command';
import { removeLifeStopSpec } from './remove-life-stop.command';
import { renameEffectSpec } from './rename-effect.command';
import { reorderBundleItemsSpec } from './reorder-bundle-items.command';
import { reorderLayersSpec } from './reorder-layers.command';
import { setBundleItemSpec } from './set-bundle-item.command';
import { setEffectMetaSpec } from './set-effect-meta.command';
import { setEffectsAtlasSpec } from './set-effects-atlas.command';
import { setLayerBlendModeSpec } from './set-layer-blend-mode.command';
import { setLayerFieldSpec } from './set-layer-field.command';
import { setLifeStopCurveSpec } from './set-life-stop-curve.command';
import { setLifeStopValueSpec } from './set-life-stop-value.command';
import type { EffectCommandSpec } from './effects-spec';

// The single discovery point for the effect commands (the effects mirror of commandRegistry, command-history
// Section 10.1). Every effect command file appends its spec here; the effects discovery guard globs
// *.command.ts under effects-commands/ and fails CI if any kind is missing or any entry lacks its file, so
// the mandatory do/undo round-trip cannot be silently skipped. These are the section-10 commands (WP-3.7).
export const effectsCommandRegistry: readonly EffectCommandSpec[] = [
  // Effect-level (TASK-3.7.1)
  createEffectSpec,
  deleteEffectSpec,
  renameEffectSpec,
  setEffectMetaSpec,
  setEffectsAtlasSpec,
  // Layer-level (TASK-3.7.2)
  addLayerSpec,
  removeLayerSpec,
  reorderLayersSpec,
  setLayerFieldSpec,
  setLayerBlendModeSpec,
  // Life-curve (TASK-3.7.3)
  addLifeStopSpec,
  removeLifeStopSpec,
  moveLifeStopSpec,
  setLifeStopValueSpec,
  setLifeStopCurveSpec,
  // Bundle (TASK-3.7.4)
  createBundleSpec,
  deleteBundleSpec,
  addBundleItemSpec,
  removeBundleItemSpec,
  reorderBundleItemsSpec,
  setBundleItemSpec,
];
