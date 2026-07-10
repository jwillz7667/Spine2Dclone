import type { PhysicsSettings } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { CommandSpec } from './spec';

// Set or CLEAR the OPTIONAL skeleton physics settings block (command-history catalog SetPhysicsSettings,
// `physics.setSettings`; PP-D12): the global `gravity`/`wind` world defaults added to each constraint and the
// master `mix` multiplied into each constraint's mix (ADR-0014 section 5). The whole block is set at once (its
// three fields are total when the block exists); passing `null` CLEARS it, restoring the identity default (no
// global weather, unit master mix), which is byte-identical to a document that never defined the block. before
// captures the prior settings (a value or undefined) so undo is bit-exact. Coalesces a slider drag on the
// global gravity/wind/mix faders into one undo step; a merged command keeps prev's earlier before snapshot.
export class SetPhysicsSettingsCommand implements Command {
  readonly kind = 'physics.setSettings';
  readonly label = 'Set Physics Settings';
  private before: PhysicsSettings | undefined;
  private captured = false;

  // `settings` null CLEARS the block; otherwise it is the full { gravity, wind, mix } value.
  constructor(private readonly settings: PhysicsSettings | null) {}

  do(ctx: CommandContext): void {
    if (!this.captured) {
      this.before = ctx.mutate.physicsSettings();
      this.captured = true;
    }
    ctx.mutate.setPhysicsSettings(this.settings === null ? undefined : this.settings);
  }

  undo(ctx: CommandContext): void {
    if (!this.captured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPhysicsSettings(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetPhysicsSettingsCommand) {
      const merged = new SetPhysicsSettingsCommand(this.settings);
      merged.before = prev.before;
      merged.captured = prev.captured;
      return merged;
    }
    return null;
  }
}

export const setPhysicsSettingsSpec: CommandSpec = {
  kind: 'physics.setSettings',
  representativeSeedId: 'physicsed',
  fixture: (model) => {
    const current = model.physicsSettings();
    // Toggle the master mix so the edit is a real delta whether or not a block already exists.
    const base = current ?? { gravity: 0, wind: 0, mix: 1 };
    const next: PhysicsSettings = { ...base, mix: base.mix === 0.5 ? 0.25 : 0.5 };
    return { command: new SetPhysicsSettingsCommand(next) };
  },
  assertApplied: (before, after) => {
    if (JSON.stringify(after.physicsSettings) === JSON.stringify(before.physicsSettings)) {
      throw new Error('physics.setSettings produced no delta');
    }
  },
};
