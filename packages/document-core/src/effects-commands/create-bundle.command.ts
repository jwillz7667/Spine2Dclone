import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { BundleEntity } from '../effects-model/effects-state';
import type { EffectCommandSpec } from './effects-spec';

// Create a new, item-less bundle (section 10 CreateBundle). Bundles are addressed by name (the mutable
// on-disk key, like the skeletal animations record); the bundle is appended at the end of bundleOrder. Name
// uniqueness is an EXPORT-only contract, so a duplicate is NOT rejected here. Never coalesces; the undo
// removes the bundle by name.
export class CreateBundleCommand implements Command {
  readonly kind = 'bundle.create';
  readonly label = 'Create Bundle';
  private applied = false;

  constructor(private readonly name: string) {}

  do(ctx: CommandContext): void {
    const entity: BundleEntity = { name: this.name, itemOrder: [], items: new Map() };
    ctx.effects.insertBundle(entity, ctx.effects.bundles().length);
    this.applied = true;
  }

  undo(ctx: CommandContext): void {
    if (!this.applied) throw new CommandNotAppliedError(this.kind);
    ctx.effects.removeBundle(this.name);
  }
}

export const createBundleSpec: EffectCommandSpec = {
  kind: 'bundle.create',
  representativeSeedId: 'library',
  fixture: () => ({ command: new CreateBundleCommand('bigWin') }),
  assertApplied: (before, after) => {
    if (after.bundles.length !== before.bundles.length + 1) {
      throw new Error('bundle.create did not add exactly one bundle');
    }
    if (!after.bundles.some((bundle) => bundle.name === 'bigWin')) {
      throw new Error('bundle.create did not create the named bundle');
    }
  },
};
