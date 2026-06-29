import type { EscalationThresholds, WinSequenceConfig } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneWinSequenceConfig } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Set the win-tier escalation thresholds (command-history catalog SetEscalationThreshold,
// `slot.winseq.threshold`; WP-4.8). The do replaces winSequencer.thresholds with the new big/mega/epic
// table (totalWin/bet multiples); the undo restores the PREVIOUS thresholds (the before-memento, the whole
// prior config, deep-cloned). Each threshold must be a finite non-negative number (the format
// escalationThresholds bounds, re-asserted here so an invalid table is rejected BEFORE any mutation).
//
// COALESCES on the Window (the command-history `slot.winseq.threshold` row): two same-kind threshold edits
// inside the 250ms window collapse to ONE undo step keeping the ORIGINAL before and the latest thresholds
// (the table is a SINGLE target, mirroring SetIkMix). The thresholds are authoring DATA only; they never
// read a SpinResult (LAW 1) (the engine amount decides the tier at sequence time; the author sets only the
// cutoffs).
export class SetEscalationThresholdCommand implements Command {
  readonly kind = 'slot.winseq.threshold';
  readonly label = 'Set Escalation Thresholds';
  private before: WinSequenceConfig | undefined;
  private readonly thresholds: EscalationThresholds;

  constructor(thresholds: EscalationThresholds) {
    this.thresholds = { big: thresholds.big, mega: thresholds.mega, epic: thresholds.epic };
  }

  private assertValid(): void {
    for (const [tier, value] of [
      ['big', this.thresholds.big],
      ['mega', this.thresholds.mega],
      ['epic', this.thresholds.epic],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new SlotEditError(
          'emptyName',
          `escalation threshold ${tier} must be a finite non-negative number, received ${value}`,
        );
      }
    }
  }

  do(ctx: CommandContext): void {
    this.assertValid();
    const current = ctx.mutate.slotScene().winSequencer;
    if (this.before === undefined) {
      this.before = cloneWinSequenceConfig(current);
    }
    const next: WinSequenceConfig = {
      ...cloneWinSequenceConfig(current),
      thresholds: {
        big: this.thresholds.big,
        mega: this.thresholds.mega,
        epic: this.thresholds.epic,
      },
    };
    ctx.mutate.setSlotWinSequencer(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotWinSequencer(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetEscalationThresholdCommand) {
      const merged = new SetEscalationThresholdCommand(this.thresholds);
      merged.before = prev.before; // original before so one undo restores the pre-window thresholds
      return merged;
    }
    return null;
  }
}

export const setEscalationThresholdSpec: CommandSpec = {
  kind: 'slot.winseq.threshold',
  // The default thresholds are all zero, so setting a non-zero table is a clean delta on 'minimal'.
  representativeSeedId: 'minimal',
  fixture: () => ({
    command: new SetEscalationThresholdCommand({ big: 10, mega: 25, epic: 100 }),
  }),
  assertApplied: (before, after) => {
    const b = before.slotScene.winSequencer.thresholds;
    const a = after.slotScene.winSequencer.thresholds;
    if (a.big === b.big && a.mega === b.mega && a.epic === b.epic) {
      throw new Error('slot.winseq.threshold produced no thresholds delta');
    }
    if (a.big !== 10 || a.mega !== 25 || a.epic !== 100) {
      throw new Error('slot.winseq.threshold did not apply the new thresholds');
    }
  },
};
