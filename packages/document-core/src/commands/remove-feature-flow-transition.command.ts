import type { FeatureFlowGraph } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { CompositeCommand } from '../command/composite';
import { cloneFeatureFlowGraph } from '../model/slot-scene';
import { AddFeatureFlowTransitionCommand } from './add-feature-flow-transition.command';
import type { CommandSpec } from './spec';

// Remove ONE transition from slotScene.featureFlows.transitions BY INDEX (command-history catalog
// RemoveFeatureFlowTransition, `slot.flow.transition.remove`; WP-4.9). The do splices out the transition at
// `index`; an OUT-OF-RANGE index is rejected BEFORE any mutation with a typed SlotEditError (no document
// change, no history entry). The undo restores the prior graph wholesale (the before-memento), which
// re-inserts the removed transition at its original position. NOT coalescing (a remove is a discrete edit).
//
// Removal is by INDEX (the stable address the panel hands the command from the authored transition list), not
// by value: two transitions can be value-equal (same from/on/to), so an index is the unambiguous target. The
// before-memento is the WHOLE prior FeatureFlowGraph (deep-cloned), the smallest correct reverse. LAW 1: the
// graph is authoring DATA only.
export class RemoveFeatureFlowTransitionCommand implements Command {
  readonly kind = 'slot.flow.transition.remove';
  readonly label = 'Remove Feature Flow Transition';
  private before: FeatureFlowGraph | undefined;

  constructor(private readonly index: number) {}

  do(ctx: CommandContext): void {
    const current = ctx.mutate.slotScene().featureFlows;
    if (
      !Number.isInteger(this.index) ||
      this.index < 0 ||
      this.index >= current.transitions.length
    ) {
      throw new SlotEditError(
        'transitionMissing',
        `transition index ${this.index} is outside [0, ${current.transitions.length - 1}]`,
      );
    }
    if (this.before === undefined) {
      this.before = cloneFeatureFlowGraph(current);
    }
    const copy = cloneFeatureFlowGraph(current);
    const transitions = copy.transitions.slice();
    transitions.splice(this.index, 1);
    const next: FeatureFlowGraph = { ...copy, transitions };
    ctx.mutate.setSlotFeatureFlows(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotFeatureFlows(this.before);
  }
}

export const removeFeatureFlowTransitionSpec: CommandSpec = {
  kind: 'slot.flow.transition.remove',
  // The default graph has no transitions. The representative is a CompositeCommand: add TWO base->base
  // transitions, then remove index 0. One reversible undo step; net forward delta is +1 transition (two
  // added, one removed), so assertApplied sees a real, observable change.
  representativeSeedId: 'minimal',
  fixture: () => {
    const command = new CompositeCommand('Remove Feature Flow Transition', [
      new AddFeatureFlowTransitionCommand({ from: 'base', on: { type: 'a' }, to: 'base' }),
      new AddFeatureFlowTransitionCommand({ from: 'base', on: { type: 'b' }, to: 'base' }),
      new RemoveFeatureFlowTransitionCommand(0),
    ]);
    return { command };
  },
  assertApplied: (before, after) => {
    const beforeTx = before.slotScene.featureFlows.transitions.length;
    const afterTx = after.slotScene.featureFlows.transitions.length;
    if (afterTx !== beforeTx + 1) {
      throw new Error(
        'slot.flow.transition.remove composite did not net-add exactly one transition',
      );
    }
    // The surviving transition is the second-added ('b'); index 0 ('a') was removed.
    if (after.slotScene.featureFlows.transitions.some((t) => t.on.type === 'a')) {
      throw new Error('slot.flow.transition.remove did not remove the index-0 transition');
    }
  },
};
