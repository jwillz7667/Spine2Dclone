import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PathConstraintId } from '../model/ids';
import { assertConstraintNameFree } from './constraint-support';
import type { CommandSpec } from './spec';

// Rename a path constraint (command-history catalog RenamePathConstraint, `path.renameConstraint`; PP-D7). The
// NEW name is checked unique across ALL FOUR constraint arrays (excluding this constraint's own current name)
// BEFORE any mutation, so a colliding rename leaves no document change and no history entry. A rename is a
// single-field change with ZERO cascade: the model addresses the constraint by PathConstraintId, so its
// timeline tracks and solve order survive untouched. NOT coalescing.
export class RenamePathConstraintCommand implements Command {
  readonly kind = 'path.renameConstraint';
  readonly label = 'Rename Path Constraint';
  private before: string | undefined;

  constructor(
    private readonly id: PathConstraintId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getPathConstraint(this.id);
    if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
    assertConstraintNameFree(ctx.mutate, this.name, constraint.name);
    this.before = constraint.name;
    ctx.mutate.patchPathConstraint(this.id, { name: this.name });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPathConstraint(this.id, { name: this.before });
  }
}

export const renamePathConstraintSpec: CommandSpec = {
  kind: 'path.renameConstraint',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const c = model.pathConstraints()[0];
    if (!c) return null;
    const name = c.name === 'renamed' ? 'renamed2' : 'renamed';
    return { command: new RenamePathConstraintCommand(c.id, name) };
  },
  assertApplied: (before, after) => {
    const id = before.pathConstraints[0]?.id;
    if (id === undefined) throw new Error('path.renameConstraint fixture seed had no constraints');
    const b = before.pathConstraints.find((c) => c.id === id);
    const a = after.pathConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('path.renameConstraint target missing from snapshot');
    if (a.name === b.name) throw new Error('path.renameConstraint produced no name delta');
  },
};
