import type { GridConfig } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { cloneGridConfig } from '../model/slot-scene';
import {
  assertValidGridConfig,
  preset5x3ReelStrip,
  preset6x5ScatterPay,
  preset7x7Cluster,
} from './slot-scene-support';
import type { CommandSpec } from './spec';

// Set the slot grid config (command-history catalog SetGridConfig, `slot.grid.set`; WP-4.5). The candidate
// grid is validated BEFORE any mutation (assertValidGridConfig: the format scalar bounds + the cross-field
// topology/dims/gravity/anticipation invariants), so an inconsistent grid leaves no document change and no
// history entry. The do replaces slotScene.grid with the new value; the undo restores the PREVIOUS grid.
//
// COALESCES on the Session window (the command-history `slot.grid.set` row): a sequence of grid-metric edits
// (a slider/spinner drag of cols/rows/cellGap/...) collapses to ONE undo step with ONE memento. The grid is
// a SINGLE target, so coalesceWith merges any same-kind predecessor (there is only one grid). `before` is
// captured on first do and the new grid is ABSOLUTE, so undo is bit-exact and a coalesced drag never
// accumulates drift; a merged command keeps the ORIGINAL before and the latest grid (mirrors SetIkMix).
export class SetGridConfigCommand implements Command {
  readonly kind = 'slot.grid.set';
  readonly label = 'Set Grid Config';
  private before: GridConfig | undefined;

  constructor(private readonly grid: GridConfig) {}

  // Preset constructors (command-history WP-4.5): a ready-to-apply SetGridConfig for the three canonical
  // layouts. They are thin wrappers so a tool / MCP client gets a one-call "make this a 5x3 reelStrip".
  static reelStrip5x3(): SetGridConfigCommand {
    return new SetGridConfigCommand(preset5x3ReelStrip());
  }
  static scatterPay6x5(): SetGridConfigCommand {
    return new SetGridConfigCommand(preset6x5ScatterPay());
  }
  static cluster7x7(): SetGridConfigCommand {
    return new SetGridConfigCommand(preset7x7Cluster());
  }

  do(ctx: CommandContext): void {
    assertValidGridConfig(this.grid);
    if (this.before === undefined) {
      this.before = cloneGridConfig(ctx.mutate.slotGrid());
    }
    ctx.mutate.setSlotGrid(this.grid);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotGrid(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetGridConfigCommand) {
      const merged = new SetGridConfigCommand(this.grid);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setGridConfigSpec: CommandSpec = {
  kind: 'slot.grid.set',
  // Every seed loads the always-present DEFAULT 5x3 reelStrip grid, so 'minimal' is a clean target: setting
  // a 6x5 scatterPay is a real delta (topology + dims change) against the default.
  representativeSeedId: 'minimal',
  fixture: () => ({ command: SetGridConfigCommand.scatterPay6x5() }),
  assertApplied: (before, after) => {
    if (before.slotScene.grid.topology === after.slotScene.grid.topology) {
      throw new Error('slot.grid.set produced no grid topology delta');
    }
    if (after.slotScene.grid.topology !== 'scatterPay') {
      throw new Error('slot.grid.set did not apply the scatterPay preset');
    }
  },
};
