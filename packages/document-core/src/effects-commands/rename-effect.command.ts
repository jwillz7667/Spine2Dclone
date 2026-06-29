import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Rename an effect by EffectId (section 10 RenameEffect). A single-field change with ZERO cascade: bundle
// items reference the EffectId, not the name, so a rename never breaks a reference (section 8.1.1). Name
// uniqueness is an EXPORT-only contract, so a duplicate name is NOT rejected here. Never coalesces;
// memento-based (the prior name).
export class RenameEffectCommand implements Command {
  readonly kind = 'effect.rename';
  readonly label = 'Rename Effect';
  private before: string | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const effect = ctx.effects.getEffect(this.effectId);
      if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
      this.before = effect.name;
    }
    ctx.effects.patchEffect(this.effectId, { name: this.name });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.patchEffect(this.effectId, { name: this.before });
  }
}

export const renameEffectSpec: EffectCommandSpec = {
  kind: 'effect.rename',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    if (!target) return null;
    return { command: new RenameEffectCommand(target.id, 'coinShowerLarge') };
  },
  assertApplied: (before, after) => {
    if (after.effects.some((effect) => effect.name === 'coinShower')) {
      throw new Error('effect.rename left the old name');
    }
    if (!after.effects.some((effect) => effect.name === 'coinShowerLarge')) {
      throw new Error('effect.rename did not apply the new name');
    }
    // Zero cascade: the bundle items (which hold EffectIds) are byte-identical before and after.
    if (JSON.stringify(after.bundles) !== JSON.stringify(before.bundles)) {
      throw new Error('effect.rename must not touch bundle-item references');
    }
  },
};
