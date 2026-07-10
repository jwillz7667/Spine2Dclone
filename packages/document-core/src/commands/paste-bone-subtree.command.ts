import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { AttachmentEntity, BoneEntity, SlotEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { Mutator } from '../model/mutator';
import {
  captureBoneSubtree,
  uniqueDuplicateName,
  type BoneSubtreeClip,
} from './bone-subtree-support';
import type { CommandSpec } from './spec';

// A slot the paste will create, with the default-skin attachments to re-add under it.
interface PlannedSlot {
  readonly entity: SlotEntity;
  readonly attachments: readonly AttachmentEntity[];
}

// The concrete, id-minted work a paste performs, computed ONCE on first `do` (it needs an IdFactory and
// the live name sets) and cached so redo reuses the SAME ids and undo removes exactly what was added.
interface PastePlan {
  readonly bones: readonly BoneEntity[]; // in pre-order (parents before children)
  readonly slots: readonly PlannedSlot[];
  readonly rootId: BoneId | null; // the pasted subtree root, for the selection hint
}

// Paste (or duplicate) a captured bone subtree under a target parent (PP-D7). A copy/paste holds the clip
// in the ephemeral clipboard store and pastes it under the selected bone; a Ctrl+D duplicate captures the
// selected bone's subtree and pastes it under that bone's own parent (in place). BOTH flows are this one
// command: the only difference is the clip source and the `newParent` argument. Duplication can never
// create a cycle (the new bones form a fresh subtree hanging off an existing parent), so unlike Reparent
// there is no cycle guard. A SINGLE command with an insert plan (mirroring DeleteBone in reverse), NOT a
// CompositeCommand, so the whole paste is ONE undo step. Never coalesces. selectionHint selects the pasted
// root on execute/redo and clears on undo.
export class PasteBoneSubtreeCommand implements Command {
  readonly kind = 'bone.pasteSubtree';
  readonly label = 'Paste Bone';
  private plan: PastePlan | undefined;

  constructor(
    private readonly clip: BoneSubtreeClip,
    private readonly newParent: BoneId | null,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.plan) this.plan = this.build(ctx);
    applyPlan(ctx.mutate, this.plan);
  }

  undo(ctx: CommandContext): void {
    if (!this.plan) throw new CommandNotAppliedError(this.kind);
    revertPlan(ctx.mutate, this.plan);
  }

  selectionHint(phase: HistoryPhase): SelectionHint {
    if (phase === 'undo') return { kind: 'clear' };
    const rootId = this.plan?.rootId ?? null;
    return rootId !== null
      ? { kind: 'select', entities: [{ type: 'bone', id: rootId }] }
      : { kind: 'preserve' };
  }

  // Mint fresh ids, generate export-unique names, and re-link parents within the copy. Bone ids are minted
  // FIRST so a child's parent (an index into the clip) resolves to its copied parent's new id. Names
  // accumulate into the `taken` sets so sibling copies never collide with each other or with live names.
  private build(ctx: CommandContext): PastePlan {
    const takenBoneNames = new Set(ctx.mutate.bones().map((bone) => bone.name));
    const takenSlotNames = new Set(ctx.mutate.slots().map((slot) => slot.name));
    const boneIds = this.clip.bones.map(() => ctx.ids.mint('bone'));

    const bones: BoneEntity[] = [];
    const slots: PlannedSlot[] = [];
    this.clip.bones.forEach((clipBone, index) => {
      const parent =
        clipBone.parentIndex === null ? this.newParent : (boneIds[clipBone.parentIndex] ?? null);
      const name = uniqueDuplicateName(takenBoneNames, clipBone.geometry.name);
      takenBoneNames.add(name);
      const id = boneIds[index]!;
      bones.push({ ...clipBone.geometry, id, parent, name });

      for (const clipSlot of clipBone.slots) {
        const slotId = ctx.ids.mint('slot');
        const slotName = uniqueDuplicateName(takenSlotNames, clipSlot.name);
        takenSlotNames.add(slotName);
        const entity: SlotEntity = {
          id: slotId,
          name: slotName,
          bone: id,
          color: clipSlot.color,
          darkColor: clipSlot.darkColor,
          attachment: clipSlot.attachment,
          blendMode: clipSlot.blendMode,
        };
        slots.push({ entity, attachments: clipSlot.attachments });
      }
    });
    return { bones, slots, rootId: boneIds[0] ?? null };
  }
}

// Insert the copied bones (pre-order, appended so each parent precedes its children and the boneOrder
// parent-before-child invariant holds), then the copied slots with their attachments.
function applyPlan(mutate: Mutator, plan: PastePlan): void {
  for (const entity of plan.bones) mutate.insertBone(entity, mutate.bones().length);
  for (const planned of plan.slots) {
    mutate.insertSlot(planned.entity, mutate.slots().length);
    for (const att of planned.attachments) mutate.addAttachment(planned.entity.id, att);
  }
}

// Remove exactly what applyPlan added: attachments, then slots, then bones children-first (reverse of the
// pre-order insertion) so each removal is independent.
function revertPlan(mutate: Mutator, plan: PastePlan): void {
  for (const planned of plan.slots) {
    for (const att of planned.attachments) mutate.removeAttachment(planned.entity.id, att.name);
    mutate.removeSlot(planned.entity.id);
  }
  for (let i = plan.bones.length - 1; i >= 0; i -= 1) {
    const entity = plan.bones[i];
    if (entity) mutate.removeBone(entity.id);
  }
}

export const pasteBoneSubtreeSpec: CommandSpec = {
  kind: 'bone.pasteSubtree',
  // 'slotted' has a two-bone subtree (root -> arm) with slots and a region attachment, so a duplicate of
  // the root exercises the bone + slot + attachment copy in one command.
  representativeSeedId: 'slotted',
  fixture: (model) => {
    const root = model.bones()[0];
    if (!root) return null;
    const clip = captureBoneSubtree(model, root.id);
    if (!clip) return null;
    // Duplicate the root subtree in place (paste under the root's own parent).
    return { command: new PasteBoneSubtreeCommand(clip, root.parent) };
  },
  assertApplied: (before, after) => {
    if (after.bones.length <= before.bones.length) {
      throw new Error('bone.pasteSubtree expected more bones');
    }
    // A paste ADDS entities; every pre-existing bone must survive untouched (never renamed or removed).
    const beforeBoneIds = new Set(before.bones.map((bone) => bone.id));
    for (const id of beforeBoneIds) {
      if (!after.bones.some((bone) => bone.id === id)) {
        throw new Error('bone.pasteSubtree removed a pre-existing bone');
      }
    }
    // Exactly the copies are new; at least one carries the `_copy` duplicate marker.
    const copies = after.bones.filter((bone) => !beforeBoneIds.has(bone.id));
    if (copies.length === 0) throw new Error('bone.pasteSubtree added no new bone');
    if (!copies.some((bone) => bone.name.includes('_copy'))) {
      throw new Error('bone.pasteSubtree did not apply a _copy duplicate name');
    }
    if (after.slots.length < before.slots.length) {
      throw new Error('bone.pasteSubtree dropped a slot');
    }
  },
};
