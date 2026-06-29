import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import {
  makeDeformKeyframe,
  type DeformKeyframeEntity,
  type DeformSkinKey,
} from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a deform keyframe to a new time (command-history catalog MoveDeformKeyframe,
// `deform.moveKeyframe`; WP-2.9). Targets the keyframe by KeyframeId (an array index would go stale on any
// sibling edit), re-sorts the (skin, slot, attachment) channel, and REJECTS a move onto a time another
// keyframe already occupies with a typed KeyframeCollisionError thrown before any mutation (the UI/auto-key
// prevents collisions; this is the fail-loud backstop). before/after are whole-channel mementos. Never
// coalesces (a deform drag re-sets offsets via SetDeformKeyframe; this is a discrete time move).
export class MoveDeformKeyframeCommand implements Command {
  readonly kind = 'deform.moveKeyframe';
  readonly label = 'Move Deform Keyframe';
  private before: readonly DeformKeyframeEntity[] | undefined;
  private after: readonly DeformKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly skinKey: DeformSkinKey,
    private readonly slotId: SlotId,
    private readonly attachmentName: string,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const anim = ctx.mutate.getAnimation(this.animId);
      if (!anim) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel =
        anim.deform.get(this.skinKey)?.get(this.slotId)?.get(this.attachmentName) ?? [];
      const moving = channel.find((kf) => kf.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (channel.some((kf) => kf.id !== this.keyframeId && kf.time === this.newTime)) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = channel;
      const moved = makeDeformKeyframe(moving.id, this.newTime, moving.offsets, moving.curve);
      this.after = channel
        .map((kf) => (kf.id === this.keyframeId ? moved : kf))
        .sort((a, b) => a.time - b.time);
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

// The deform keyframe times on every (skin, slot, attachment) track of an animation snapshot, in order.
function deformTimes(snapshot: ReturnType<typeof findAnimationSnapshot>): number[] {
  if (snapshot === undefined) return [];
  return snapshot.deform.flatMap((track) => track.keyframes.map((kf) => kf.time));
}

export const moveDeformKeyframeSpec: CommandSpec = {
  kind: 'deform.moveKeyframe',
  // 'rigged' carries a deform timeline on the default skin's 'panel' mesh with two keyframes; moving the
  // first to their midpoint is a free time, collides with nothing, and is a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const anim = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!anim) return null;
    for (const [skinKey, bySlot] of anim.deform) {
      for (const [slotId, byName] of bySlot) {
        for (const [attachmentName, frames] of byName) {
          if (frames.length < 2) continue;
          const newTime = (frames[0]!.time + frames[1]!.time) / 2;
          // The midpoint is strictly between the two keys, so no other keyframe occupies it.
          if (frames.some((kf) => kf.time === newTime)) continue;
          return {
            command: new MoveDeformKeyframeCommand(
              anim.id,
              skinKey,
              slotId,
              attachmentName,
              frames[0]!.id,
              newTime,
            ),
          };
        }
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (target === undefined) throw new Error('deform.moveKeyframe fixture seed had no animations');
    const beforeTimes = deformTimes(findAnimationSnapshot(before, target.id));
    const afterTimes = deformTimes(findAnimationSnapshot(after, target.id));
    if (afterTimes.length !== beforeTimes.length) {
      throw new Error('deform.moveKeyframe changed the keyframe count');
    }
    if (beforeTimes.join(',') === afterTimes.join(',')) {
      throw new Error('deform.moveKeyframe produced no time delta');
    }
  },
};
