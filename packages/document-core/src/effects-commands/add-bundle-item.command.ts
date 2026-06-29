import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleItemEntity } from '../effects-model/effects-state';
import type { BundleItemId, EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// The fields a new bundle item carries (the format BundleItem minus the id, with `effect` an EffectId).
export interface BundleItemInit {
  readonly effect: EffectId;
  readonly startOffset: number;
  readonly anchorRole: string;
  readonly seedSalt: number;
}

// Add an item to a bundle (section 10 AddBundleItem; the referenced effect must resolve). `effect` is stored
// as an EffectId (section 8.1.1), so a later RenameEffect never breaks the reference. The BundleItemId is
// minted once in the first `do` (redo reuses it); the item is appended at the end of itemOrder. Rejects an
// unknown EffectId BEFORE any mutation (bundleEffectMissing). Never coalesces.
export class AddBundleItemCommand implements Command {
  readonly kind = 'bundle.item.add';
  readonly label = 'Add Bundle Item';
  private id: BundleItemId | undefined;

  constructor(
    private readonly bundleName: string,
    private readonly init: BundleItemInit,
  ) {}

  do(ctx: CommandContext): void {
    const bundle = ctx.effects.getBundle(this.bundleName);
    if (!bundle)
      throw new EffectEditError('notFound', `bundle "${this.bundleName}" does not exist`);
    if (!ctx.effects.getEffect(this.init.effect)) {
      throw new EffectEditError('bundleEffectMissing', `effect ${this.init.effect} does not exist`);
    }
    if (this.id === undefined) this.id = ctx.ids.mint('bundleItem');
    const item: BundleItemEntity = {
      id: this.id,
      effect: this.init.effect,
      startOffset: this.init.startOffset,
      anchorRole: this.init.anchorRole,
      seedSalt: this.init.seedSalt,
    };
    ctx.effects.insertBundleItem(this.bundleName, item, bundle.itemOrder.length);
  }

  undo(ctx: CommandContext): void {
    if (this.id === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.removeBundleItem(this.bundleName, this.id);
  }
}

export const addBundleItemSpec: EffectCommandSpec = {
  kind: 'bundle.item.add',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const bundle = effects.getBundle('megaWin');
    const effect = effects.findEffectByName('coinShower');
    if (!bundle || !effect) return null;
    return {
      command: new AddBundleItemCommand('megaWin', {
        effect: effect.id,
        startOffset: 0.5,
        anchorRole: 'left',
        seedSalt: 9,
      }),
    };
  },
  assertApplied: (before, after) => {
    const b = before.bundles.find((bundle) => bundle.name === 'megaWin');
    const a = after.bundles.find((bundle) => bundle.name === 'megaWin');
    if (!a || !b) throw new Error('bundle.item.add target bundle missing');
    if (a.itemOrder.length !== b.itemOrder.length + 1) {
      throw new Error('bundle.item.add did not add exactly one item');
    }
  },
};
