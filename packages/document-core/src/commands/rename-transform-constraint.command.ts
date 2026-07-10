import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { TransformConstraintId } from '../model/ids';
import { assertConstraintNameFree } from './constraint-support';
import type { CommandSpec } from './spec';

// Rename a transform constraint (command-history catalog RenameTransformConstraint,
// `transform.renameConstraint`; PP-D7). The NEW name is checked unique across ALL FOUR constraint arrays
// (excluding this constraint's own current name) BEFORE any mutation, so a colliding rename leaves no document
// change and no history entry. A rename is a single-field change with ZERO cascade: the model addresses the
// constraint by TransformConstraintId, so its timeline tracks and solve order survive untouched. NOT coalescing.
export class RenameTransformConstraintCommand implements Command {
  readonly kind = 'transform.renameConstraint';
  readonly label = 'Rename Transform Constraint';
  private before: string | undefined;

  constructor(
    private readonly id: TransformConstraintId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getTransformConstraint(this.id);
    if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
    assertConstraintNameFree(ctx.mutate, this.name, constraint.name);
    this.before = constraint.name;
    ctx.mutate.patchTransformConstraint(this.id, { name: this.name });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchTransformConstraint(this.id, { name: this.before });
  }
}

export const renameTransformConstraintSpec: CommandSpec = {
  kind: 'transform.renameConstraint',
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.transformConstraints()[0];
    if (!c) return null;
    const name = c.name === 'renamed' ? 'renamed2' : 'renamed';
    return { command: new RenameTransformConstraintCommand(c.id, name) };
  },
  assertApplied: (before, after) => {
    const id = before.transformConstraints[0]?.id;
    if (id === undefined)
      throw new Error('transform.renameConstraint fixture seed had no constraints');
    const b = before.transformConstraints.find((c) => c.id === id);
    const a = after.transformConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('transform.renameConstraint target missing from snapshot');
    if (a.name === b.name) throw new Error('transform.renameConstraint produced no name delta');
  },
};
