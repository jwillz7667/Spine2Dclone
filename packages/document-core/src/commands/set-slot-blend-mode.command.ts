import type { BlendMode } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

// Set a slot's blend mode (command-history catalog SetSlotBlendMode, `slot.blend`). A single enum
// field; never coalesces. Memento-based, absolute before/after.
export class SetSlotBlendModeCommand implements Command {
  readonly kind = 'slot.blend';
  readonly label = 'Set Slot Blend Mode';
  private before: BlendMode | undefined;

  constructor(
    private readonly target: SlotId,
    private readonly after: BlendMode,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const slot = ctx.mutate.getSlot(this.target);
      if (!slot) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = slot.blendMode;
    }
    ctx.mutate.patchSlot(this.target, { blendMode: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchSlot(this.target, { blendMode: this.before });
  }
}

export const setSlotBlendModeSpec: CommandSpec = {
  kind: 'slot.blend',
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const target = model.slots()[0];
    if (!target) return null;
    // 'slotted' slots are 'normal'; flip to 'additive' for a guaranteed delta.
    const after: BlendMode = target.blendMode === 'additive' ? 'screen' : 'additive';
    return { command: new SetSlotBlendModeCommand(target.id, after) };
  },
  assertApplied: (before, after) => {
    const id = before.slotOrder[0];
    if (id === undefined) throw new Error('slot.blend fixture seed had no slots');
    const b = findSlotSnapshot(before, id);
    const a = findSlotSnapshot(after, id);
    if (!b || !a) throw new Error('slot.blend target missing from snapshot');
    if (a.blendMode === b.blendMode) throw new Error('slot.blend produced no blend-mode delta');
    if (a.name !== b.name) throw new Error('slot.blend changed a field outside the blend mode');
  },
};
