import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// The effect meta a SetEffectMeta may change: duration / deterministic / simulationDt (each optional; an
// absent field is left unchanged). `simulationDt > 0` is a typed guard (EFFECT_SIMULATION_DT at the command
// boundary).
export interface EffectMetaPatch {
  readonly duration?: number | null;
  readonly deterministic?: boolean;
  readonly simulationDt?: number;
}

// Set an effect's meta fields (section 10 SetEffectMeta). Rejects a non-positive simulationDt BEFORE any
// mutation (the author-time form of the validator's EFFECT_SIMULATION_DT). The before memento captures the
// prior values of exactly the patched fields, so the do/undo round-trip is bit-exact. Never coalesces.
export class SetEffectMetaCommand implements Command {
  readonly kind = 'effect.meta';
  readonly label = 'Set Effect Meta';
  private before: EffectMetaPatch | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly patch: EffectMetaPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.patch.simulationDt !== undefined && !(this.patch.simulationDt > 0)) {
      throw new EffectEditError(
        'simulationDt',
        `simulationDt must be > 0, got ${this.patch.simulationDt}`,
      );
    }
    if (this.before === undefined) {
      const effect = ctx.effects.getEffect(this.effectId);
      if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
      this.before = {
        ...(this.patch.duration !== undefined ? { duration: effect.duration } : {}),
        ...(this.patch.deterministic !== undefined ? { deterministic: effect.deterministic } : {}),
        ...(this.patch.simulationDt !== undefined ? { simulationDt: effect.simulationDt } : {}),
      };
    }
    ctx.effects.patchEffect(this.effectId, this.patch);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.patchEffect(this.effectId, this.before);
  }
}

export const setEffectMetaSpec: EffectCommandSpec = {
  kind: 'effect.meta',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    if (!target) return null;
    return { command: new SetEffectMetaCommand(target.id, { duration: 3, deterministic: false }) };
  },
  assertApplied: (before, after) => {
    const b = before.effects.find((effect) => effect.name === 'coinShower');
    const a = after.effects.find((effect) => effect.name === 'coinShower');
    if (!a || !b) throw new Error('effect.meta target effect missing');
    if (a.duration === b.duration && a.deterministic === b.deterministic) {
      throw new Error('effect.meta produced no meta delta');
    }
  },
};
