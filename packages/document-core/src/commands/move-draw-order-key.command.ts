import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  KeyframeCollisionError,
} from '../command/errors';
import { makeDrawOrderKey, type DrawOrderKeyEntity } from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { sortDrawOrderKeysByTime } from './draw-order-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Move a draw-order timeline key to a new time (command-history Stage F1, `draworder.key.move`; PP-D9).
// Targets the key by KeyframeId, re-sorts the timeline, and REJECTS a move onto a time another draw-order
// key already occupies with a typed KeyframeCollisionError thrown before any mutation (draw-order times are
// strictly ascending, ADR-0008 section 3). Session coalescing collapses a dopesheet drag to one undo step.
export class MoveDrawOrderKeyCommand implements Command {
  readonly kind = 'draworder.key.move';
  readonly label = 'Move Draw Order Key';
  private before: readonly DrawOrderKeyEntity[] | undefined;
  private after: readonly DrawOrderKeyEntity[] = [];

  constructor(
    private readonly animId: AnimationId,
    private readonly keyframeId: KeyframeId,
    private readonly newTime: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      const moving = animation.drawOrder.find((key) => key.id === this.keyframeId);
      if (!moving) throw new CommandTargetMissingError(this.kind, this.keyframeId);
      if (
        animation.drawOrder.some((key) => key.id !== this.keyframeId && key.time === this.newTime)
      ) {
        throw new KeyframeCollisionError(this.keyframeId, this.newTime);
      }
      this.before = animation.drawOrder;
      const moved = makeDrawOrderKey(moving.id, this.newTime, moving.offsets);
      this.after = sortDrawOrderKeysByTime(
        animation.drawOrder.map((key) => (key.id === this.keyframeId ? moved : key)),
      );
    }
    ctx.mutate.setDrawOrderTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setDrawOrderTimeline(this.animId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveDrawOrderKeyCommand &&
      prev.animId === this.animId &&
      prev.keyframeId === this.keyframeId
    ) {
      const merged = new MoveDrawOrderKeyCommand(this.animId, this.keyframeId, this.newTime);
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const moveDrawOrderKeySpec: CommandSpec = {
  kind: 'draworder.key.move',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    if (!animation) return null;
    const key = animation.drawOrder[0];
    if (!key) return null;
    // Move the only draw-order key to a free time (0.75), collides with nothing.
    return { command: new MoveDrawOrderKeyCommand(animation.id, key.id, 0.75) };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('draworder.key.move fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.drawOrder ?? [];
    const a = findAnimationSnapshot(after, target.id)?.drawOrder ?? [];
    if (a.length !== b.length) throw new Error('draworder.key.move changed the key count');
    if (a.map((k) => k.time).join(',') === b.map((k) => k.time).join(',')) {
      throw new Error('draworder.key.move produced no time delta');
    }
  },
};
