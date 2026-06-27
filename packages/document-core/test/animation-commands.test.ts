import { describe, expect, it } from 'vitest';
import {
  AnimationDurationError,
  CreateAnimationCommand,
  DeleteAnimationCommand,
  DeleteBoneCommand,
  DeleteKeyframeCommand,
  DeleteSlotCommand,
  DuplicateAnimationCommand,
  KeyframeCollisionError,
  MoveKeyframeCommand,
  PasteKeyframesCommand,
  RenameAnimationCommand,
  SetAnimationDurationCommand,
  SetCurveCommand,
  SetKeyframeCommand,
  loadDocument,
  type AnimationEntity,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeEntity,
  type KeyframeTarget,
  type PastedKeyframe,
  type SlotId,
} from '../src';
import type { AnimationSnapshot } from '../src';
import { makeTestEnv, seeds } from './seeds';

function firstAnimation(doc: Document): AnimationEntity {
  const animation = doc.model.animations()[0];
  if (!animation) throw new Error('seed had no animation');
  return animation;
}

function boneIdByName(doc: Document, name: string): BoneId {
  const bone = doc.model.findBoneByName(name);
  if (!bone) throw new Error(`no bone named ${name}`);
  return bone.id;
}

function slotIdByName(doc: Document, name: string): SlotId {
  const slot = doc.model.slots().find((s) => s.name === name);
  if (!slot) throw new Error(`no slot named ${name}`);
  return slot.id;
}

function rotateOf(doc: Document, animId: AnimationId, boneId: BoneId): readonly KeyframeEntity[] {
  return doc.model.getAnimation(animId)?.bones.get(boneId)?.rotate ?? [];
}

function rotateTarget(boneId: BoneId): KeyframeTarget {
  return { kind: 'bone', boneId, channel: 'rotate' };
}

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// Drop animation/keyframe identity (the only thing that legitimately differs across a duplicate) so two
// animations compare structurally. Bone/slot ids are KEPT because a duplicate targets the same entities.
function stripIdentity(snapshot: AnimationSnapshot): unknown {
  const stripKeys = (keys: readonly { time: number; value: unknown; curve: unknown }[]) =>
    keys.map((k) => ({ time: k.time, value: k.value, curve: k.curve }));
  return {
    duration: snapshot.duration,
    bones: snapshot.bones.map((bone) => ({
      boneId: bone.boneId,
      rotate: stripKeys(bone.rotate),
      translate: stripKeys(bone.translate),
      scale: stripKeys(bone.scale),
      shear: stripKeys(bone.shear),
    })),
    slots: snapshot.slots.map((slot) => ({
      slotId: slot.slotId,
      color: stripKeys(slot.color),
      attachment: slot.attachment.map((f) => ({ time: f.time, name: f.name })),
    })),
  };
}

