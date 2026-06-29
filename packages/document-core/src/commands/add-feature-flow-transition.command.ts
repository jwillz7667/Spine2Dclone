import type { FeatureFlowGraph, FeatureFlowTransition } from '@marionette/format/slot-types';
import { featureFlowTransitionSchema } from '@marionette/format/slot';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneFeatureFlowGraph } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Append a transition to slotScene.featureFlows.transitions (command-history catalog AddFeatureFlowTransition,
// `slot.flow.transition.add`; WP-4.9). The candidate transition is shape-validated against the format schema
// BEFORE any mutation (so a malformed `on` match / empty endpoint leaves no document change and no history
// entry). The do appends the transition; the undo removes it by restoring the prior graph wholesale (the
// before-memento). NOT coalescing (adding a transition is a discrete edit).
//
// The transition's `on` is a FeatureMatch: a feature TYPE plus an OPTIONAL data FIELD-NAME + constant
// predicate. The command stores field names and constants only, never an outcome the presentation decides
// (LAW 1). Endpoint existence (from/to name a real state) is NOT enforced here: the command appends what the
// author authored, and the format graph-integrity validator (flowTransitionDangling) catches a dangling
// endpoint on import, mirroring how winSequencer.defaultSequence resolution is a validator concern. This
// keeps an in-progress graph (a transition authored before its target node) representable without a throw.
export class AddFeatureFlowTransitionCommand implements Command {
  readonly kind = 'slot.flow.transition.add';
  readonly label = 'Add Feature Flow Transition';
  private before: FeatureFlowGraph | undefined;
  private readonly transition: FeatureFlowTransition;

  constructor(transition: FeatureFlowTransition) {
    this.transition = structuredClone(transition);
  }

  do(ctx: CommandContext): void {
    const parsed = featureFlowTransitionSchema.safeParse(this.transition);
    if (!parsed.success) {
      throw new SlotEditError(
        'emptyName',
        parsed.error.issues[0]?.message ?? 'invalid feature flow transition shape',
      );
    }
    const current = ctx.mutate.slotScene().featureFlows;
    if (this.before === undefined) {
      this.before = cloneFeatureFlowGraph(current);
    }
    const copy = cloneFeatureFlowGraph(current);
    const next: FeatureFlowGraph = {
      ...copy,
      transitions: [...copy.transitions, structuredClone(this.transition)],
    };
    ctx.mutate.setSlotFeatureFlows(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotFeatureFlows(this.before);
  }
}

export const addFeatureFlowTransitionSpec: CommandSpec = {
  kind: 'slot.flow.transition.add',
  // The default graph has a single 'base' node and no transitions; a base->base transition keyed off a
  // feature type is a clean delta (endpoints exist; the validator stays happy).
  representativeSeedId: 'minimal',
  fixture: () => ({
    command: new AddFeatureFlowTransitionCommand({
      from: 'base',
      on: { type: 'freeSpinsAwarded' },
      to: 'base',
    }),
  }),
  assertApplied: (before, after) => {
    const beforeCount = before.slotScene.featureFlows.transitions.length;
    const afterCount = after.slotScene.featureFlows.transitions.length;
    if (afterCount !== beforeCount + 1) {
      throw new Error('slot.flow.transition.add did not append exactly one transition');
    }
  },
};
