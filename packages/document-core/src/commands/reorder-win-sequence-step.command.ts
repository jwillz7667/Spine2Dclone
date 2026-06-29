import type { WinSequenceConfig, WinSequenceStep } from '@marionette/format/slot-types';
import { CompositeCommand } from '../command/composite';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneWinSequenceConfig } from '../model/slot-scene';
import { SetWinSequenceStepCommand } from './set-win-sequence-step.command';
import type { CommandSpec } from './spec';

// Reorder the steps of a named win sequence by an EXPLICIT new-order array (command-history catalog
// ReorderWinSequenceStep, `slot.winseq.reorder`; WP-4.8). `order` is the new sequence of CURRENT step
// indices: `order[k]` is the index (in the pre-reorder steps array) of the step that should land at
// position k. It must be a PERMUTATION of [0, steps.length): same length, every original index exactly
// once. An unknown sequence or a non-permutation order is rejected with a typed SlotEditError BEFORE any
// mutation (no document change, no history entry). The undo restores the prior config wholesale.
//
// COALESCES on the Session window (the command-history `slot.winseq.reorder` row): a drag-reorder gesture
// (a step dragged through several positions) collapses to ONE undo step keeping the ORIGINAL before and the
// latest order. The merge target is the sequence name (a reorder targets one sequence's whole step list).
// The steps are authoring DATA only; reordering reads no SpinResult (LAW 1).
export class ReorderWinSequenceStepCommand implements Command {
  readonly kind = 'slot.winseq.reorder';
  readonly label = 'Reorder Win Sequence Steps';
  private before: WinSequenceConfig | undefined;
  private readonly order: readonly number[];

  constructor(
    private readonly sequenceName: string,
    order: readonly number[],
  ) {
    this.order = order.slice();
  }

  // True iff `order` is a permutation of [0, length): same length and each index in range exactly once.
  private isPermutation(length: number): boolean {
    if (this.order.length !== length) return false;
    const seen = new Set<number>();
    for (const i of this.order) {
      if (!Number.isInteger(i) || i < 0 || i >= length || seen.has(i)) return false;
      seen.add(i);
    }
    return true;
  }

  do(ctx: CommandContext): void {
    const current = ctx.mutate.slotScene().winSequencer;
    const seq = current.sequences[this.sequenceName];
    if (seq === undefined) {
      throw new SlotEditError(
        'sequenceMissing',
        `win sequence "${this.sequenceName}" does not exist`,
      );
    }
    if (!this.isPermutation(seq.steps.length)) {
      throw new SlotEditError(
        'stepIndexOutOfRange',
        `reorder is not a permutation of the ${seq.steps.length} steps of sequence "${this.sequenceName}"`,
      );
    }
    if (this.before === undefined) {
      this.before = cloneWinSequenceConfig(current);
    }
    const copy = cloneWinSequenceConfig(current);
    const source = copy.sequences[this.sequenceName]!.steps;
    const steps: WinSequenceStep[] = this.order.map((i) => source[i]!);
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
    if (prev instanceof ReorderWinSequenceStepCommand && prev.sequenceName === this.sequenceName) {
      const merged = new ReorderWinSequenceStepCommand(this.sequenceName, this.order);
      merged.before = prev.before; // original before so one undo restores the pre-session order
      return merged;
    }
    return null;
  }
}

export const reorderWinSequenceStepSpec: CommandSpec = {
  kind: 'slot.winseq.reorder',
  // The default 'base' sequence is empty, so the harness has nothing to reorder. The representative is a
  // CompositeCommand (the established DuplicateAnimation pattern): it APPENDS two distinct steps to 'base',
  // then reverses them. That is ONE reversible undo step whose forward result has the steps in reversed
  // order; do/undo/redo round-trips exactly and `assertApplied` sees the order delta. The dedicated
  // slot-win-sequence-commands test exercises the reorder command in isolation on a populated sequence.
  representativeSeedId: 'minimal',
  fixture: () => {
    const stepA: WinSequenceStep = {
      atMs: 0,
      target: { kind: 'allWinningCells' },
      action: { kind: 'animateWin' },
    };
    const stepB: WinSequenceStep = {
      atMs: 500,
      target: { kind: 'allWinningCells' },
      action: { kind: 'rollupStart', curve: 'linear' },
    };
    const command = new CompositeCommand('Reorder Win Sequence Steps', [
      new SetWinSequenceStepCommand('base', 0, stepA),
      new SetWinSequenceStepCommand('base', 1, stepB),
      new ReorderWinSequenceStepCommand('base', [1, 0]),
    ]);
    return { command };
  },
  assertApplied: (before, after) => {
    const beforeSteps = before.slotScene.winSequencer.sequences['base']?.steps ?? [];
    const afterSteps = after.slotScene.winSequencer.sequences['base']?.steps ?? [];
    if (afterSteps.length !== beforeSteps.length + 2) {
      throw new Error('slot.winseq.reorder representative did not populate two steps');
    }
    // After append [A, B] then reorder [1, 0], the base sequence ends as [B, A]: index 0 is the rollup.
    if (afterSteps[0]?.action.kind !== 'rollupStart') {
      throw new Error('slot.winseq.reorder did not reverse the two appended steps');
    }
  },
};
