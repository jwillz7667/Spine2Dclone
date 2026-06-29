import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { IkConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// Set an IK constraint's `bendPositive` flag (command-history catalog SetIkBendPositive,
// `ik.setBendPositive`; WP-2.6). A discrete toggle, so it does NOT coalesce. `before` is captured on first
// do so redo replays identically and undo restores the prior direction exactly.
export class SetIkBendPositiveCommand implements Command {
  readonly kind = 'ik.setBendPositive';
  readonly label = 'Set IK Bend Direction';
  private before: boolean | undefined;

  constructor(
    private readonly id: IkConstraintId,
    private readonly bendPositive: boolean,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getIkConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = constraint.bendPositive;
    }
    ctx.mutate.patchIkConstraint(this.id, { bendPositive: this.bendPositive });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchIkConstraint(this.id, { bendPositive: this.before });
  }
}

export const setIkBendPositiveSpec: CommandSpec = {
  kind: 'ik.setBendPositive',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const constraint = model.ikConstraints()[0];
    if (!constraint) return null;
    return { command: new SetIkBendPositiveCommand(constraint.id, !constraint.bendPositive) };
  },
  assertApplied: (before, after) => {
    const b = before.ikConstraints[0];
    if (b === undefined) throw new Error('ik.setBendPositive fixture seed had no IK constraints');
    const a = after.ikConstraints.find((c) => c.id === b.id);
    if (!a) throw new Error('ik.setBendPositive target missing from snapshot');
    if (a.bendPositive === b.bendPositive) {
      throw new Error('ik.setBendPositive produced no bend-direction delta');
    }
  },
};
