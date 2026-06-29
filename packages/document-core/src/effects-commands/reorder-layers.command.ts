import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectId, EffectLayerId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Reorder an effect's layers by passing an ordered EffectLayerId[] (section 10 ReorderLayers; addresses by
// id, never by index, so the reorder survives an interleaved rename/insert in the redo stack). The order
// must be a permutation of the effect's current layer ids; an arity/membership mismatch is rejected BEFORE
// any mutation. The before memento is the prior layerOrder. Never coalesces.
export class ReorderLayersCommand implements Command {
  readonly kind = 'effect.layer.reorder';
  readonly label = 'Reorder Layers';
  private before: readonly EffectLayerId[] | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly order: readonly EffectLayerId[],
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const effect = ctx.effects.getEffect(this.effectId);
      if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
      const current = new Set<string>(effect.layerOrder);
      if (this.order.length !== current.size || !this.order.every((id) => current.has(id))) {
        throw new EffectEditError(
          'notFound',
          'reorder order must be a permutation of the effect layer ids',
        );
      }
      this.before = effect.layerOrder;
    }
    ctx.effects.setLayerOrder(this.effectId, this.order);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLayerOrder(this.effectId, this.before);
  }
}

export const reorderLayersSpec: EffectCommandSpec = {
  kind: 'effect.layer.reorder',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    if (!target || target.layerOrder.length < 2) return null;
    // Reverse the two layers for a real delta.
    return { command: new ReorderLayersCommand(target.id, [...target.layerOrder].reverse()) };
  },
  assertApplied: (before, after) => {
    const b = before.effects.find((effect) => effect.name === 'coinShower');
    const a = after.effects.find((effect) => effect.name === 'coinShower');
    if (!a || !b) throw new Error('effect.layer.reorder target effect missing');
    if (JSON.stringify(a.layerOrder) === JSON.stringify(b.layerOrder)) {
      throw new Error('effect.layer.reorder produced no order delta');
    }
  },
};
