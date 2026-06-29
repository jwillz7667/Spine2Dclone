import type { CurveType } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandTargetMissingError, CommandNotAppliedError, DeformError } from '../command/errors';
import {
  makeDeformKeyframe,
  type DeformKeyframeEntity,
  type DeformSkinKey,
} from '../model/doc-state';
import type { AnimationId, KeyframeId, SlotId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// The insert-or-update deform keyframe command (command-history catalog SetDeformKeyframe,
// `deform.setKeyframe`; WP-2.9). If a keyframe already exists at `time` on the (skin, slot, attachment)
// deform channel, its OFFSETS are updated (its KeyframeId, time, and curve are kept); otherwise a new
// keyframe is minted and inserted, keeping the channel strictly time-sorted (on insert it takes
// `insertCurve`, default 'linear'). The offsets are validated against the target mesh: the skin-resolved
// attachment must be a mesh and offsets.length must equal mesh.uvs.length (one (dx, dy) per LOGICAL vertex),
// else a typed DeformError is thrown BEFORE any mutation.
//
// Coalescing is keyed on the TOUCHED keyframe (animation + skin + slot + attachment + KeyframeId): a vertex
// drag that re-sets the same keyframe collapses to one undo step, while a fresh insert at a new time mints a
// new KeyframeId and is its own step. before/after are whole-channel mementos, so undo is bit-exact and a
// coalesced sequence keeps the ORIGINAL pre-interaction channel.
export class SetDeformKeyframeCommand implements Command {
  readonly kind = 'deform.setKeyframe';
  readonly label = 'Set Deform Keyframe';
  private before: readonly DeformKeyframeEntity[] | undefined;
  private after: readonly DeformKeyframeEntity[] = [];
  private touchedId: KeyframeId | undefined;

  constructor(
    private readonly animId: AnimationId,
    private readonly skinKey: DeformSkinKey,
    private readonly slotId: SlotId,
    private readonly attachmentName: string,
    private readonly time: number,
    private readonly offsets: readonly number[],
    private readonly insertCurve: CurveType = 'linear',
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const anim = ctx.mutate.getAnimation(this.animId);
      if (!anim) throw new CommandTargetMissingError(this.kind, this.animId);
      // Resolve the target mesh: the default skin's attachment for 'default', else the named skin's.
      const mesh =
        this.skinKey === 'default'
          ? ctx.mutate.getAttachment(this.slotId, this.attachmentName)
          : ctx.mutate
              .getSkin(this.skinKey)
              ?.attachments.get(this.slotId)
              ?.get(this.attachmentName);
      if (!mesh || mesh.kind !== 'mesh') {
        throw new DeformError('notMesh', `${this.slotId}/${this.attachmentName}`);
      }
      if (this.offsets.length !== mesh.uvs.length) {
        throw new DeformError(
          'offsetLength',
          `expected ${mesh.uvs.length}, got ${this.offsets.length}`,
        );
      }
      const channel =
        anim.deform.get(this.skinKey)?.get(this.slotId)?.get(this.attachmentName) ?? [];
      this.before = channel;
      const existing = channel.find((kf) => kf.time === this.time);
      if (existing) {
        this.touchedId = existing.id;
        const updated = makeDeformKeyframe(
          existing.id,
          existing.time,
          this.offsets,
          existing.curve,
        );
        this.after = channel.map((kf) => (kf.id === existing.id ? updated : kf));
      } else {
        const id = ctx.ids.mint('keyframe');
        this.touchedId = id;
        const inserted = makeDeformKeyframe(id, this.time, this.offsets, this.insertCurve);
        this.after = [...channel, inserted].sort((a, b) => a.time - b.time);
      }
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

  // Same animation + skin + slot + attachment + touched keyframe only. The merged command keeps the ORIGINAL
  // before (drag start) and the latest after, so one undo of a coalesced vertex drag returns to the
  // pre-interaction channel (command-history Section 5.3).
  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetDeformKeyframeCommand &&
      prev.animId === this.animId &&
      prev.skinKey === this.skinKey &&
      prev.slotId === this.slotId &&
      prev.attachmentName === this.attachmentName &&
      prev.touchedId !== undefined &&
      prev.touchedId === this.touchedId
    ) {
      const merged = new SetDeformKeyframeCommand(
        this.animId,
        this.skinKey,
        this.slotId,
        this.attachmentName,
        this.time,
        this.offsets,
        this.insertCurve,
      );
      merged.before = prev.before;
      merged.after = this.after;
      merged.touchedId = this.touchedId;
      return merged;
    }
    return null;
  }
}

// Count the deform keyframes on every (skin, slot, attachment) track of an animation snapshot.
function countDeform(snapshot: ReturnType<typeof findAnimationSnapshot>): number {
  if (snapshot === undefined) return 0;
  return snapshot.deform.reduce((sum, track) => sum + track.keyframes.length, 0);
}

export const setDeformKeyframeSpec: CommandSpec = {
  kind: 'deform.setKeyframe',
  // 'rigged' carries a deform timeline on the default skin's 'panel' mesh with two keyframes; inserting at
  // their midpoint is a free time with offsets matching the mesh vertex count, a real delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const anim = model.animations().find((a) => a.name === 'move') ?? model.animations()[0];
    if (!anim) return null;
    for (const [skinKey, bySlot] of anim.deform) {
      for (const [slotId, byName] of bySlot) {
        for (const [attachmentName, frames] of byName) {
          if (frames.length < 2) continue;
          const t = (frames[0]!.time + frames[1]!.time) / 2;
          const offsets = new Array<number>(frames[0]!.offsets.length).fill(1);
          return {
            command: new SetDeformKeyframeCommand(
              anim.id,
              skinKey,
              slotId,
              attachmentName,
              t,
              offsets,
            ),
          };
        }
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    const target = before.animations.find((a) => a.name === 'move') ?? before.animations[0];
    if (target === undefined) throw new Error('deform.setKeyframe fixture seed had no animations');
    const beforeCount = countDeform(findAnimationSnapshot(before, target.id));
    const afterCount = countDeform(findAnimationSnapshot(after, target.id));
    if (afterCount !== beforeCount + 1) {
      throw new Error('deform.setKeyframe did not insert exactly one deform keyframe');
    }
  },
};
