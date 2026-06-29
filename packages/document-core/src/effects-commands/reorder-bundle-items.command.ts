import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleItemId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Reorder a bundle's items by passing an ordered BundleItemId[] (section 10 ReorderBundleItems; addresses
// by id, never by index). The order must be a permutation of the bundle's current item ids; an
// arity/membership mismatch is rejected BEFORE any mutation. The before memento is the prior itemOrder.
// Never coalesces.
export class ReorderBundleItemsCommand implements Command {
  readonly kind = 'bundle.item.reorder';
  readonly label = 'Reorder Bundle Items';
  private before: readonly BundleItemId[] | undefined;

  constructor(
    private readonly bundleName: string,
    private readonly order: readonly BundleItemId[],
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bundle = ctx.effects.getBundle(this.bundleName);
      if (!bundle)
        throw new EffectEditError('notFound', `bundle "${this.bundleName}" does not exist`);
      const current = new Set<string>(bundle.itemOrder);
      if (this.order.length !== current.size || !this.order.every((id) => current.has(id))) {
        throw new EffectEditError(
          'notFound',
          'reorder order must be a permutation of the bundle item ids',
        );
      }
      this.before = bundle.itemOrder;
    }
    ctx.effects.setBundleItemOrder(this.bundleName, this.order);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setBundleItemOrder(this.bundleName, this.before);
  }
}

export const reorderBundleItemsSpec: EffectCommandSpec = {
  kind: 'bundle.item.reorder',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const bundle = effects.getBundle('megaWin');
    if (!bundle || bundle.itemOrder.length < 2) return null;
    return { command: new ReorderBundleItemsCommand('megaWin', [...bundle.itemOrder].reverse()) };
  },
  assertApplied: (before, after) => {
    const b = before.bundles.find((bundle) => bundle.name === 'megaWin');
    const a = after.bundles.find((bundle) => bundle.name === 'megaWin');
    if (!a || !b) throw new Error('bundle.item.reorder target bundle missing');
    if (JSON.stringify(a.itemOrder) === JSON.stringify(b.itemOrder)) {
      throw new Error('bundle.item.reorder produced no order delta');
    }
  },
};
