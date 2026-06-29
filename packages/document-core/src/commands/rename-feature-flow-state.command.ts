import type { FeatureFlowGraph } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { CompositeCommand } from '../command/composite';
import { cloneFeatureFlowGraph } from '../model/slot-scene';
import { CreateFeatureFlowStateCommand } from './create-feature-flow-state.command';
import { AddFeatureFlowTransitionCommand } from './add-feature-flow-transition.command';
import type { CommandSpec } from './spec';

// Rename a flow node key AND rewrite every transition that references it (command-history catalog
// RenameFeatureFlowState, `slot.flow.state.rename`; WP-4.9). The do replaces `states[from]` with
// `states[to]` (preserving the node value) and rewrites every transition's `from`/`to` that equals the old
// name. A MISSING source state, an empty new name, a new name that COLLIDES with an existing state, and a
// rename of the mandatory `base` node are rejected BEFORE any mutation with a typed SlotEditError (no
// document change, no history entry). NOT coalescing (a rename is a discrete edit).
//
// LAW 1: the graph is authoring DATA only. The before-memento is the WHOLE prior FeatureFlowGraph
// (deep-cloned), the smallest correct reverse for the key-plus-references rewrite in ONE undo step. The
// `entry` is never rewritten: entry must stay 'base' (the validator's flowEntryInvalid rule), and 'base'
// cannot be renamed, so a rename never touches entry.
export class RenameFeatureFlowStateCommand implements Command {
  readonly kind = 'slot.flow.state.rename';
  readonly label = 'Rename Feature Flow State';
  private before: FeatureFlowGraph | undefined;

  constructor(
    private readonly from: string,
    private readonly to: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.to.length === 0) {
      throw new SlotEditError('emptyName', 'feature flow state name must be non-empty');
    }
    const current = ctx.mutate.slotScene().featureFlows;
    if (!Object.prototype.hasOwnProperty.call(current.states, this.from)) {
      throw new SlotEditError('stateMissing', `feature flow state "${this.from}" does not exist`);
    }
    if (this.from === 'base') {
      throw new SlotEditError(
        'baseStateProtected',
        'the mandatory "base" feature flow state cannot be renamed',
      );
    }
    // A no-op rename (to === from) is allowed and produces an identity graph; a rename onto a DIFFERENT
    // existing key collides.
    if (this.to !== this.from && Object.prototype.hasOwnProperty.call(current.states, this.to)) {
      throw new SlotEditError('duplicateState', `feature flow state "${this.to}" already exists`);
    }
    if (this.before === undefined) {
      this.before = cloneFeatureFlowGraph(current);
    }
    const copy = cloneFeatureFlowGraph(current);
    // Rebuild the states record so the renamed key takes the old node's value (record key order is not
    // semantically significant; the snapshot/serializer sorts deterministically).
    const states: FeatureFlowGraph['states'] = {};
    for (const [key, node] of Object.entries(copy.states)) {
      if (node === undefined) continue;
      states[key === this.from ? this.to : key] = node;
    }
    // Rewrite referencing transitions (from/to that equal the old name point at the new name).
    const transitions = copy.transitions.map((t) => ({
      ...t,
      from: t.from === this.from ? this.to : t.from,
      to: t.to === this.from ? this.to : t.to,
    }));
    const next: FeatureFlowGraph = { ...copy, states, transitions };
    ctx.mutate.setSlotFeatureFlows(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotFeatureFlows(this.before);
  }
}

export const renameFeatureFlowStateSpec: CommandSpec = {
  kind: 'slot.flow.state.rename',
  // The default graph carries only the unrenamable 'base'. The representative is a CompositeCommand: create
  // 'freeSpins', add a base->freeSpins transition, then rename 'freeSpins' to 'bonusRound' (rewriting the
  // transition's `to`). One reversible undo step; assertApplied sees the renamed node and the rewritten edge.
  representativeSeedId: 'minimal',
  fixture: () => {
    const command = new CompositeCommand('Rename Feature Flow State', [
      new CreateFeatureFlowStateCommand('freeSpins'),
      new AddFeatureFlowTransitionCommand({
        from: 'base',
        on: { type: 'freeSpinsAwarded' },
        to: 'freeSpins',
      }),
      new RenameFeatureFlowStateCommand('freeSpins', 'bonusRound'),
    ]);
    return { command };
  },
  assertApplied: (before, after) => {
    const states = after.slotScene.featureFlows.states;
    if (!Object.prototype.hasOwnProperty.call(states, 'bonusRound')) {
      throw new Error('slot.flow.state.rename did not produce the renamed "bonusRound" state');
    }
    if (Object.prototype.hasOwnProperty.call(states, 'freeSpins')) {
      throw new Error('slot.flow.state.rename left the old "freeSpins" state');
    }
    const tx = after.slotScene.featureFlows.transitions;
    if (!tx.some((t) => t.to === 'bonusRound')) {
      throw new Error('slot.flow.state.rename did not rewrite the referencing transition');
    }
    if (
      Object.keys(states).length !==
      Object.keys(before.slotScene.featureFlows.states).length + 1
    ) {
      throw new Error('slot.flow.state.rename composite did not net-add exactly one state');
    }
  },
};
