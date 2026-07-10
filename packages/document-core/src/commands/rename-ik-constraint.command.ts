import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { IkConstraintId } from '../model/ids';
import { assertConstraintNameFree } from './constraint-support';
import type { CommandSpec } from './spec';

// Rename an IK constraint (command-history catalog RenameIkConstraint, `ik.renameConstraint`; PP-D7 gives the
// hierarchy tree a rename affordance for constraints). The NEW name is checked unique across ALL FOUR
// constraint arrays (excluding this constraint's own current name) BEFORE any mutation, so a colliding rename
// leaves no document change and no history entry. A rename is a single-field change with ZERO cascade: the
// model addresses the constraint by IkConstraintId, so its timeline tracks and solve order survive untouched.
// NOT coalescing.
export class RenameIkConstraintCommand implements Command {
  readonly kind = 'ik.renameConstraint';
  readonly label = 'Rename IK Constraint';
  private before: string | undefined;

  constructor(
    private readonly id: IkConstraintId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getIkConstraint(this.id);
    if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
    assertConstraintNameFree(ctx.mutate, this.name, constraint.name);
    this.before = constraint.name;
    ctx.mutate.patchIkConstraint(this.id, { name: this.name });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchIkConstraint(this.id, { name: this.before });
  }
}

export const renameIkConstraintSpec: CommandSpec = {
  kind: 'ik.renameConstraint',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.ikConstraints()[0];
    if (!c) return null;
    const name = c.name === 'renamed' ? 'renamed2' : 'renamed';
    return { command: new RenameIkConstraintCommand(c.id, name) };
  },
  assertApplied: (before, after) => {
    const id = before.ikConstraints[0]?.id;
    if (id === undefined) throw new Error('ik.renameConstraint fixture seed had no constraints');
    const b = before.ikConstraints.find((c) => c.id === id);
    const a = after.ikConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('ik.renameConstraint target missing from snapshot');
    if (a.name === b.name) throw new Error('ik.renameConstraint produced no name delta');
  },
};
