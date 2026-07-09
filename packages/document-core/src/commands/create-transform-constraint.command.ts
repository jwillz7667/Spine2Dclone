import type { Command, CommandContext } from '../command/command';
import type { TransformConstraintEntity } from '../model/doc-state';
import type { BoneId, TransformConstraintId } from '../model/ids';
import { assertConstraintNameFree, assertValidTransformConstraint } from './constraint-support';
import type { CommandSpec } from './spec';

// The twelve mix/offset channels a transform constraint carries, supplied as one params object (the id,
// name, bones, and target are passed separately). The Stage F2 (ADR-0009 section 1.2) variant flags and
// optional order are NOT part of the authored params; the command injects their no-op defaults (an
// authoring surface for them is PP-D10), so every existing caller stays at the Phase-2 twelve channels.
export type TransformConstraintParams = Omit<
  TransformConstraintEntity,
  'id' | 'name' | 'bones' | 'target' | 'local' | 'relative' | 'order'
>;

// Create a transform constraint (command-history catalog CreateTransformConstraint, `transform.create`;
// WP-2.7). The bones and target are validated BEFORE any mutation (assertValidTransformConstraint: every
// constrained bone and the target exist, no cycle) and the name is checked unique across BOTH the IK and
// transform constraint arrays (assertConstraintNameFree), so an invalid constraint leaves no document
// change and no history entry. The new constraint appends to the end of the transform solve order (which
// runs after all IK). The undo memento is simply the id (removeTransformConstraint reverses the insert).
// NOT coalescing.
export class CreateTransformConstraintCommand implements Command {
  readonly kind = 'transform.create';
  readonly label = 'Create Transform Constraint';

  constructor(
    private readonly id: TransformConstraintId,
    private readonly name: string,
    private readonly bones: readonly BoneId[],
    private readonly target: BoneId,
    private readonly params: TransformConstraintParams,
  ) {}

  do(ctx: CommandContext): void {
    assertValidTransformConstraint(ctx.mutate, this.bones, this.target);
    assertConstraintNameFree(ctx.mutate, this.name);
    ctx.mutate.insertTransformConstraint(
      {
        id: this.id,
        name: this.name,
        bones: this.bones,
        target: this.target,
        ...this.params,
        // Stage F2 (ADR-0009 section 1.2) variant defaults: both false reproduce the ADR-0003 world,
        // absolute behavior. `order` stays absent (the ADR-0003 default IK-then-transform order).
        local: false,
        relative: false,
      },
      ctx.mutate.transformConstraints().length,
    );
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeTransformConstraint(this.id);
  }
}

export const createTransformConstraintSpec: CommandSpec = {
  kind: 'transform.create',
  // 'rig' has a root plus a child; follower/driver are not present there, but root and child are siblings-
  // free of each other (child is not an ancestor of root), so a constraint on [child] target root is a
  // valid transform constraint with no cycle.
  representativeSeedId: 'rig',
  fixture: (model, ids) => {
    const bones = model.bones();
    if (bones.length < 2) return null;
    if (model.transformConstraints().some((c) => c.name === 'tc_test')) return null;
    const constrained: readonly BoneId[] = [bones[1]!.id];
    const target = bones[0]!.id;
    return {
      command: new CreateTransformConstraintCommand(
        ids.mint('transformConstraint'),
        'tc_test',
        constrained,
        target,
        {
          mixRotate: 1,
          mixX: 0,
          mixY: 0,
          mixScaleX: 0,
          mixScaleY: 0,
          mixShearY: 0,
          offsetRotation: 0,
          offsetX: 0,
          offsetY: 0,
          offsetScaleX: 0,
          offsetScaleY: 0,
          offsetShearY: 0,
        },
      ),
    };
  },
  assertApplied: (before, after) => {
    if (after.transformConstraints.length !== before.transformConstraints.length + 1) {
      throw new Error('transform.create did not add exactly one transform constraint');
    }
  },
};
