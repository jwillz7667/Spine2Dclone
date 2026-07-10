import type { PhysicsChannel } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import type { PhysicsConstraintEntity } from '../model/doc-state';
import type { BoneId, PhysicsConstraintId } from '../model/ids';
import { assertConstraintNameFree, assertValidPhysicsConstraint } from './constraint-support';
import type { CommandSpec } from './spec';

// The physics-constraint parameters a caller supplies (everything but identity, target bone, channels, and the
// optional solve order): the fixed simulation step, the model knobs, and the world-force inputs.
export interface PhysicsConstraintParams {
  readonly step: number;
  readonly inertia: number;
  readonly strength: number;
  readonly damping: number;
  readonly mass: number;
  readonly wind: number;
  readonly gravity: number;
  readonly mix: number;
}

// Create a physics constraint (command-history catalog CreatePhysicsConstraint, `physics.createConstraint`;
// PP-D12). The `bone` and channel set are validated BEFORE any mutation (assertValidPhysicsConstraint: the bone
// exists, the channels are non-empty and unique) and the name is checked unique across ALL FOUR constraint
// arrays (assertConstraintNameFree), so an invalid constraint leaves no document change and no history entry.
// The new constraint appends to the end of the physics solve order (after IK, transform, and path in the
// default order, ADR-0014 section 4). NOT coalescing.
export class CreatePhysicsConstraintCommand implements Command {
  readonly kind = 'physics.createConstraint';
  readonly label = 'Create Physics Constraint';

  constructor(
    private readonly id: PhysicsConstraintId,
    private readonly name: string,
    private readonly bone: BoneId,
    private readonly channels: readonly PhysicsChannel[],
    private readonly params: PhysicsConstraintParams,
  ) {}

  do(ctx: CommandContext): void {
    assertValidPhysicsConstraint(ctx.mutate, this.bone, this.channels);
    assertConstraintNameFree(ctx.mutate, this.name);
    const entity: PhysicsConstraintEntity = {
      id: this.id,
      name: this.name,
      bone: this.bone,
      channels: this.channels,
      step: this.params.step,
      inertia: this.params.inertia,
      strength: this.params.strength,
      damping: this.params.damping,
      mass: this.params.mass,
      wind: this.params.wind,
      gravity: this.params.gravity,
      mix: this.params.mix,
    };
    ctx.mutate.insertPhysicsConstraint(entity, ctx.mutate.physicsConstraints().length);
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removePhysicsConstraint(this.id);
  }
}

export const createPhysicsConstraintSpec: CommandSpec = {
  kind: 'physics.createConstraint',
  // 'physicsed' carries a bone ('tail') a new physics constraint can drive.
  representativeSeedId: 'physicsed',
  fixture: (model, ids) => {
    const bone = model.bones()[0];
    if (!bone) return null;
    if (model.physicsConstraints().some((c) => c.name === 'ph_new')) return null;
    return {
      command: new CreatePhysicsConstraintCommand(
        ids.mint('physicsConstraint'),
        'ph_new',
        bone.id,
        ['rotation'],
        {
          step: 1 / 60,
          inertia: 0.5,
          strength: 40,
          damping: 0.9,
          mass: 1,
          wind: 0,
          gravity: 0,
          mix: 1,
        },
      ),
    };
  },
  assertApplied: (before, after) => {
    if (after.physicsConstraints.length !== before.physicsConstraints.length + 1) {
      throw new Error('physics.createConstraint did not add exactly one physics constraint');
    }
  },
};
