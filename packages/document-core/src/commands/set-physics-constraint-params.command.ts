import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PhysicsConstraintEntity } from '../model/doc-state';
import type { PhysicsConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The physics-constraint parameters a SetPhysicsConstraintParams edit may touch: the fixed simulation step, the
// model knobs (inertia/strength/damping/mass), and the world-force inputs (wind/gravity/mix). Identity, target
// bone, channels, and the optional solve order are edited by their own dedicated commands. A patch is a Partial.
export type PhysicsConstraintParamPatch = Partial<
  Omit<PhysicsConstraintEntity, 'id' | 'name' | 'bone' | 'channels' | 'order'>
>;

// The full set of patchable numeric fields captured as the before memento, so undo restores every field to its
// pre-edit value and a coalesced slider drag stays bit-exact with no per-key gymnastics.
type PhysicsConstraintParamSnapshot = Required<PhysicsConstraintParamPatch>;

function snapshotParams(c: PhysicsConstraintEntity): PhysicsConstraintParamSnapshot {
  return {
    step: c.step,
    inertia: c.inertia,
    strength: c.strength,
    damping: c.damping,
    mass: c.mass,
    wind: c.wind,
    gravity: c.gravity,
    mix: c.mix,
  };
}

// Edit a physics constraint's scalar parameters (command-history catalog SetPhysicsConstraintParams,
// `physics.setParams`; PP-D12). Coalesces a slider drag: `before` captures the FULL parameter snapshot at
// gesture start and `patch` holds the absolute target, so undo is bit-exact and a coalesced drag never
// accumulates drift. A merged command keeps prev's earlier snapshot and this.patch as the latest target. The
// value ranges (step > 0, mass > 0, inertia/damping/mix in [0, 1], strength >= 0) are the format's; this
// command carries whatever the caller supplies and the exporter's validateDocument is the fail-loud backstop.
export class SetPhysicsConstraintParamsCommand implements Command {
  readonly kind = 'physics.setParams';
  readonly label = 'Set Physics Constraint';
  private before: PhysicsConstraintParamSnapshot | undefined;

  constructor(
    private readonly id: PhysicsConstraintId,
    private readonly patch: PhysicsConstraintParamPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getPhysicsConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = snapshotParams(constraint);
    }
    ctx.mutate.patchPhysicsConstraint(this.id, this.patch);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPhysicsConstraint(this.id, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetPhysicsConstraintParamsCommand && prev.id === this.id) {
      const merged = new SetPhysicsConstraintParamsCommand(this.id, this.patch);
      // Keep prev's earlier full snapshot so one undo of the coalesced drag returns to the gesture start.
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setPhysicsConstraintParamsSpec: CommandSpec = {
  kind: 'physics.setParams',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const c = model.physicsConstraints()[0];
    if (!c) return null;
    const patch: PhysicsConstraintParamPatch = { strength: c.strength === 20 ? 30 : 20 };
    return { command: new SetPhysicsConstraintParamsCommand(c.id, patch) };
  },
  assertApplied: (before, after) => {
    const id = before.physicsConstraints[0]?.id;
    if (id === undefined) throw new Error('physics.setParams fixture seed had no constraints');
    const b = before.physicsConstraints.find((c) => c.id === id);
    const a = after.physicsConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('physics.setParams target missing from snapshot');
    if (a.strength === b.strength) throw new Error('physics.setParams produced no delta');
  },
};
