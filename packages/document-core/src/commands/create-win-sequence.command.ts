import type { WinSequenceConfig } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneWinSequenceConfig } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// Add a named, empty win sequence to slotScene.winSequencer.sequences (command-history catalog
// CreateWinSequence, `slot.winseq.create`; WP-4.8). The do inserts `{ [name]: { steps: [] } }`; a DUPLICATE
// name is rejected BEFORE any mutation with a typed SlotEditError (no document change, no history entry).
// The undo restores the prior win-sequencer config wholesale (the before-memento), which removes the added
// sequence. NOT coalescing (creating a named sequence is a discrete edit, not a drag).
//
// The before-memento is the WHOLE prior WinSequenceConfig (deep-cloned), the smallest correct reverse: a
// create adds exactly one sequences key, so restoring the prior config is the bit-exact undo. The config is
// authoring DATA only (named sequences, thresholds); it never reads or embeds a SpinResult (LAW 1).
export class CreateWinSequenceCommand implements Command {
  readonly kind = 'slot.winseq.create';
  readonly label = 'Create Win Sequence';
  private before: WinSequenceConfig | undefined;

  constructor(private readonly name: string) {}

  do(ctx: CommandContext): void {
    if (this.name.length === 0) {
      throw new SlotEditError('emptyName', 'win sequence name must be non-empty');
    }
    const current = ctx.mutate.slotScene().winSequencer;
    if (this.name in current.sequences) {
      throw new SlotEditError('duplicateSequence', `win sequence "${this.name}" already exists`);
    }
    if (this.before === undefined) {
      this.before = cloneWinSequenceConfig(current);
    }
    const copy = cloneWinSequenceConfig(current);
    const next: WinSequenceConfig = {
      ...copy,
      sequences: { ...copy.sequences, [this.name]: { steps: [] } },
    };
    ctx.mutate.setSlotWinSequencer(next);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSlotWinSequencer(this.before);
  }
}

export const createWinSequenceSpec: CommandSpec = {
  kind: 'slot.winseq.create',
  // Every seed loads the default win sequencer (one 'base' sequence). Creating a new 'bonus' sequence is a
  // clean delta against that default.
  representativeSeedId: 'minimal',
  fixture: (model) => {
    if ('bonus' in model.slotScene().winSequencer.sequences) return null;
    return { command: new CreateWinSequenceCommand('bonus') };
  },
  assertApplied: (before, after) => {
    const beforeKeys = Object.keys(before.slotScene.winSequencer.sequences).length;
    const afterKeys = Object.keys(after.slotScene.winSequencer.sequences).length;
    if (afterKeys !== beforeKeys + 1) {
      throw new Error('slot.winseq.create did not add exactly one named sequence');
    }
    if (!('bonus' in after.slotScene.winSequencer.sequences)) {
      throw new Error('slot.winseq.create did not add the "bonus" sequence');
    }
  },
};
