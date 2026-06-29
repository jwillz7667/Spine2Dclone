import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleItemEntity } from '../effects-model/effects-state';
import type { BundleItemId, EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// The bundle-item fields a SetBundleItem may change (each optional; an absent field is left unchanged).
// `effect` is an EffectId (section 8.1.1); a non-undefined effect must resolve in the library.
export interface BundleItemPatch {
  readonly effect?: EffectId;
  readonly startOffset?: number;
  readonly anchorRole?: string;
  readonly seedSalt?: number;
}

// Set a bundle item's fields (section 10 SetBundleItem, COALESCING: a startOffset slider drag is one undo
// step). Targets the item by BundleItemId; rejects an unknown EffectId BEFORE any mutation
// (bundleEffectMissing). The before memento is the whole prior item (so undo restores every field), and the
// model replaces the item wholesale. Coalesces on the SAME (bundle, item).
export class SetBundleItemCommand implements Command {
  readonly kind = 'bundle.item.set';
  readonly label = 'Set Bundle Item';
  private before: BundleItemEntity | undefined;

  constructor(
    private readonly bundleName: string,
    private readonly itemId: BundleItemId,
    private readonly patch: BundleItemPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.patch.effect !== undefined && !ctx.effects.getEffect(this.patch.effect)) {
      throw new EffectEditError(
        'bundleEffectMissing',
        `effect ${this.patch.effect} does not exist`,
      );
    }
    if (this.before === undefined) {
      const bundle = ctx.effects.getBundle(this.bundleName);
      if (!bundle)
        throw new EffectEditError('notFound', `bundle "${this.bundleName}" does not exist`);
      const item = bundle.items.get(this.itemId);
      if (!item) throw new EffectEditError('notFound', `bundle item ${this.itemId} does not exist`);
      this.before = item;
    }
    const updated: BundleItemEntity = {
      id: this.itemId,
      effect: this.patch.effect ?? this.before.effect,
      startOffset: this.patch.startOffset ?? this.before.startOffset,
      anchorRole: this.patch.anchorRole ?? this.before.anchorRole,
      seedSalt: this.patch.seedSalt ?? this.before.seedSalt,
    };
    ctx.effects.setBundleItem(this.bundleName, updated);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setBundleItem(this.bundleName, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetBundleItemCommand &&
      prev.bundleName === this.bundleName &&
      prev.itemId === this.itemId
    ) {
      const merged = new SetBundleItemCommand(this.bundleName, this.itemId, this.patch);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setBundleItemSpec: EffectCommandSpec = {
  kind: 'bundle.item.set',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const bundle = effects.getBundle('megaWin');
    const itemId = bundle?.itemOrder[0];
    if (!bundle || itemId === undefined) return null;
    const item = bundle.items.get(itemId);
    if (!item) return null;
    return {
      command: new SetBundleItemCommand('megaWin', itemId, { startOffset: item.startOffset + 0.5 }),
    };
  },
  assertApplied: (before, after) => {
    const offsetOf = (snap: typeof before): number | undefined => {
      const bundle = snap.bundles.find((b) => b.name === 'megaWin');
      const itemId = bundle?.itemOrder[0];
      return bundle?.items.find((item) => item.id === itemId)?.startOffset;
    };
    if (offsetOf(before) === offsetOf(after)) {
      throw new Error('bundle.item.set produced no field delta');
    }
  },
};
