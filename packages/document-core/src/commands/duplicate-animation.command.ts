import type { Command, CommandContext } from '../command/command';
import { CompositeCommand } from '../command/composite';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { AnimationEntity, BoneChannel } from '../model/doc-state';
import type { AnimationId } from '../model/ids';
import type { AnimationSnapshot } from '../model/read-model';
import { type KeyframeTarget } from './keyframe-support';
import { CreateAnimationCommand } from './create-animation.command';
import { SetKeyframeCommand } from './set-keyframe.command';
import { SetEventKeyCommand } from './set-event-key.command';
import { SetDrawOrderKeyCommand } from './set-draw-order-key.command';
import { findAnimationSnapshot, type CommandSpec } from './spec';

const BONE_CHANNELS: readonly BoneChannel[] = ['rotate', 'translate', 'scale', 'shear'];

// Build the child commands that reproduce a source animation under a new id: CreateAnimation for the new
// (empty) animation, then one SetKeyframe per authored keyframe (bone transform channels + slot color), one
// SetEventKey per event firing, and one SetDrawOrderKey per draw-order reorder. Each child mints a FRESH
// KeyframeId in the new animation (the unique-id invariant), carrying the source key's values/curves/offsets.
// Slot attachment-swap frames are not authorable in Phase 1 (no command creates one) and are not duplicated.
function buildDuplicateChildren(
  source: AnimationEntity,
  newId: AnimationId,
  newName: string,
): Command[] {
  const children: Command[] = [new CreateAnimationCommand(newId, newName, source.duration)];
  for (const [boneId, set] of source.bones) {
    for (const channel of BONE_CHANNELS) {
      for (const kf of set[channel]) {
        const target: KeyframeTarget = { kind: 'bone', boneId, channel };
        children.push(new SetKeyframeCommand(newId, target, kf.time, kf.value, kf.curve));
      }
    }
  }
  for (const [slotId, set] of source.slots) {
    for (const kf of set.color) {
      const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'color' };
      children.push(new SetKeyframeCommand(newId, target, kf.time, kf.value, kf.curve));
    }
  }
  for (const key of source.events) {
    children.push(
      new SetEventKeyCommand(newId, key.event, key.time, {
        int: key.int,
        float: key.float,
        string: key.string,
      }),
    );
  }
  for (const key of source.drawOrder) {
    children.push(new SetDrawOrderKeyCommand(newId, key.time, key.offsets));
  }
  return children;
}

// Duplicate an animation (command-history catalog DuplicateAnimation, `anim.duplicate`, Composite). The
// command IS a composition: it builds a CompositeCommand of CreateAnimation + SetKeyframe children on
// first do (it needs model access to read the source), then delegates do/undo to it, so the whole
// duplicate is exactly one undo step. Never coalesces.
export class DuplicateAnimationCommand implements Command {
  readonly kind = 'anim.duplicate';
  readonly label = 'Duplicate Animation';
  private composite: CompositeCommand | undefined;

  constructor(
    private readonly sourceId: AnimationId,
    private readonly newId: AnimationId,
    private readonly newName: string,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.composite) {
      const source = ctx.mutate.getAnimation(this.sourceId);
      if (!source) throw new CommandTargetMissingError(this.kind, this.sourceId);
      this.composite = new CompositeCommand(
        this.label,
        buildDuplicateChildren(source, this.newId, this.newName),
      );
    }
    this.composite.do(ctx);
  }

  undo(ctx: CommandContext): void {
    if (!this.composite) throw new CommandNotAppliedError(this.kind);
    this.composite.undo(ctx);
  }
}

function totalKeyframes(snapshot: AnimationSnapshot | undefined): number {
  if (snapshot === undefined) return 0;
  let total = 0;
  for (const bone of snapshot.bones) {
    total += bone.rotate.length + bone.translate.length + bone.scale.length + bone.shear.length;
  }
  for (const slot of snapshot.slots) total += slot.color.length;
  total += snapshot.events.length + snapshot.drawOrder.length;
  return total;
}

export const duplicateAnimationSpec: CommandSpec = {
  kind: 'anim.duplicate',
  representativeSeedId: 'animated',
  fixture: (model, ids) => {
    const source = model.animations()[0];
    if (!source) return null;
    const newId = ids.mint('animation');
    return { command: new DuplicateAnimationCommand(source.id, newId, `${source.name}_copy`) };
  },
  assertApplied: (before, after) => {
    const source = before.animations[0];
    if (source === undefined) throw new Error('anim.duplicate fixture seed had no animations');
    if (after.animations.length !== before.animations.length + 1) {
      throw new Error('anim.duplicate expected one more animation');
    }
    const beforeIds = new Set(before.animations.map((animation) => animation.id));
    const copy = after.animations.find((animation) => !beforeIds.has(animation.id));
    if (!copy) throw new Error('anim.duplicate did not add a new animation');
    const sourceCount = totalKeyframes(findAnimationSnapshot(before, source.id));
    const copyCount = totalKeyframes(copy);
    if (sourceCount === 0)
      throw new Error('anim.duplicate source had no authored keyframes to copy');
    if (copyCount !== sourceCount) {
      throw new Error('anim.duplicate did not copy every authored keyframe');
    }
  },
};
