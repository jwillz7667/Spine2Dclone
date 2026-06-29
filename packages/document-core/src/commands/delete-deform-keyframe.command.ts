import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { DeformKeyframeEntity, DeformSkinKey } from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Delete a deform keyframe by KeyframeId (command-history catalog DeleteDeformKeyframe,
// `deform.deleteKeyframe`; WP-2.9). The before-memento is the whole (skin, slot, attachment) channel array
// (which carries the removed keyframe's offsets, time, and curve), so undo restores it exactly. When the
// last keyframe of a channel is removed the mutator prunes the now-empty deform track. Never coalesces.
export class DeleteDeformKeyframeCommand implements Command {
  readonly kind = 'deform.deleteKeyframe';
  readonly label = 'Delete Deform Keyframe';
  private before: readonly DeformKeyframeEntity[] | undefined;
  private after: readonly DeformKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly skinKey: DeformSkinKey,
    private readonly slotId: SlotId,
    private readonly attachmentName: string,
    private readonly keyframeId: KeyframeId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const anim = ctx.mutate.getAnimation(this.animId);
      if (!anim) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel =
        anim.deform.get(this.skinKey)?.get(this.slotId)?.get(this.attachmentName) ?? [];
      if (!channel.some((kf) => kf.id === this.keyframeId)) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = channel;
      this.after = channel.filter((kf) => kf.id !== this.keyframeId);
    }
    ctx.mutate.setDeformChannel(
      this.animId,
      this.skinKey,
      this.slotId,
      this.attachmentName,
      this.after,
    );
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setDeformChannel(
      this.animId,
      this.skinKey,
      this.slotId,
      this.attachmentName,
      this.before,
    );
  }
}

// Count the deform keyframes on every (skin, slot, attachment) track of an animation snapshot.
function countDeform(snapshot: ReturnType<typeof findAnimationSnapshot>): number {
  if (snapshot === undefined) return 0;
  return snapshot.deform.reduce((sum, track) => sum + track.keyframes.length, 0);
}

export const deleteDeformKeyframeSpec: CommandSpec = {
  kind: 'deform.deleteKeyframe',
  // 'rigged' carries a deform timeline on the default skin's 'panel' mesh; deleting its first keyframe is a
  // real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const anim = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!anim) return null;
    for (const [skinKey, bySlot] of anim.deform) {
      for (const [slotId, byName] of bySlot) {
        for (const [attachmentName, frames] of byName) {
          if (frames.length < 1) continue;
          return {
            command: new DeleteDeformKeyframeCommand(
              anim.id,
              skinKey,
              slotId,
              attachmentName,
              frames[0]!.id,
            ),
          };
        }
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (target === undefined)
      throw new Error('deform.deleteKeyframe fixture seed had no animations');
    const beforeCount = countDeform(findAnimationSnapshot(before, target.id));
    const afterCount = countDeform(findAnimationSnapshot(after, target.id));
    if (afterCount !== beforeCount - 1) {
      throw new Error('deform.deleteKeyframe did not remove exactly one deform keyframe');
    }
  },
};
