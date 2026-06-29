import type { FeatureFlowGraph } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { CompositeCommand } from '../command/composite';
import { cloneFeatureFlowGraph } from '../model/slot-scene';
import { CreateFeatureFlowStateCommand } from './create-feature-flow-state.command';
import { AddFeatureFlowTransitionCommand } from './add-feature-flow-transition.command';
import type { CommandSpec } from './spec';

// Delete a named flow node AND all transitions incident to it (command-history catalog DeleteFeatureFlowState,
// `slot.flow.state.delete`; WP-4.9). The do removes `states[name]` and every transition whose `from === name`
// OR `to === name`; the before-memento restores BOTH the node and the dropped edges on undo (deep-equal). A
// MISSING state and the SOLE `base` node are rejected BEFORE any mutation with a typed SlotEditError (no
// document change, no history entry). NOT coalescing (a delete is a discrete edit).
//
// LAW 1: the graph is authoring DATA only; the delete touches states/transitions and never an outcome. The
// before-memento is the WHOLE prior FeatureFlowGraph (deep-cloned), the smallest correct reverse for the
// node-plus-incident-edges cascade in ONE undo step.
export class DeleteFeatureFlowStateCommand implements Command {
  readonly kind = 'slot.flow.state.delete';
  readonly label = 'Delete Feature Flow State';
  private before: FeatureFlowGraph | undefined;

  constructor(private readonly name: string) {}

  do(ctx: CommandContext): void {
    const current = ctx.mutate.slotScene().featureFlows;
    if (!Object.prototype.hasOwnProperty.call(current.states, this.name)) {
      throw new SlotEditError('stateMissing', `feature flow state "${this.name}" does not exist`);
    }
    // The sole mandatory `base` node cannot be deleted (the validator requires states.base + entry 'base').
    if (this.name === 'base') {
      throw new SlotEditError(
        'baseStateProtected',
        'the mandatory "base" feature flow state cannot be deleted',
      );
    }
    if (this.before === undefined) {
      this.before = cloneFeatureFlowGraph(current);
    }
    const copy = cloneFeatureFlowGraph(current);
    const states: FeatureFlowGraph['states'] = {};
    for (const [key, node] of Object.entries(copy.states)) {
      if (key === this.name || node === undefined) continue;
      states[key] = node;
    }
    // Drop every transition incident to the deleted node (from OR to it). Array order of the survivors is
    // preserved (a filter), so the undo deep-equal is exact when the whole graph is restored.
    const transitions = copy.transitions.filter((t) => t.from !== this.name && t.to !== this.name);
    const next: FeatureFlowGraph = { ...copy, states, transitions };
    ctx.mutate.setSlotFeatureFlows(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotFeatureFlows(this.before);
  }
}

export const deleteFeatureFlowStateSpec: CommandSpec = {
  kind: 'slot.flow.state.delete',
  // The default graph carries only 'base' (undeletable), so the representative is a CompositeCommand (the
  // established ReorderWinSequenceStep pattern): it CREATES a 'freeSpins' node and a base->freeSpins
  // transition, then deletes 'freeSpins'. That is ONE reversible undo step whose forward result has the node
  // gone AND its incident transition dropped; do/undo/redo round-trips exactly and assertApplied sees the
  // cascade. The dedicated slot-feature-flow-commands test exercises delete + cascade in isolation.
  representativeSeedId: 'minimal',
  fixture: () => {
    // Create a 'survivor' node and a 'freeSpins' node, add a base->survivor transition (NOT incident to the
    // deleted node, survives) and a base->freeSpins transition (incident, dropped), then delete 'freeSpins'.
    // Net forward delta: +1 state ('survivor') and +1 transition (base->survivor); the base->freeSpins edge
    // is added then cascaded away by the delete. Observable, reversible in one undo step.
    const command = new CompositeCommand('Delete Feature Flow State', [
      new CreateFeatureFlowStateCommand('survivor'),
      new CreateFeatureFlowStateCommand('freeSpins'),
      new AddFeatureFlowTransitionCommand({
        from: 'base',
        on: { type: 'enterSurvivor' },
        to: 'survivor',
      }),
      new AddFeatureFlowTransitionCommand({
        from: 'base',
        on: { type: 'freeSpinsAwarded' },
        to: 'freeSpins',
      }),
      new DeleteFeatureFlowStateCommand('freeSpins'),
    ]);
    return { command };
  },
  assertApplied: (before, after) => {
    const beforeStates = Object.keys(before.slotScene.featureFlows.states).length;
    const afterStates = Object.keys(after.slotScene.featureFlows.states).length;
    // Net: +1 state ('survivor' remains; 'freeSpins' added then deleted).
    if (afterStates !== beforeStates + 1) {
      throw new Error('slot.flow.state.delete composite did not net-add exactly one state');
    }
    if (Object.prototype.hasOwnProperty.call(after.slotScene.featureFlows.states, 'freeSpins')) {
      throw new Error('slot.flow.state.delete did not remove the freeSpins state');
    }
    // Net: +1 transition (base->survivor survives; base->freeSpins cascaded away with the node).
    const beforeTx = before.slotScene.featureFlows.transitions.length;
    const afterTx = after.slotScene.featureFlows.transitions.length;
    if (afterTx !== beforeTx + 1) {
      throw new Error('slot.flow.state.delete did not cascade-drop the incident transition');
    }
    if (after.slotScene.featureFlows.transitions.some((t) => t.to === 'freeSpins')) {
      throw new Error('slot.flow.state.delete left a dangling transition to freeSpins');
    }
  },
};
