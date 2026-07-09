import { describe, expect, it } from 'vitest';
import type { AnimationEntity, AnimationId, Document, KeyframeId } from '../document';
import { collectKeyframeIds, deleteSelectedKeyframes } from './keyframe-delete';
import {
  addAnimation,
  addBone,
  addIkConstraint,
  addSlot,
  addTransformConstraint,
  createEmptyDocument,
  defineEvent,
  setAttachmentKeys,
  setColorKeys,
  setDrawOrderKey,
  setEventKeys,
  setIkKeys,
  setRotateKeys,
  setSequenceKeys,
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

// Seed one keyframe on every deletable timeline kind and return the live animation plus each key id.
function seedAllKinds(doc: Document): {
  animId: AnimationId;
  animation: AnimationEntity;
  ids: Record<string, KeyframeId>;
} {
  const bone = addBone(doc, 'root');
  const tip = addBone(doc, 'tip');
  const back = addSlot(doc, 'back', bone);
  const front = addSlot(doc, 'front', bone);
  const animId = addAnimation(doc, 'idle', DURATION);

  setRotateKeys(doc, animId, bone, [{ time: 0, value: { angle: 4 } }]);
  setColorKeys(doc, animId, back, [0.1]);
  setAttachmentKeys(doc, animId, back, [0.2]);
  setSequenceKeys(doc, animId, back, [0.15]);
  const ik = addIkConstraint(doc, 'reach', bone, tip);
  setIkKeys(doc, animId, ik, [0.3]);
  const tc = addTransformConstraint(doc, 'copy', bone, tip);
  setTransformKeys(doc, animId, tc, [0.4]);
  const eventId = defineEvent(doc, 'footstep');
  setEventKeys(doc, animId, eventId, [0.5]);
  setDrawOrderKey(doc, animId, 0.6, front, -1);

  const animation = doc.model.getAnimation(animId);
  if (animation === undefined) throw new Error('animation missing');
  const ids = {
    rotate: animation.bones.get(bone)!.rotate[0]!.id,
    color: animation.slots.get(back)!.color[0]!.id,
    attachment: animation.slots.get(back)!.attachment[0]!.id,
    sequence: animation.slots.get(back)!.sequence[0]!.id,
    ik: animation.ik.get(ik)![0]!.id,
    transform: animation.transform.get(tc)![0]!.id,
    event: animation.events[0]!.id,
    drawOrder: animation.drawOrder[0]!.id,
  };
  return { animId, animation, ids };
}

describe('dopesheet unified keyframe deletion (PP-D2)', () => {
  it('collects every keyframe id across all timeline kinds', () => {
    const doc = createEmptyDocument();
    const { animation, ids } = seedAllKinds(doc);

    const collected = collectKeyframeIds(animation);

    expect(collected.size).toBe(8);
    for (const id of Object.values(ids)) expect(collected.has(id)).toBe(true);
  });

  it('deletes a mixed selection across every timeline kind in one undo step', () => {
    const doc = createEmptyDocument();
    const { animId, animation, ids } = seedAllKinds(doc);
    const before = doc.model.snapshot();
    const foreign = 'keyframe_99999' as KeyframeId;
    const selection = [...Object.values(ids), foreign];

    const commits = countCommits(doc, () => {
      const removed = deleteSelectedKeyframes(doc.history, animation, selection);
      expect(new Set(removed)).toEqual(new Set(Object.values(ids))); // foreign id ignored
    });

    expect(commits).toBe(1); // every delete folds into a single undo entry
    expect(collectKeyframeIds(doc.model.getAnimation(animId)!).size).toBe(0);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores every key
  });

  it('issues no command when the selection holds nothing deletable', () => {
    const doc = createEmptyDocument();
    const { animation } = seedAllKinds(doc);
    const foreign = 'keyframe_99999' as KeyframeId;

    const commits = countCommits(doc, () => {
      const removed = deleteSelectedKeyframes(doc.history, animation, [foreign]);
      expect(removed).toEqual([]);
    });

    expect(commits).toBe(0);
  });
});
