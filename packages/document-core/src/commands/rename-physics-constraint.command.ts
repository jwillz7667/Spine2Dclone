import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PhysicsConstraintId } from '../model/ids';
import { assertConstraintNameFree } from './constraint-support';
import type { CommandSpec } from './spec';

// Rename a physics constraint (command-history catalog RenamePhysicsConstraint, `physics.renameConstraint`;
// PP-D12). The NEW name is checked unique across ALL FOUR constraint arrays (excluding this constraint's own
// current name) BEFORE any mutation, so a colliding rename leaves no document change and no history entry. A
// rename is a single-field change with ZERO cascade: the model addresses the constraint by PhysicsConstraintId,
// so its timeline tracks and solve order survive untouched. NOT coalescing.
export class RenamePhysicsConstraintCommand implements Command {
  readonly kind = 'physics.renameConstraint';
  readonly label = 'Rename Physics Constraint';
  private before: string | undefined;

  constructor(
    private readonly id: PhysicsConstraintId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getPhysicsConstraint(this.id);
    if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
    assertConstraintNameFree(ctx.mutate, this.name, constraint.name);
    this.before = constraint.name;
    ctx.mutate.patchPhysicsConstraint(this.id, { name: this.name });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPhysicsConstraint(this.id, { name: this.before });
  }
}

export const renamePhysicsConstraintSpec: CommandSpec = {
  kind: 'physics.renameConstraint',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const c = model.physicsConstraints()[0];
    if (!c) return null;
    const name = c.name === 'renamed' ? 'renamed2' : 'renamed';
    return { command: new RenamePhysicsConstraintCommand(c.id, name) };
  },
  assertApplied: (before, after) => {
    const id = before.physicsConstraints[0]?.id;
    if (id === undefined)
      throw new Error('physics.renameConstraint fixture seed had no constraints');
    const b = before.physicsConstraints.find((c) => c.id === id);
    const a = after.physicsConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('physics.renameConstraint target missing from snapshot');
    if (a.name === b.name) throw new Error('physics.renameConstraint produced no name delta');
  },
};
