import { describe, expect, it } from 'vitest';
import {
  KeyframeCollisionError,
  MoveAttachmentKeyframeCommand,
  MoveIkKeyframeCommand,
  MoveTransformKeyframeCommand,
  loadDocument,
  type AnimationId,
  type Command,
  type Document,
  type IkConstraintId,
  type SlotId,
  type TransformConstraintId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// The deferred quality-wave move commands (PP-D10, scope item 8): drag an attachment / IK / transform
// keyframe to a new time. Each mirrors MoveKeyframe/MoveEventKey: KeyframeId-targeted, whole-channel
// mementos, collision-rejecting, session-coalescing. The generic round-trip harness proves do/undo/redo is
// bit-exact on every seed; these tests pin the behaviors the harness does not: collision rejection and the
// merged-sequence coalescing contract (LAW 2).

function rigged(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.rigged, env);
}

function moveAnimId(doc: Document): AnimationId {
  const animation = doc.model.animations().find((a) => a.name === 'move');
  if (!animation) throw new Error('rigged seed lost its "move" animation');
  return animation.id;
}

function ikId(doc: Document): IkConstraintId {
  const c = doc.model.ikConstraints()[0];
  if (!c) throw new Error('rigged seed lost its IK constraint');
  return c.id;
}

function transformId(doc: Document): TransformConstraintId {
  const c = doc.model.transformConstraints()[0];
  if (!c) throw new Error('rigged seed lost its transform constraint');
  return c.id;
}

function meshSlotId(doc: Document): SlotId {
  const slot = doc.model.slots().find((s) => s.name === 'mesh_slot');
  if (!slot) throw new Error('rigged seed lost its mesh_slot');
  return slot.id;
}

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

describe('move-keyframe commands (PP-D10 deferred moves)', () => {
  it('MoveIkKeyframe moves a key to a free time and undo restores it exactly', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const cId = ikId(doc);
    const frames = doc.model.getAnimation(animId)!.ik.get(cId)!;
    const first = frames[0]!; // t=0
    const before = doc.model.snapshot();

    doc.history.execute(new MoveIkKeyframeCommand(animId, cId, first.id, 0.25));
    const moved = doc.model.getAnimation(animId)!.ik.get(cId)!;
    expect(moved.find((kf) => kf.id === first.id)!.time).toBe(0.25);
    // The moved frame keeps its mix/bend payload (only time changed).
    expect(moved.find((kf) => kf.id === first.id)!.mix).toBe(first.mix);
    expect(moved.find((kf) => kf.id === first.id)!.bendPositive).toBe(first.bendPositive);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('MoveIkKeyframe rejects a move onto an occupied time with no mutation', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const cId = ikId(doc);
    const frames = doc.model.getAnimation(animId)!.ik.get(cId)!;
    const first = frames[0]!; // t=0; t=1 is occupied by the second key
    const before = doc.model.snapshot();

    expect(() => doc.history.execute(new MoveIkKeyframeCommand(animId, cId, first.id, 1))).toThrow(
      KeyframeCollisionError,
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('MoveTransformKeyframe moves a key and preserves all six mix channels', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const cId = transformId(doc);
    const frames = doc.model.getAnimation(animId)!.transform.get(cId)!;
    const first = frames[0]!;
    const before = doc.model.snapshot();

    doc.history.execute(new MoveTransformKeyframeCommand(animId, cId, first.id, 0.3));
    const moved = doc.model
      .getAnimation(animId)!
      .transform.get(cId)!
      .find((kf) => kf.id === first.id)!;
    expect(moved.time).toBe(0.3);
    expect(moved.mixRotate).toBe(first.mixRotate);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('MoveAttachmentKeyframe moves a frame and preserves its name', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const sId = meshSlotId(doc);
    const frames = doc.model.getAnimation(animId)!.slots.get(sId)!.attachment;
    const first = frames[0]!; // t=0, name 'panel'
    const before = doc.model.snapshot();

    doc.history.execute(new MoveAttachmentKeyframeCommand(animId, sId, first.id, 0.4));
    const moved = doc.model
      .getAnimation(animId)!
      .slots.get(sId)!
      .attachment.find((f) => f.id === first.id)!;
    expect(moved.time).toBe(0.4);
    expect(moved.name).toBe(first.name);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('MoveAttachmentKeyframe rejects a move onto an occupied time with no mutation', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const sId = meshSlotId(doc);
    const frames = doc.model.getAnimation(animId)!.slots.get(sId)!.attachment;
    const first = frames[0]!; // t=0; t=1 occupied
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new MoveAttachmentKeyframeCommand(animId, sId, first.id, 1)),
    ).toThrow(KeyframeCollisionError);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('move-keyframe coalescing (PP-D10 merged-sequence contract)', () => {
  const cases: ReadonlyArray<{
    kind: string;
    make: (doc: Document, i: number) => Command;
  }> = [
    {
      kind: 'ik.moveKeyframe',
      make: (doc, i) => {
        const animId = moveAnimId(doc);
        const cId = ikId(doc);
        const first = doc.model.getAnimation(animId)!.ik.get(cId)![0]!;
        return new MoveIkKeyframeCommand(animId, cId, first.id, i * 0.05);
      },
    },
    {
      kind: 'transform.moveKeyframe',
      make: (doc, i) => {
        const animId = moveAnimId(doc);
        const cId = transformId(doc);
        const first = doc.model.getAnimation(animId)!.transform.get(cId)![0]!;
        return new MoveTransformKeyframeCommand(animId, cId, first.id, i * 0.05);
      },
    },
    {
      kind: 'anim.attachment.move',
      make: (doc, i) => {
        const animId = moveAnimId(doc);
        const sId = meshSlotId(doc);
        const first = doc.model.getAnimation(animId)!.slots.get(sId)!.attachment[0]!;
        return new MoveAttachmentKeyframeCommand(animId, sId, first.id, i * 0.05);
      },
    },
  ];

  it.each(cases.map((c) => [c.kind, c] as const))(
    '%s collapses an N-move single-target session to one undo step',
    (_kind, testCase) => {
      const doc = rigged();
      const before = doc.model.snapshot();

      doc.history.beginInteraction();
      for (let i = 1; i <= 5; i += 1) doc.history.execute(testCase.make(doc, i));
      const event = doc.history.endInteraction(`Move ${testCase.kind}`);
      expect(event?.kind).toBe(testCase.kind); // one merged command, not a composite of five

      expect(countUndoSteps(doc)).toBe(1);
      expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-interaction state
    },
  );

  it('does not coalesce moves of two different IK keyframes', () => {
    const doc = rigged();
    const animId = moveAnimId(doc);
    const cId = ikId(doc);
    const frames = doc.model.getAnimation(animId)!.ik.get(cId)!;
    const [first, second] = [frames[0]!, frames[1]!];
    // Move the first to a free time, then the second to another free time: two DISTINCT targets stay two
    // undo steps even within the coalescing window.
    doc.history.execute(new MoveIkKeyframeCommand(animId, cId, first.id, 0.2));
    doc.history.execute(new MoveIkKeyframeCommand(animId, cId, second.id, 0.8));
    expect(countUndoSteps(doc)).toBe(2);
  });
});
