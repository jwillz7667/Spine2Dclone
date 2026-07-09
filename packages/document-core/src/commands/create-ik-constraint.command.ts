import type { Command, CommandContext } from '../command/command';
import type { BoneId, IkConstraintId } from '../model/ids';
import { assertConstraintNameFree, assertValidIkChain } from './constraint-support';
import type { CommandSpec } from './spec';

// Create an IK constraint (command-history catalog CreateIkConstraint, `ik.create`; WP-2.6). The chain
// and target are validated BEFORE any mutation (assertValidIkChain: arity 1 or 2, bones and target exist,
// a two-bone chain is parent-then-direct-child, no cycle) and the name is checked unique across BOTH the
// IK and transform constraint arrays (assertConstraintNameFree), so an invalid constraint leaves no
// document change and no history entry. The new constraint appends to the end of the IK solve order. The
// undo memento is simply the id (removeIkConstraint reverses the insert). NOT coalescing.
export class CreateIkConstraintCommand implements Command {
  readonly kind = 'ik.create';
  readonly label = 'Create IK Constraint';

  constructor(
    private readonly id: IkConstraintId,
    private readonly name: string,
    private readonly bones: readonly BoneId[],
    private readonly target: BoneId,
    private readonly mix: number,
    private readonly bendPositive: boolean,
  ) {}

  do(ctx: CommandContext): void {
    assertValidIkChain(ctx.mutate, this.bones, this.target);
    assertConstraintNameFree(ctx.mutate, this.name);
    ctx.mutate.insertIkConstraint(
      {
        id: this.id,
        name: this.name,
        bones: this.bones,
        target: this.target,
        mix: this.mix,
        bendPositive: this.bendPositive,
        // Stage F2 (ADR-0009 section 1.1) IK depth defaults: softness 0 and the three booleans false
        // reproduce the pre-0.4.0 hard, fixed-length solve. An authoring surface for them is PP-D10.
        softness: 0,
        stretch: false,
        compress: false,
        uniform: false,
      },
      ctx.mutate.ikConstraints().length,
    );
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeIkConstraint(this.id);
  }
}

export const createIkConstraintSpec: CommandSpec = {
  kind: 'ik.create',
  // 'rig' has a root plus a child, so a one-bone chain (the child) reaching its parent (the root) is a
  // valid IK constraint with no cycle (the child is not an ancestor of the root).
  representativeSeedId: 'rig',
  fixture: (model, ids) => {
    const bones = model.bones();
    if (bones.length < 2) return null;
    if (model.ikConstraints().some((c) => c.name === 'ik_test')) return null;
    const chain: readonly BoneId[] = [bones[1]!.id];
    const target = bones[0]!.id;
    return {
      command: new CreateIkConstraintCommand(
        ids.mint('ikConstraint'),
        'ik_test',
        chain,
        target,
        1,
        true,
      ),
    };
  },
  assertApplied: (before, after) => {
    if (after.ikConstraints.length !== before.ikConstraints.length + 1) {
      throw new Error('ik.create did not add exactly one IK constraint');
    }
  },
};
