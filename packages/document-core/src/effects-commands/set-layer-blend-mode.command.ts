import type { BlendMode } from '@marionette/format/effects-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectId, EffectLayerId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Set a layer's per-layer blend mode (section 10 SetLayerBlendMode; reuses the format BlendMode). Targets
// the layer by EffectLayerId. The before memento is the prior blend mode. Never coalesces (a blend mode is
// a discrete pick, not a drag).
export class SetLayerBlendModeCommand implements Command {
  readonly kind = 'effect.layer.blendMode';
  readonly label = 'Set Layer Blend Mode';
  private before: BlendMode | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly blendMode: BlendMode,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      this.before = layer.blendMode;
    }
    ctx.effects.setLayerBlendMode(this.effectId, this.layerId, this.blendMode);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLayerBlendMode(this.effectId, this.layerId, this.before);
  }
}

export const setLayerBlendModeSpec: EffectCommandSpec = {
  kind: 'effect.layer.blendMode',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    if (!layer) return null;
    // Flip to a mode guaranteed different for a real delta.
    const next: BlendMode = layer.blendMode === 'additive' ? 'normal' : 'additive';
    return { command: new SetLayerBlendModeCommand(target.id, layerId, next) };
  },
  assertApplied: (before, after) => {
    const find = (snap: typeof before): string | undefined => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      return effect?.layers.find((l) => l.id === layerId)?.blendMode;
    };
    if (find(before) === find(after)) {
      throw new Error('effect.layer.blendMode produced no delta');
    }
  },
};