describe('WP-1.5 animation lifecycle commands', () => {
  it('CreateAnimation then undo round-trips and DeleteAnimation restores the whole animation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const before = doc.model.snapshot();

    const newId = doc.ids.mint('animation');
    doc.history.execute(new CreateAnimationCommand(newId, 'walk', 2));
    expect(doc.model.getAnimation(newId)?.duration).toBe(2);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);

    const target = firstAnimation(doc).id;
    doc.history.execute(new DeleteAnimationCommand(target));
    expect(doc.model.getAnimation(target)).toBeUndefined();
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // every keyframe id restored
  });

  it('RenameAnimation changes only the name and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const before = doc.model.snapshot();

    doc.history.execute(new RenameAnimationCommand(animation.id, 'idle2'));
    expect(doc.model.getAnimation(animation.id)?.name).toBe('idle2');
    expect(doc.model.getAnimation(animation.id)?.duration).toBe(animation.duration);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('SetAnimationDuration rejects a shrink below the last keyframe time with no mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const before = doc.model.snapshot();

    // The idle animation's last keyframe is at t=1.0; shrinking to 0.4 must be rejected.
    expect(() => doc.history.execute(new SetAnimationDurationCommand(animation.id, 0.4))).toThrow(
      AnimationDurationError,
    );
    expect(doc.model.snapshot()).toEqual(before); // no partial mutation
    expect(doc.history.canUndo).toBe(false); // no empty history entry

    // Growing the duration is always valid.
    doc.history.execute(new SetAnimationDurationCommand(animation.id, 2));
    expect(doc.model.getAnimation(animation.id)?.duration).toBe(2);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('WP-1.5 keyframe commands', () => {
  it('SetKeyframe inserts at a new time and UPDATES at an existing time (no duplicate)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const boneId = boneIdByName(doc, 'root');
    const target = rotateTarget(boneId);

    doc.history.execute(new SetKeyframeCommand(animation.id, target, 0.25, { angle: 5 }));
    let at025 = rotateOf(doc, animation.id, boneId).filter((k) => k.time === 0.25);
    expect(at025).toHaveLength(1);
    expect(at025[0]!.value).toEqual({ angle: 5 });

    // A second set at the SAME time updates the existing keyframe instead of inserting a duplicate.
    doc.history.execute(new SetKeyframeCommand(animation.id, target, 0.25, { angle: 9 }));
    at025 = rotateOf(doc, animation.id, boneId).filter((k) => k.time === 0.25);
    expect(at025).toHaveLength(1);
    expect(at025[0]!.value).toEqual({ angle: 9 });

    // The channel stays strictly time-sorted.
    const times = rotateOf(doc, animation.id, boneId).map((k) => k.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('MoveKeyframe keeps the channel sorted, round-trips, and rejects a collision', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const boneId = boneIdByName(doc, 'root');
    const target = rotateTarget(boneId);
    const before = doc.model.snapshot();

    const rotate = rotateOf(doc, animation.id, boneId);
    const lastKey = rotate[rotate.length - 1]!; // t=1.0
    doc.history.execute(new MoveKeyframeCommand(animation.id, target, lastKey.id, 0.75));
    const times = rotateOf(doc, animation.id, boneId).map((k) => k.time);
    expect(times).toEqual([0, 0.5, 0.75]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);

    // Moving onto an existing keyframe time (0.5) is rejected with no mutation.
    const firstKey = rotateOf(doc, animation.id, boneId)[0]!; // t=0.0
    expect(() =>
      doc.history.execute(new MoveKeyframeCommand(animation.id, target, firstKey.id, 0.5)),
    ).toThrow(KeyframeCollisionError);
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('DeleteKeyframe removes one key and undo restores it exactly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const boneId = boneIdByName(doc, 'root');
    const target = rotateTarget(boneId);
    const before = doc.model.snapshot();

    const middle = rotateOf(doc, animation.id, boneId)[1]!; // the bezier-eased key at t=0.5
    doc.history.execute(new DeleteKeyframeCommand(animation.id, target, middle.id));
    expect(rotateOf(doc, animation.id, boneId).some((k) => k.id === middle.id)).toBe(false);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('SetCurve collapses a control-point drag into one undo step (session coalescing)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const boneId = boneIdByName(doc, 'root');
    const target = rotateTarget(boneId);
    const before = doc.model.snapshot();
    const keyId = rotateOf(doc, animation.id, boneId)[0]!.id; // currently 'linear'

    doc.history.beginInteraction();
    for (let i = 1; i <= 40; i += 1) {
      doc.history.execute(
        new SetCurveCommand(animation.id, target, keyId, {
          type: 'bezier',
          cx1: i / 40,
          cy1: 0.1,
          cx2: 0.5,
          cy2: 0.9,
        }),
      );
    }
    const event = doc.history.endInteraction('Set Curve');
    expect(event?.kind).toBe('kf.curve'); // one command (one memento), not a composite of 40

    const finalCurve = rotateOf(doc, animation.id, boneId)[0]!.curve;
    expect(finalCurve).toEqual({ type: 'bezier', cx1: 1, cy1: 0.1, cx2: 0.5, cy2: 0.9 });
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('WP-1.5 composite commands', () => {
  it('PasteKeyframes inserts and overwrites, and one undo restores the originals exactly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const boneId = boneIdByName(doc, 'root');
    const target = rotateTarget(boneId);
    const before = doc.model.snapshot();

    // One paste INSERTS at a free time (0.25), the other OVERWRITES the existing key at 0.5.
    const items: PastedKeyframe[] = [
      { target, time: 0.25, value: { angle: 7 }, curve: 'linear' },
      { target, time: 0.5, value: { angle: 99 }, curve: 'stepped' },
    ];
    doc.history.execute(new PasteKeyframesCommand(animation.id, items));

    const after = rotateOf(doc, animation.id, boneId);
    expect(after.find((k) => k.time === 0.25)?.value).toEqual({ angle: 7 });
    expect(after.find((k) => k.time === 0.5)?.value).toEqual({ angle: 99 }); // overwritten

    expect(countUndoSteps(doc)).toBe(1); // one undo step for the whole paste
    expect(doc.model.snapshot()).toEqual(before); // pasted removed, overwritten restored
  });

  it('DuplicateAnimation copies every authored channel except identity and undoes in one step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const source = firstAnimation(doc);
    const before = doc.model.snapshot();

    const newId = doc.ids.mint('animation');
    doc.history.execute(new DuplicateAnimationCommand(source.id, newId, 'idle_copy'));

    const sourceSnap = doc.model.snapshot().animations.find((a) => a.id === source.id)!;
    const copySnap = doc.model.snapshot().animations.find((a) => a.id === newId)!;
    expect(copySnap.name).toBe('idle_copy');
    expect(copySnap.id).not.toBe(sourceSnap.id);
    // Structurally identical once identity (animation id/name + keyframe ids) is stripped.
    expect(stripIdentity(copySnap)).toEqual(stripIdentity(sourceSnap));

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('WP-1.5 delete cascade prunes animation tracks (TASK-1.5.7)', () => {
  it('DeleteSlot prunes its slot color track in one undo step and undo restores it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const bodyId = slotIdByName(doc, 'body');
    const before = doc.model.snapshot();
    expect(doc.model.getAnimation(animation.id)?.slots.has(bodyId)).toBe(true);

    doc.history.execute(new DeleteSlotCommand(bodyId));
    expect(doc.model.getAnimation(animation.id)?.slots.has(bodyId)).toBe(false); // track pruned

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // slot AND its color track restored
  });

  it('DeleteBone prunes the bone track AND the riding slot track in one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.animated, env);
    const animation = firstAnimation(doc);
    const rootId = boneIdByName(doc, 'root');
    const bodyId = slotIdByName(doc, 'body'); // rides 'root'
    const before = doc.model.snapshot();
    expect(doc.model.getAnimation(animation.id)?.bones.has(rootId)).toBe(true);
    expect(doc.model.getAnimation(animation.id)?.slots.has(bodyId)).toBe(true);

    doc.history.execute(new DeleteBoneCommand(rootId));
    const animAfter = doc.model.getAnimation(animation.id);
    expect(animAfter?.bones.size).toBe(0); // root's transform track pruned
    expect(animAfter?.slots.size).toBe(0); // the riding slot's color track pruned

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // bone, slot, and BOTH tracks restored
  });
});
