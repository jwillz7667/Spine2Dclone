import { describe, expect, it } from 'vitest';
import type { AnimationEntity, AnimationId, Document, KeyframeId } from '../document';
import { beginTimelineDrag, updateTimelineDrag } from './timeline-move';
import {
  addAnimation,
  addBone,
  addIkConstraint,
  addSlot,
  addTransformConstraint,
  createEmptyDocument,
  rotateKeyframes,
  setAttachmentKeys,
  setIkKeys,
  setRotateKeys,
  setTransformKeys,
} from './seed-document';

const DURATION = 2;

function countCommits(doc: Document, run: () => void): number {
  let commits = 0;
  const unsubscribe = doc.history.subscribe(() => {
    commits += 1;
  });
  run();
  unsubscribe();
  return commits;
}

function anim(doc: Document, animId: AnimationId): AnimationEntity {
  const animation = doc.model.getAnimation(animId);
  if (animation === undefined) throw new Error('animation missing');
  return animation;
}

function attachmentTimes(doc: Document, animId: AnimationId): number[] {
  const set = [...anim(doc, animId).slots.values()][0];
  return set ? set.attachment.map((f) => f.time) : [];
}

function ikTimes(doc: Document, animId: AnimationId): number[] {
  const keys = [...anim(doc, animId).ik.values()][0];
  return keys ? keys.map((k) => k.time) : [];
}

function transformTimes(doc: Document, animId: AnimationId): number[] {
  const keys = [...anim(doc, animId).transform.values()][0];
  return keys ? keys.map((k) => k.time) : [];
}

describe('dopesheet timeline-row drag (PP-D10)', () => {
  it('drags an IK-mix key by the delta in a single undo step', () => {
    const doc = createEmptyDocument();
    const root = addBone(doc, 'root');
    const target = addBone(doc, 'target');
    const animId = addAnimation(doc, 'idle', DURATION);
    const ikId = addIkConstraint(doc, 'leg', root, target);
    setIkKeys(doc, animId, ikId, [0.2, 0.8]);
    const first = [...anim(doc, animId).ik.values()][0]![0]!;
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () => {
      const drag = beginTimelineDrag(anim(doc, animId), [first.id]);
      expect(drag).not.toBeNull();
      doc.history.beginInteraction();
      updateTimelineDrag(doc.history, drag!, 0.3, false, 30, DURATION);
      doc.history.endInteraction('Move Keyframes');
    });

    expect(commits).toBe(1); // the whole drag is one undo entry
    expect(ikTimes(doc, animId)).toEqual([0.5, 0.8]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('drags a transform-mix key and undoes in one step', () => {
    const doc = createEmptyDocument();
    const root = addBone(doc, 'root');
    const target = addBone(doc, 'target');
    const animId = addAnimation(doc, 'idle', DURATION);
    const tcId = addTransformConstraint(doc, 'follow', root, target);
    setTransformKeys(doc, animId, tcId, [0.2, 0.8]);
    const first = [...anim(doc, animId).transform.values()][0]![0]!;
    const before = doc.model.snapshot();

    updateThroughSession(doc, animId, [first.id], 0.3);
    expect(transformTimes(doc, animId)).toEqual([0.5, 0.8]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('drags an attachment-swap frame and undoes in one step', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'root');
    const slotId = addSlot(doc, 'body', boneId);
    const animId = addAnimation(doc, 'idle', DURATION);
    setAttachmentKeys(doc, animId, slotId, [0.2, 0.8]);
    const first = [...anim(doc, animId).slots.values()][0]!.attachment[0]!;
    const before = doc.model.snapshot();

    updateThroughSession(doc, animId, [first.id], 0.3);
    expect(attachmentTimes(doc, animId)).toEqual([0.5, 0.8]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('skips a move that would collide with a non-moving key and writes no delta', () => {
    const doc = createEmptyDocument();
    const root = addBone(doc, 'root');
    const target = addBone(doc, 'target');
    const animId = addAnimation(doc, 'idle', DURATION);
    const ikId = addIkConstraint(doc, 'leg', root, target);
    setIkKeys(doc, animId, ikId, [0.2, 0.4]);
    const first = [...anim(doc, animId).ik.values()][0]![0]!;
    const before = doc.model.snapshot();

    // Drag the key at 0.2 by +0.2s onto the non-moving key at 0.4 (a collision): the move is skipped.
    const commits = countCommits(doc, () => {
      const drag = beginTimelineDrag(anim(doc, animId), [first.id]);
      doc.history.beginInteraction();
      updateTimelineDrag(doc.history, drag!, 0.2, false, 30, DURATION);
      doc.history.endInteraction('Move Keyframes');
    });

    expect(commits).toBe(0); // the colliding move commits nothing
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('returns null when the selection holds only a value-channel (bone rotate) key', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', DURATION);
    setRotateKeys(doc, animId, boneId, [
      { time: 0.2, value: { angle: 0 } },
      { time: 0.8, value: { angle: 10 } },
    ]);
    const rotateId = rotateKeyframes(doc, animId, boneId)[0]!.id;
    // A bone rotate key is a value channel (keyframe-edit.ts), not an attachment/IK/transform timeline key.
    expect(beginTimelineDrag(anim(doc, animId), [rotateId])).toBeNull();
  });
});

// Run a whole drag inside one interaction session (the panel's begin/apply/end wrapping).
function updateThroughSession(
  doc: Document,
  animId: AnimationId,
  ids: readonly KeyframeId[],
  delta: number,
): void {
  const drag = beginTimelineDrag(anim(doc, animId), ids);
  expect(drag).not.toBeNull();
  doc.history.beginInteraction();
  updateTimelineDrag(doc.history, drag!, delta, false, 30, DURATION);
  doc.history.endInteraction('Move Keyframes');
}
