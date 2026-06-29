import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectLayerEntity } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Remove a layer from an effect by EffectLayerId (section 10 RemoveLayer). The before memento captures the
// whole layer entity (with its curves and stop ids) and its index in layerOrder, so one undo restores it at
// its exact prior z position. Never coalesces.
export class RemoveLayerCommand implements Command {
  readonly kind = 'effect.layer.remove';
  readonly label = 'Remove Layer';
  private before: EffectLayerEntity | undefined;
  private index = -1;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const effect = ctx.effects.getEffect(this.effectId);
      if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
      const layer = effect.layers.get(this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      this.before = layer;
      this.index = effect.layerOrder.indexOf(this.layerId);
    }
    ctx.effects.removeLayer(this.effectId, this.layerId);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    const effect = ctx.effects.getEffect(this.effectId);
    const fallback = effect ? effect.layerOrder.length : 0;
    ctx.effects.insertLayer(this.effectId, this.before, this.index < 0 ? fallback : this.index);
  }
}

export const removeLayerSpec: EffectCommandSpec = {
  kind: 'effect.layer.remove',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    return { command: new RemoveLayerCommand(target.id, layerId) };
  },
  assertApplied: (before, after) => {
    const b = before.effects.find((effect) => effect.name === 'coinShower');
    const a = after.effects.find((effect) => effect.name === 'coinShower');
    if (!a || !b) throw new Error('effect.layer.remove target effect missing');
    if (a.layerOrder.length !== b.layerOrder.length - 1) {
      throw new Error('effect.layer.remove did not remove exactly one layer');
    }
  },
};
