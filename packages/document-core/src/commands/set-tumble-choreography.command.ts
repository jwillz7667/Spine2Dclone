import type { TumbleChoreography } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneTumbleChoreography } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Set the tumble / cascade choreography (command-history catalog SetTumbleChoreography, `slot.tumble.set`;
// WP-4.10 TASK-4.10.2). The do replaces slotScene.tumble with the new explode/drop/refill timing block plus
// the per-step rollup curve; the undo restores the PREVIOUS choreography (the before-memento, deep-cloned).
// Each TIMING value (explodeMs, dropMs, refillStaggerMs, settleMs, stepGapMs) must be a finite, NON-NEGATIVE
// INTEGER millisecond (the format tumbleChoreography bounds, re-asserted here so an invalid value is rejected
// BEFORE any mutation: no document change, no history entry). The two curve fields (dropEasing, rollupCurve)
// are closed-enum strings typed by the format TumbleChoreography type; an out-of-enum value is a type error
// at the call site, so the runtime guard checks the timings (the only numeric, unbounded surface).
//
// COALESCES on the Session window (the command-history `slot.tumble.set` row, mirroring SetGridConfig): a
// sequence of timing-slider edits (a drag of dropMs / settleMs / ...) inside one interaction collapses to ONE
// undo step with ONE memento. The choreography is a SINGLE target, so coalesceWith merges any same-kind
// predecessor; `before` is captured on first do and the new choreography is ABSOLUTE, so undo is bit-exact
// and a coalesced drag never accumulates drift (a merged command keeps the ORIGINAL before and the latest
// choreography). LAW 1: the choreography is authoring DATA only (timing + curve); it never reads a SpinResult
// (the cascade CONTENTS come from the engine at sequence time; the author sets only the visual cadence).
export class SetTumbleChoreographyCommand implements Command {
  readonly kind = 'slot.tumble.set';
  readonly label = 'Set Tumble Choreography';
  private before: TumbleChoreography | undefined;
  private readonly tumble: TumbleChoreography;

  constructor(tumble: TumbleChoreography) {
    this.tumble = cloneTumbleChoreography(tumble);
  }

  // Reject a non-finite / negative / non-integer timing BEFORE any mutation (the WP-4.10 contract: all
  // durations are non-negative integer ms). The curve fields are enum-typed at the type level; this guard
  // covers the five numeric timings, the only unbounded surface.
  private assertValid(): void {
    for (const [field, value] of [
      ['explodeMs', this.tumble.explodeMs],
      ['dropMs', this.tumble.dropMs],
      ['refillStaggerMs', this.tumble.refillStaggerMs],
      ['settleMs', this.tumble.settleMs],
      ['stepGapMs', this.tumble.stepGapMs],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new SlotEditError(
          'invalidTiming',
          `tumble ${field} must be a non-negative integer millisecond, received ${value}`,
        );
      }
    }
  }

  do(ctx: CommandContext): void {
    this.assertValid();
    if (this.before === undefined) {
      this.before = cloneTumbleChoreography(ctx.mutate.slotScene().tumble);
    }
    ctx.mutate.setSlotTumble(this.tumble);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotTumble(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetTumbleChoreographyCommand) {
      const merged = new SetTumbleChoreographyCommand(this.tumble);
      merged.before = prev.before; // original before so one undo restores the pre-session choreography
      return merged;
    }
    return null;
  }
}

export const setTumbleChoreographySpec: CommandSpec = {
  kind: 'slot.tumble.set',
  // The default tumble is all-zero with linear curves, so setting a non-zero choreography is a clean delta
  // on 'minimal'.
  representativeSeedId: 'minimal',
  fixture: () => ({
    command: new SetTumbleChoreographyCommand({
      explodeMs: 120,
      dropMs: 200,
      dropEasing: 'easeOutQuad',
      refillStaggerMs: 40,
      settleMs: 80,
      stepGapMs: 150,
      rollupCurve: 'easeInOutCubic',
    }),
  }),
  assertApplied: (before, after) => {
    const b = before.slotScene.tumble;
    const a = after.slotScene.tumble;
    if (
      a.explodeMs === b.explodeMs &&
      a.dropMs === b.dropMs &&
      a.dropEasing === b.dropEasing &&
      a.refillStaggerMs === b.refillStaggerMs &&
      a.settleMs === b.settleMs &&
      a.stepGapMs === b.stepGapMs &&
      a.rollupCurve === b.rollupCurve
    ) {
      throw new Error('slot.tumble.set produced no tumble choreography delta');
    }
    if (
      a.explodeMs !== 120 ||
      a.dropMs !== 200 ||
      a.dropEasing !== 'easeOutQuad' ||
      a.refillStaggerMs !== 40 ||
      a.settleMs !== 80 ||
      a.stepGapMs !== 150 ||
      a.rollupCurve !== 'easeInOutCubic'
    ) {
      throw new Error('slot.tumble.set did not apply the new tumble choreography');
    }
  },
};
