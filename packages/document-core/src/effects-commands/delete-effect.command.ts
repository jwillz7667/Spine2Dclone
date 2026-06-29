import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleItemEntity, EffectEntity } from '../effects-model/effects-state';
import type { BundleItemId, EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// A removed bundle item captured for undo: its owning bundle name, the item, and its index in that bundle's
// itemOrder, so the cascade restores each item at its exact prior position.
interface RemovedItem {
  readonly bundleName: string;
  readonly item: BundleItemEntity;
  readonly index: number;
}

// Delete an effect by EffectId, cascading the removal of every bundle item that references it (section 10
// DeleteEffect: a composite, single-undo, because a dangling bundle item would fail export). The before
// memento captures the whole effect entity, its effectOrder index, and every removed bundle item with its
// position, so one undo restores the effect AND re-inserts the items at their exact prior indices. Never
// coalesces.
export class DeleteEffectCommand implements Command {
  readonly kind = 'effect.delete';
  readonly label = 'Delete Effect';
  private before: EffectEntity | undefined;
  private index = -1;
  private removedItems: RemovedItem[] = [];

  constructor(private readonly effectId: EffectId) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const effect = ctx.effects.getEffect(this.effectId);
      if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
      this.before = effect;
      this.index = ctx.effects.effects().findIndex((e) => e.id === this.effectId);
      // Capture (in stable order) every bundle item referencing this effect, with its position.
      const removed: RemovedItem[] = [];
      for (const bundle of ctx.effects.bundles()) {
        bundle.itemOrder.forEach((itemId: BundleItemId, position: number) => {
          const item = bundle.items.get(itemId);
          if (item && item.effect === this.effectId) {
            removed.push({ bundleName: bundle.name, item, index: position });
          }
        });
      }
      this.removedItems = removed;
    }
    // Remove the referencing bundle items first, then the effect.
    for (const removed of this.removedItems) {
      ctx.effects.removeBundleItem(removed.bundleName, removed.item.id);
    }
    ctx.effects.removeEffect(this.effectId);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.insertEffect(
      this.before,
      this.index < 0 ? ctx.effects.effects().length : this.index,
    );
    // Re-insert the cascaded items ascending by their captured index so each lands at its prior position.
    const ascending = [...this.removedItems].sort((a, b) => a.index - b.index);
    for (const removed of ascending) {
      ctx.effects.insertBundleItem(removed.bundleName, removed.item, removed.index);
    }
  }
}

export const deleteEffectSpec: EffectCommandSpec = {
  kind: 'effect.delete',
  representativeSeedId: 'library',
  // Delete the 'rayBurst' effect: the megaWin bundle references it, so the cascade removes that item too,
  // exercising the composite path and its undo restore.
  fixture: (effects) => {
    const target = effects.findEffectByName('rayBurst');
    if (!target) return null;
    return { command: new DeleteEffectCommand(target.id) };
  },
  assertApplied: (before, after) => {
    if (after.effects.length !== before.effects.length - 1) {
      throw new Error('effect.delete did not remove exactly one effect');
    }
    if (after.effects.some((effect) => effect.name === 'rayBurst')) {
      throw new Error('effect.delete left the target effect');
    }
    // The cascade must have dropped the megaWin item that referenced rayBurst.
    const beforeItems = before.bundles.reduce((sum, bundle) => sum + bundle.items.length, 0);
    const afterItems = after.bundles.reduce((sum, bundle) => sum + bundle.items.length, 0);
    if (afterItems >= beforeItems) {
      throw new Error('effect.delete did not cascade its bundle-item references');
    }
  },
};
