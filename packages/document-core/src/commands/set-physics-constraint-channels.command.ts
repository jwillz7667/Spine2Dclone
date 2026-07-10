import type { PhysicsChannel } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, ConstraintError } from '../command/errors';
import type { PhysicsConstraintId } from '../model/ids';
import { assertValidPhysicsChannels } from './constraint-support';
import type { CommandSpec } from './spec';

// Replace a physics constraint's simulated channel set (command-history catalog SetPhysicsConstraintChannels,
// `physics.setChannels`; PP-D12). The new set is validated non-empty and duplicate-free BEFORE any mutation
// (ADR-0014's PHYSICS_CHANNELS_EMPTY / PHYSICS_CHANNEL_DUPLICATE at the command boundary), so an invalid set
// leaves no document change and no history entry. `channels` is replaced WHOLESALE (the setup pose of a
// channel is a structural property, not an interpolated one), so before is the prior array. NOT coalescing.
export class SetPhysicsConstraintChannelsCommand implements Command {
  readonly kind = 'physics.setChannels';
  readonly label = 'Set Physics Channels';
  private before: readonly PhysicsChannel[] | undefined;

  constructor(
    private readonly id: PhysicsConstraintId,
    private readonly channels: readonly PhysicsChannel[],
  ) {}

  do(ctx: CommandContext): void {
    const constraint = ctx.mutate.getPhysicsConstraint(this.id);
    if (!constraint) throw new ConstraintError('notFound', this.id);
    assertValidPhysicsChannels(this.channels);
    this.before = constraint.channels;
    ctx.mutate.patchPhysicsConstraint(this.id, { channels: this.channels });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPhysicsConstraint(this.id, { channels: this.before });
  }
}

export const setPhysicsConstraintChannelsSpec: CommandSpec = {
  kind: 'physics.setChannels',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const c = model.physicsConstraints()[0];
    if (!c) return null;
    // Toggle between a one-channel and a two-channel set so the edit is a real delta on any seed shape.
    const next: readonly PhysicsChannel[] = c.channels.includes('x')
      ? ['rotation']
      : ['rotation', 'x'];
    return { command: new SetPhysicsConstraintChannelsCommand(c.id, next) };
  },
  assertApplied: (before, after) => {
    const id = before.physicsConstraints[0]?.id;
    if (id === undefined) throw new Error('physics.setChannels fixture seed had no constraints');
    const b = before.physicsConstraints.find((c) => c.id === id);
    const a = after.physicsConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('physics.setChannels target missing from snapshot');
    if (a.channels.join(',') === b.channels.join(','))
      throw new Error('physics.setChannels produced no channel delta');
  },
};
