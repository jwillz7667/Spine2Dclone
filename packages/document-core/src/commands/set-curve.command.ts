import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import { makeKeyframe, type KeyframeEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { readChannel, sameTarget, writeChannel, type KeyframeTarget } from './keyframe-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Set a keyframe's outgoing interpolation curve (command-history catalog SetCurve, `kf.curve`):
// linear / stepped / bezier with control points. Targets the keyframe by KeyframeId. The curve value is
// stored AS GIVEN; clamping bezier control x into [0, 1] is the WP-1.7 curve editor's author-time job,
// and the format validator's CURVE_BEZIER_X_RANGE is the import-time backstop. Session coalescing
// collapses a bezier-handle drag to one undo step; before/after are whole-channel mementos.
export class SetCurveCommand implements Command {
  readonly kind = 'kf.curve';
  readonly label = 'Set Curve';
  private before: readonly KeyframeEntity[] | undefined;
  private after: readonly KeyframeEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly target: KeyframeTarget,
    private readonly keyframeId: KeyframeId,
    private readonly curve: CurveType,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const channel = readChannel(animation, this.target);
      const targetKf = channel.find((kf) => kf.id === this.keyframeId);
      if (!targetKf) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      this.before = channel;
      const updated = makeKeyframe(targetKf.id, targetKf.time, targetKf.value, this.curve);
      this.after = channel.map((kf) => (kf.id === this.keyframeId ? updated : kf));
    }
    writeChannel(ctx.mutate, this.animId, this.target, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    writeChannel(ctx.mutate, this.animId, this.target, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetCurveCommand &&
      prev.animId === this.animId &&
      sameTarget(prev.target, this.target) &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new SetCurveCommand(this.animId, this.target, this.keyframeId, this.curve);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

function findRotateCurve(
  snapshot: ReturnType<typeof findAnimationSnapshot>,
  keyframeId: string,
): CurveType | undefined {
  if (snapshot === undefined) return undefined;
  for (const bone of snapshot.bones) {
    const kf = bone.rotate.find((k) => k.id === keyframeId);
    if (kf) return kf.curve;
  }
  return undefined;
}

export const setCurveSpec: CommandSpec = {
  kind: 'kf.curve',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [boneId, set] of animation.bones) {
      const first = set.rotate[0];
      if (first) {
        // Flip to a curve guaranteed different from the current one, for a real delta.
        const next: CurveType = first.curve === 'stepped' ? 'linear' : 'stepped';
        const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
        return { command: new SetCurveCommand(animation.id, target, first.id, next) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const animation = before.animations[0];
    if (animation === undefined) throw new Error('kf.curve fixture seed had no animations');
    const beforeSnap = findAnimationSnapshot(before, animation.id);
    const firstId = beforeSnap?.bones.find((bone) => bone.rotate.length > 0)?.rotate[0]?.id;
    if (firstId === undefined) throw new Error('kf.curve fixture seed had no rotate keyframe');
    const b = findRotateCurve(beforeSnap, firstId);
    const a = findRotateCurve(findAnimationSnapshot(after, animation.id), firstId);
    if (JSON.stringify(a) === JSON.stringify(b))
      throw new Error('kf.curve produced no curve delta');
  },
};
