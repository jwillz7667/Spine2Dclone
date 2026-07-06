import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import {
  makeDeformKeyframe,
  type DeformKeyframeEntity,
  type DeformSkinKey,
} from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Set the outgoing interpolation curve of an EXISTING deform keyframe by KeyframeId (command-history
// catalog SetDeformCurve, `deform.setCurve`). SetCurveCommand covers only bone/slot-color targets and
// SetDeformKeyframeCommand's update path deliberately keeps the old curve, so before this command the
// only way to re-ease a deform key was delete + re-insert (losing the KeyframeId). The keyframe's id,
// time, and offsets are kept; only the curve changes. The before-memento is the whole (skin, slot,
// attachment) channel array, so undo is bit-exact. Never coalesces (a curve set is discrete).
export class SetDeformCurveCommand implements Command {
  readonly kind = 'deform.setCurve';
  readonly label = 'Set Deform Curve';
  private before: readonly DeformKeyframeEntity[] | undefined;
  private after: readonly DeformKeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly skinKey: DeformSkinKey,
    private readonly slotId: SlotId,
    private readonly attachmentName: string,
    private readonly keyframeId: KeyframeId,
    private readonly curve: CurveType,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const anim = ctx.mutate.getAnimation(this.animId);
      if (!anim) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel =
        anim.deform.get(this.skinKey)?.get(this.slotId)?.get(this.attachmentName) ?? [];
      const existing = channel.find((kf) => kf.id === this.keyframeId);
      if (!existing) {
        throw new CommandTargetMissingError(this.kind, this.keyframeId);
      }
      this.before = channel;
      const updated = makeDeformKeyframe(existing.id, existing.time, existing.offsets, this.curve);
      this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
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

export const setDeformCurveSpec: CommandSpec = {
  kind: 'deform.setCurve',
  // 'rigged' carries a deform timeline on the default skin's 'panel' mesh; re-easing its first keyframe
  // to stepped is a real delta (the seed authors linear keys).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const anim = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!anim) return null;
    for (const [skinKey, bySlot] of anim.deform) {
      for (const [slotId, byName] of bySlot) {
        for (const [attachmentName, frames] of byName) {
          const first = frames[0];
          if (first === undefined || first.curve === 'stepped') continue;
          return {
            command: new SetDeformCurveCommand(
              anim.id,
              skinKey,
              slotId,
              attachmentName,
              first.id,
              'stepped',
            ),
          };
        }
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (target === undefined) throw new Error('deform.setCurve fixture seed had no animations');
    const beforeAnim = findAnimationSnapshot(before, target.id);
    const afterAnim = findAnimationSnapshot(after, target.id);
    if (!beforeAnim || !afterAnim) throw new Error('deform.setCurve target missing from snapshot');
    const changed = afterAnim.deform.some((track, trackIndex) =>
      track.keyframes.some(
        (kf, kfIndex) =>
          kf.curve !== beforeAnim.deform[trackIndex]?.keyframes[kfIndex]?.curve &&
          kf.time === beforeAnim.deform[trackIndex]?.keyframes[kfIndex]?.time,
      ),
    );
    if (!changed) throw new Error('deform.setCurve produced no curve delta');
  },
};
