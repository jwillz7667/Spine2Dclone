import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { BoneId, PhysicsConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// Retarget a physics constraint to a different bone (command-history catalog SetPhysicsConstraintTargetBone,
// `physics.setTargetBone`; PP-D12). The new bone is validated to exist BEFORE any mutation (a physics constraint
// binds to exactly ONE bone, both the driven bone and its own setpoint, so no cycle is possible), so an invalid
// retarget leaves no document change and no history entry. before is the prior BoneId. NOT coalescing.
export class SetPhysicsConstraintTargetBoneCommand implements Command {
  readonly kind = 'physics.setTargetBone';
  readonly label = 'Set Physics Target Bone';
  private before: BoneId | undefined;

  constructor(
    private readonly id: PhysicsConstraintId,
    private readonly bone: BoneId,
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getPhysicsConstraint(this.id);
    if (!constraint) throw new ConstraintError('notFound', this.id);
    if (ctx.mutate.getBone(this.bone) === undefined) {
      throw new ConstraintError('boneMissing', this.bone);
    }
    this.before = constraint.bone;
    ctx.mutate.patchPhysicsConstraint(this.id, { bone: this.bone });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPhysicsConstraint(this.id, { bone: this.before });
  }
}

export const setPhysicsConstraintTargetBoneSpec: CommandSpec = {
  kind: 'physics.setTargetBone',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const c = model.physicsConstraints()[0];
    if (!c) return null;
    // Pick any bone that differs from the current target, so the edit is a real delta.
    const other = model.bones().find((b) => b.id !== c.bone);
    if (!other) return null;
    return { command: new SetPhysicsConstraintTargetBoneCommand(c.id, other.id) };
  },
  assertApplied: (before, after) => {
    const id = before.physicsConstraints[0]?.id;
    if (id === undefined) throw new Error('physics.setTargetBone fixture seed had no constraints');
    const b = before.physicsConstraints.find((c) => c.id === id);
    const a = after.physicsConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('physics.setTargetBone target missing from snapshot');
    if (a.bone === b.bone) throw new Error('physics.setTargetBone produced no bone delta');
  },
};
