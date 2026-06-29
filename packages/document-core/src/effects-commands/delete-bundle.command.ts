import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { BundleEntity } from '../effects-model/effects-state';
import type { EffectCommandSpec } from './effects-spec';

// Delete a bundle by name (section 10 DeleteBundle). The before memento captures the whole bundle entity
// (its items and their order) and its index in bundleOrder, so one undo restores it at its prior position
// with every item intact. Never coalesces.
export class DeleteBundleCommand implements Command {
  readonly kind = 'bundle.delete';
  readonly label = 'Delete Bundle';
  private before: BundleEntity | undefined;
  private index = -1;

  constructor(private readonly name: string) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bundle = ctx.effects.getBundle(this.name);
      if (!bundle) throw new EffectEditError('notFound', `bundle "${this.name}" does not exist`);
      this.before = bundle;
      this.index = ctx.effects.bundles().findIndex((b) => b.name === this.name);
    }
    ctx.effects.removeBundle(this.name);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.insertBundle(
      this.before,
      this.index < 0 ? ctx.effects.bundles().length : this.index,
    );
  }
}

export const deleteBundleSpec: EffectCommandSpec = {
  kind: 'bundle.delete',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.getBundle('megaWin');
    if (!target) return null;
    return { command: new DeleteBundleCommand('megaWin') };
  },
  assertApplied: (before, after) => {
    if (after.bundles.length !== before.bundles.length - 1) {
      throw new Error('bundle.delete did not remove exactly one bundle');
    }
    if (after.bundles.some((bundle) => bundle.name === 'megaWin')) {
      throw new Error('bundle.delete left the target bundle');
    }
  },
};
