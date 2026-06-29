import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { IkConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// Set an IK constraint's `mix` blend (command-history catalog SetIkMix, `ik.setMix`; WP-2.6). Coalesces
// same-target mix edits within one slider session, mirroring SetSlotColor: `before` is captured on first
// do and the target value is absolute, so undo is bit-exact and a coalesced drag never accumulates drift.
// A merged command keeps the ORIGINAL before and the latest mix.
export class SetIkMixCommand implements Command {
  readonly kind = 'ik.setMix';
  readonly label = 'Set IK Mix';
  private before: number | undefined;

  constructor(
    private readonly id: IkConstraintId,
    private readonly mix: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getIkConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = constraint.mix;
    }
    ctx.mutate.patchIkConstraint(this.id, { mix: this.mix });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchIkConstraint(this.id, { mix: this.before });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetIkMixCommand && prev.id === this.id) {
      const merged = new SetIkMixCommand(this.id, this.mix);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setIkMixSpec: CommandSpec = {
  kind: 'ik.setMix',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const constraint = model.ikConstraints()[0];
    if (!constraint) return null;
    const mix = constraint.mix === 1 ? 0.5 : 1;
    return { command: new SetIkMixCommand(constraint.id, mix) };
  },
  assertApplied: (before, after) => {
    const b = before.ikConstraints[0];
    if (b === undefined) throw new Error('ik.setMix fixture seed had no IK constraints');
    const a = after.ikConstraints.find((c) => c.id === b.id);
    if (!a) throw new Error('ik.setMix target missing from snapshot');
    if (a.mix === b.mix) throw new Error('ik.setMix produced no mix delta');
  },
};
