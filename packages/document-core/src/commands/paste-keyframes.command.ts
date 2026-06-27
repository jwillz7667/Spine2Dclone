import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CompositeCommand } from '../command/composite';
import type { KeyframeValue } from '../model/doc-state';
import type { AnimationId } from '../model/ids';
import { type KeyframeTarget } from './keyframe-support';
import { SetKeyframeCommand } from './set-keyframe.command';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// One keyframe to paste: an absolute channel target, the absolute (offset-applied) time the caller has
// already computed, and the value + curve from the clipboard. Paste creates NEW keyframes (fresh ids),
// so the clipboard holds values, not live ids.
export interface PastedKeyframe {
  readonly target: KeyframeTarget;
  readonly time: number;
  readonly value: KeyframeValue;
  readonly curve: CurveType;
}

// Paste keyframes at an offset time (command-history catalog PasteKeyframes, `kf.paste`, Composite). The
// command IS a CompositeCommand of one SetKeyframe per pasted keyframe; since SetKeyframe is insert-or-
// update, a paste that lands on an existing time updates that keyframe and the composite's reverse-order
// undo restores it, while a paste at a free time inserts and undo removes it. One undo step total. Never
// coalesces.
export class PasteKeyframesCommand implements Command {
  readonly kind = 'kf.paste';
  readonly label = 'Paste Keyframes';
  private readonly composite: CompositeCommand;

  constructor(animId: AnimationId, items: readonly PastedKeyframe[]) {
    this.composite = new CompositeCommand(
      this.label,
      items.map(
        (item) => new SetKeyframeCommand(animId, item.target, item.time, item.value, item.curve),
      ),
    );
  }

  do(ctx: CommandContext): void {
    this.composite.do(ctx);
  }

  undo(ctx: CommandContext): void {
    this.composite.undo(ctx);
  }
}

function countRotate(snapshot: ReturnType<typeof findAnimationSnapshot>): number {
  if (snapshot === undefined) return 0;
  return snapshot.bones.reduce((sum, bone) => sum + bone.rotate.length, 0);
}

export const pasteKeyframesSpec: CommandSpec = {
  kind: 'kf.paste',
  representativeSeedId: 'animated',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    for (const [boneId, set] of animation.bones) {
      if (set.rotate.length >= 2) {
        const source = set.rotate[0]!;
        const t1 = set.rotate[1]!.time;
        // Paste the first rotate key's value at a free time between the first two keys (a real insert).
        const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
        const items: PastedKeyframe[] = [
          { target, time: (source.time + t1) / 2, value: source.value, curve: source.curve },
        ];
        return { command: new PasteKeyframesCommand(animation.id, items) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('kf.paste fixture seed had no animations');
    const beforeCount = countRotate(findAnimationSnapshot(before, target.id));
    const afterCount = countRotate(findAnimationSnapshot(after, target.id));
    if (afterCount !== beforeCount + 1) {
      throw new Error('kf.paste did not insert exactly one rotate keyframe');
    }
  },
};
