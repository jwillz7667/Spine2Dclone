import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import {
  makeDrawOrderKey,
  type DrawOrderKeyEntity,
  type DrawOrderOffsetEntity,
} from '../model/doc-state';
import type { AnimationId, KeyframeId } from '../model/ids';
import { assertConsistentDrawOrder, sortDrawOrderKeysByTime } from './draw-order-support';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Insert-or-update a draw-order timeline key (command-history Stage F1, `draworder.key.set`; PP-D9). The
// offsets list (the payload) is validated as a consistent partial reordering BEFORE any mutation
// (DRAWORDER_INCOMPLETE). If a key already exists at exactly `time`, its offsets are replaced (id kept);
// otherwise a new key is minted and inserted, keeping the timeline strictly ascending in time. before/after
// are whole-timeline mementos; it COALESCES on the touched KeyframeId so repeated re-keying in one
// interaction folds to a single undo step.
export class SetDrawOrderKeyCommand implements Command {
  readonly kind = 'draworder.key.set';
  readonly label = 'Set Draw Order Key';
  private before: readonly DrawOrderKeyEntity[] | undefined;
  private after: readonly DrawOrderKeyEntity[] = [];
  private touchedId: KeyframeId | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly time: number,
    private readonly offsets: readonly DrawOrderOffsetEntity[],
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const animation = ctx.mutate.getAnimation(this.animId);
      if (!animation) throw new CommandTargetMissingError(this.kind, this.animId);
      assertConsistentDrawOrder(ctx.mutate, this.offsets);
      const keys = animation.drawOrder;
      this.before = keys;
      const existing = keys.find((key) => key.time === this.time);
      if (existing) {
        this.touchedId = existing.id;
        const updated = makeDrawOrderKey(existing.id, existing.time, this.offsets);
        this.after = sortDrawOrderKeysByTime(
          keys.map((key) => (key.id === existing.id ? updated : key)),
        );
      } else {
        const id = ctx.ids.mint('keyframe');
        this.touchedId = id;
        const inserted = makeDrawOrderKey(id, this.time, this.offsets);
        this.after = sortDrawOrderKeysByTime([...keys, inserted]);
      }
    }
    ctx.mutate.setDrawOrderTimeline(this.animId, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setDrawOrderTimeline(this.animId, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetDrawOrderKeyCommand &&
      prev.animId === this.animId &&
      prev.touchedId !== undefined &&
      prev.touchedId === this.touchedId
    ) {
      const merged = new SetDrawOrderKeyCommand(this.animId, this.time, this.offsets);
      merged.before = prev.before;
      merged.after = this.after;
      merged.touchedId = this.touchedId;
      return merged;
    }
    return null;
  }
}

export const setDrawOrderKeySpec: CommandSpec = {
  kind: 'draworder.key.set',
  representativeSeedId: 'evented',
  fixture: (model) => {
    const animation = model.animations()[0];
    const slots = model.slots();
    if (!animation || slots.length < 2) return null;
    // Insert a NEW reorder at a free time (0.25): move the second slot back one position (target index 0).
    return {
      command: new SetDrawOrderKeyCommand(animation.id, 0.25, [{ slot: slots[1]!.id, offset: -1 }]),
    };
  },
  assertApplied: (before, after) => {
    const target = before.animations[0];
    if (target === undefined) throw new Error('draworder.key.set fixture seed had no animations');
    const b = findAnimationSnapshot(before, target.id)?.drawOrder.length ?? 0;
    const a = findAnimationSnapshot(after, target.id)?.drawOrder.length ?? 0;
    if (a !== b + 1) throw new Error('draworder.key.set did not insert exactly one draw-order key');
  },
};
