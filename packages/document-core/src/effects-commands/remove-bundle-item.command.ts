import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleItemEntity } from '../effects-model/effects-state';
import type { BundleItemId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Remove a bundle item by BundleItemId (section 10 RemoveBundleItem). The before memento captures the whole
// item and its index in itemOrder, so one undo restores it at its prior position. Never coalesces.
export class RemoveBundleItemCommand implements Command {
  readonly kind = 'bundle.item.remove';
  readonly label = 'Remove Bundle Item';
  private before: BundleItemEntity | undefined;
  private index = -1;

  constructor(
    private readonly bundleName: string,
    private readonly itemId: BundleItemId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bundle = ctx.effects.getBundle(this.bundleName);
      if (!bundle)
        throw new EffectEditError('notFound', `bundle "${this.bundleName}" does not exist`);
      const item = bundle.items.get(this.itemId);
      if (!item) throw new EffectEditError('notFound', `bundle item ${this.itemId} does not exist`);
      this.before = item;
      this.index = bundle.itemOrder.indexOf(this.itemId);
    }
    ctx.effects.removeBundleItem(this.bundleName, this.itemId);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    const bundle = ctx.effects.getBundle(this.bundleName);
    const fallback = bundle ? bundle.itemOrder.length : 0;
    ctx.effects.insertBundleItem(
      this.bundleName,
      this.before,
      this.index < 0 ? fallback : this.index,
    );
  }
}

export const removeBundleItemSpec: EffectCommandSpec = {
  kind: 'bundle.item.remove',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const bundle = effects.getBundle('megaWin');
    const itemId = bundle?.itemOrder[0];
    if (!bundle || itemId === undefined) return null;
    return { command: new RemoveBundleItemCommand('megaWin', itemId) };
  },
  assertApplied: (before, after) => {
    const b = before.bundles.find((bundle) => bundle.name === 'megaWin');
    const a = after.bundles.find((bundle) => bundle.name === 'megaWin');
    if (!a || !b) throw new Error('bundle.item.remove target bundle missing');
    if (a.itemOrder.length !== b.itemOrder.length - 1) {
      throw new Error('bundle.item.remove did not remove exactly one item');
    }
  },
};
