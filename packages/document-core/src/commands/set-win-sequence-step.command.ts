import type { WinSequenceConfig, WinSequenceStep } from '@marionette/format/slot-types';
import { winSequenceStepSchema } from '@marionette/format/slot';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneWinSequenceConfig } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Set (replace) or APPEND a step at an index in a named win sequence (command-history catalog
// SetWinSequenceStep, `slot.winseq.step`; WP-4.8). The candidate step is shape-validated against the format
// schema BEFORE any mutation (so a malformed action/target leaves no document change and no history entry).
// An UNKNOWN sequence name and an OUT-OF-RANGE index are rejected with a typed SlotEditError. A valid index
// is [0, steps.length]: an index equal to the length APPENDS; an index inside the range REPLACES.
//
// The before-memento is the WHOLE prior WinSequenceConfig (deep-cloned), the smallest correct reverse for a
// single-undo step. COALESCES on the Session window (the command-history `slot.winseq.step` row): a
// drag-style edit of ONE step (e.g. scrubbing its atMs on the timeline) collapses to ONE undo step keeping
// the ORIGINAL before and the latest step. The merge target is (sequenceName, index): only a same-name,
// same-index predecessor merges, so editing a DIFFERENT step or a different sequence never coalesces (the
// command-history same-target rule). The step is authoring DATA only (atMs/target/action); it reads
// SpinResult FIELD NAMES (lineIndex, symbol) via the target rule, never an outcome value (LAW 1).
export class SetWinSequenceStepCommand implements Command {
  readonly kind = 'slot.winseq.step';
  readonly label = 'Set Win Sequence Step';
  private before: WinSequenceConfig | undefined;
  private readonly step: WinSequenceStep;

  constructor(
    private readonly sequenceName: string,
    private readonly index: number,
    step: WinSequenceStep,
  ) {
    this.step = structuredClone(step);
  }

  private assertValidStep(): void {
    const parsed = winSequenceStepSchema.safeParse(this.step);
    if (!parsed.success) {
      throw new SlotEditError(
        'emptyName',
        parsed.error.issues[0]?.message ?? 'invalid win sequence step shape',
      );
    }
  }

  do(ctx: CommandContext): void {
    this.assertValidStep();
    const current = ctx.mutate.slotScene().winSequencer;
    const seq = current.sequences[this.sequenceName];
    if (seq === undefined) {
      throw new SlotEditError(
        'sequenceMissing',
        `win sequence "${this.sequenceName}" does not exist`,
      );
    }
    if (!Number.isInteger(this.index) || this.index < 0 || this.index > seq.steps.length) {
      throw new SlotEditError(
        'stepIndexOutOfRange',
        `step index ${this.index} is outside [0, ${seq.steps.length}] of sequence "${this.sequenceName}"`,
      );
    }
    if (this.before === undefined) {
      this.before = cloneWinSequenceConfig(current);
    }
    const copy = cloneWinSequenceConfig(current);
    const steps = copy.sequences[this.sequenceName]!.steps.slice();
    steps[this.index] = structuredClone(this.step);
    const next: WinSequenceConfig = {
      ...copy,
      sequences: { ...copy.sequences, [this.sequenceName]: { steps } },
    };
    ctx.mutate.setSlotWinSequencer(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotWinSequencer(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    // Same target only: same sequence name AND same step index (the command-history same-target rule).
    if (
      prev instanceof SetWinSequenceStepCommand &&
      prev.sequenceName === this.sequenceName &&
      prev.index === this.index
    ) {
      const merged = new SetWinSequenceStepCommand(this.sequenceName, this.index, this.step);
      merged.before = prev.before; // keep the ORIGINAL before so one undo restores the pre-session state
      return merged;
    }
    return null;
  }
}

export const setWinSequenceStepSpec: CommandSpec = {
  kind: 'slot.winseq.step',
  // The default win sequencer carries an empty 'base' sequence, so APPENDING a step at index 0 is a clean
  // delta against the default.
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const seq = model.slotScene().winSequencer.sequences['base'];
    if (seq === undefined) return null;
    return {
      command: new SetWinSequenceStepCommand('base', seq.steps.length, {
        atMs: 0,
        target: { kind: 'allWinningCells' },
        action: { kind: 'animateWin' },
      }),
    };
  },
  assertApplied: (before, after) => {
    const beforeSteps = before.slotScene.winSequencer.sequences['base']?.steps.length ?? -1;
    const afterSteps = after.slotScene.winSequencer.sequences['base']?.steps.length ?? -1;
    if (afterSteps !== beforeSteps + 1) {
      throw new Error('slot.winseq.step did not append exactly one step to the base sequence');
    }
  },
};
