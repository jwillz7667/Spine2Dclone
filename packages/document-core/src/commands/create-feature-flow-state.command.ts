import type { FeatureFlowGraph, FeatureFlowNode } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneFeatureFlowGraph } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Add a named flow node to slotScene.featureFlows.states (command-history catalog CreateFeatureFlowState,
// `slot.flow.state.create`; WP-4.9). The do inserts `{ [name]: node }`; a DUPLICATE name (or an empty name)
// is rejected BEFORE any mutation with a typed SlotEditError (no document change, no history entry). The undo
// restores the prior feature-flow graph wholesale (the before-memento), which removes the added state. NOT
// coalescing (creating a named state is a discrete edit, not a drag).
//
// The before-memento is the WHOLE prior FeatureFlowGraph (deep-cloned), the smallest correct reverse: a
// create adds exactly one states key, so restoring the prior graph is the bit-exact undo. The graph is
// authoring DATA only (states, transitions, entry); it never reads or embeds a SpinResult (LAW 1). The node
// may carry an optional cinematic (a VFX-preset / animation reference by name); it is captured by value.
export class CreateFeatureFlowStateCommand implements Command {
  readonly kind = 'slot.flow.state.create';
  readonly label = 'Create Feature Flow State';
  private before: FeatureFlowGraph | undefined;
  private readonly node: FeatureFlowNode;

  constructor(
    private readonly name: string,
    node?: FeatureFlowNode,
  ) {
    this.node = structuredClone(node ?? {});
  }

  do(ctx: CommandContext): void {
    if (this.name.length === 0) {
      throw new SlotEditError('emptyName', 'feature flow state name must be non-empty');
    }
    const current = ctx.mutate.slotScene().featureFlows;
    if (Object.prototype.hasOwnProperty.call(current.states, this.name)) {
      throw new SlotEditError('duplicateState', `feature flow state "${this.name}" already exists`);
    }
    if (this.before === undefined) {
      this.before = cloneFeatureFlowGraph(current);
    }
    const copy = cloneFeatureFlowGraph(current);
    const next: FeatureFlowGraph = {
      ...copy,
      states: { ...copy.states, [this.name]: structuredClone(this.node) },
    };
    ctx.mutate.setSlotFeatureFlows(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotFeatureFlows(this.before);
  }
}

export const createFeatureFlowStateSpec: CommandSpec = {
  kind: 'slot.flow.state.create',
  // Every seed loads the default feature-flow graph (one 'base' node). Creating a 'freeSpins' node is a clean
  // delta against that default.
  representativeSeedId: 'minimal',
  fixture: (model) => {
    if (Object.prototype.hasOwnProperty.call(model.slotScene().featureFlows.states, 'freeSpins')) {
      return null;
    }
    return { command: new CreateFeatureFlowStateCommand('freeSpins') };
  },
  assertApplied: (before, after) => {
    const beforeKeys = Object.keys(before.slotScene.featureFlows.states).length;
    const afterKeys = Object.keys(after.slotScene.featureFlows.states).length;
    if (afterKeys !== beforeKeys + 1) {
      throw new Error('slot.flow.state.create did not add exactly one named state');
    }
    if (!('freeSpins' in after.slotScene.featureFlows.states)) {
      throw new Error('slot.flow.state.create did not add the "freeSpins" state');
    }
  },
};
