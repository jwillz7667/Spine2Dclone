import type { BlendMode, RGBA } from '@marionette/format/types';
import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import type { SlotEntity } from '../model/doc-state';
import type { BoneId, SlotId } from '../model/ids';
import { findSlotSnapshot, type CommandSpec } from './spec';

// The setup fields a new slot is created with (everything but its identity). `bone` is the BoneId the
// slot rides; the caller (editor/MCP) resolves a valid bone before constructing the command.
export interface SlotInit {
  readonly name: string;
  readonly bone: BoneId;
  readonly color: RGBA;
  readonly darkColor: RGBA | null;
  readonly attachment: string | null;
  readonly blendMode: BlendMode;
}

// Create a slot (command-history catalog row CreateSlot, `slot.create`). Structural, never coalesces.
// The SlotId is minted by the caller so redo reuses the same id. Appends to slotOrder (the setup-pose
// draw order). selectionHint selects the new slot on execute/redo and clears on undo.
export class CreateSlotCommand implements Command {
  readonly kind = 'slot.create';
  readonly label = 'Create Slot';

  constructor(
    private readonly slotId: SlotId,
    private readonly init: SlotInit,
  ) {}

  do(ctx: CommandContext): void {
    const entity: SlotEntity = {
      id: this.slotId,
      name: this.init.name,
      bone: this.init.bone,
      color: this.init.color,
      darkColor: this.init.darkColor,
      attachment: this.init.attachment,
      blendMode: this.init.blendMode,
    };
    ctx.mutate.insertSlot(entity, ctx.mutate.slots().length);
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeSlot(this.slotId);
  }

  selectionHint(phase: HistoryPhase): SelectionHint {
    if (phase === 'undo') return { kind: 'clear' };
    return { kind: 'select', entities: [{ type: 'slot', id: this.slotId }] };
  }
}

export const createSlotSpec: CommandSpec = {
  kind: 'slot.create',
  // 'minimal' has a bone to ride; CreateSlot appends a slot, a real delta.
  representativeSeedId: 'minimal',
  fixture: (model, ids) => {
    const bone = model.bones()[0];
    if (!bone) return null;
    const id = ids.mint('slot');
    return {
      command: new CreateSlotCommand(id, {
        name: `slot_${id}`,
        bone: bone.id,
        color: { r: 1, g: 1, b: 1, a: 1 },
        darkColor: null,
        attachment: null,
        blendMode: 'normal',
      }),
    };
  },
  assertApplied: (before, after) => {
    if (after.slots.length !== before.slots.length + 1) {
      throw new Error(
        `slot.create expected one more slot (before ${before.slots.length}, after ${after.slots.length})`,
      );
    }
    if (after.slotOrder.length !== before.slotOrder.length + 1) {
      throw new Error('slot.create expected slotOrder to grow by one');
    }
    const beforeIds = new Set(before.slots.map((slot) => slot.id));
    const created = after.slots.find((slot) => !beforeIds.has(slot.id));
    if (!created) throw new Error('slot.create did not add a new slot');
    const inOrder = findSlotSnapshot(after, created.id);
    if (!inOrder || after.slotOrder[after.slotOrder.length - 1] !== created.id) {
      throw new Error('slot.create did not append the new slot to slotOrder');
    }
    if (!created.name.startsWith('slot_') || created.blendMode !== 'normal') {
      throw new Error('slot.create did not apply the fixture fields to the new slot');
    }
  },
};
