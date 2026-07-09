import { describe, expect, it } from 'vitest';
import type { AnimationEntity, AnimationId, Document, KeyframeId } from '../document';
import {
  addEventKeyAtPlayhead,
  beginSpecialDrag,
  deleteSpecialKeys,
  updateSpecialDrag,
} from './event-track-edit';
import { frameOf } from './timeline-math';
import {
  addAnimation,
  addBone,
  addSlot,
  createEmptyDocument,
  defineEvent,
  drawOrderKeys,
  eventKeys,
  setDrawOrderKey,
  setEventKeys,
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

function eventFrames(doc: Document, animId: AnimationId): number[] {
  return eventKeys(doc, animId).map((key) => frameOf(key.time, 30));
}

describe('dopesheet special-timeline editing', () => {
  it('moves selected event keys by the delta in a single undo step', () => {
    const doc = createEmptyDocument();
    addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', DURATION);
    const eventId = defineEvent(doc, 'footstep');
    setEventKeys(doc, animId, eventId, [0.2, 0.4]);
    const ids = eventKeys(doc, animId).map((key) => key.id);
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () => {
      const drag = beginSpecialDrag(anim(doc, animId), ids);
      expect(drag).not.toBeNull();
      doc.history.beginInteraction();
      updateSpecialDrag(doc.history, drag!, 0.5, true, 30, DURATION);
      doc.history.endInteraction('Move Keyframes');
    });

    expect(commits).toBe(1); // the whole drag is one undo entry
    expect(eventFrames(doc, animId)).toEqual([21, 27]); // frames 6, 12 shifted +0.5s (15f)

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores both keys
  });

  it('skips a draw-order move that would collide with a non-moving key and writes no delta', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'root');
    addSlot(doc, 'back', boneId);
    const front = addSlot(doc, 'front', boneId);
    const animId = addAnimation(doc, 'idle', DURATION);
    setDrawOrderKey(doc, animId, 0.2, front, -1);
    setDrawOrderKey(doc, animId, 0.4, front, -1);
    const keys = drawOrderKeys(doc, animId);
    const before = doc.model.snapshot();

    // Drag the key at 0.2 by +0.2s, landing on the non-moving key at 0.4 (a collision).
    const commits = countCommits(doc, () => {
      const drag = beginSpecialDrag(anim(doc, animId), [keys[0]!.id]);
      doc.history.beginInteraction();
      updateSpecialDrag(doc.history, drag!, 0.2, true, 30, DURATION);
      doc.history.endInteraction('Move Keyframes');
    });

    expect(commits).toBe(0); // the colliding move is skipped, so the empty session commits nothing
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('deletes selected event and draw-order keys in one undo step and ignores foreign ids', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'root');
    addSlot(doc, 'back', boneId);
    const front = addSlot(doc, 'front', boneId);
    const animId = addAnimation(doc, 'idle', DURATION);
    const eventId = defineEvent(doc, 'footstep');
    setEventKeys(doc, animId, eventId, [0.2]);
    setDrawOrderKey(doc, animId, 0.4, front, -1);
    const eventId0 = eventKeys(doc, animId)[0]!.id;
    const drawId0 = drawOrderKeys(doc, animId)[0]!.id;
    const foreign = 'keyframe_999' as KeyframeId;
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () => {
      const removed = deleteSpecialKeys(doc.history, anim(doc, animId), [eventId0, drawId0, foreign]);
      expect(removed).toEqual([eventId0, drawId0]);
    });

    expect(commits).toBe(1); // both deletes fold into one undo entry
    expect(eventKeys(doc, animId)).toHaveLength(0);
    expect(drawOrderKeys(doc, animId)).toHaveLength(0);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores both keys
  });

  it('issues no command when the selection holds no special key', () => {
    const doc = createEmptyDocument();
    addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', DURATION);
    const foreign = 'keyframe_999' as KeyframeId;

    const commits = countCommits(doc, () => {
      const removed = deleteSpecialKeys(doc.history, anim(doc, animId), [foreign]);
      expect(removed).toEqual([]);
    });

    expect(commits).toBe(0);
  });

  it('fires an event at the playhead as one undo step', () => {
    const doc = createEmptyDocument();
    addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', DURATION);
    const eventId = defineEvent(doc, 'footstep');
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () =>
      addEventKeyAtPlayhead(doc.history, animId, eventId, 1.0),
    );

    expect(commits).toBe(1);
    expect(eventKeys(doc, animId)).toEqual([{ id: expect.any(String), time: 1.0 }]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
