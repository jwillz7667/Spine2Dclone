import { describe, expect, it } from 'vitest';
import {
  SetKeyframeCommand,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
} from '../document';
import { beginValueDrag, updateValueDrag } from './value-graph-edit';
import { frameOf } from './timeline-math';
import { addAnimation, addBone, createEmptyDocument, setRotateKeys } from './seed-document';

const DURATION = 2;
const FPS = 30;

function setKeys(
  doc: Document,
  animId: AnimationId,
  target: KeyframeTarget,
  keys: readonly { time: number; value: KeyframeValue }[],
): void {
  for (const key of keys) {
    doc.history.execute(new SetKeyframeCommand(animId, target, key.time, key.value));
  }
}

function rotateKeyframe(doc: Document, animId: AnimationId, boneId: BoneId, id: KeyframeId) {
  return doc.model
    .getAnimation(animId)!
    .bones.get(boneId)!
    .rotate.find((kf) => kf.id === id)!;
}

function countCommits(doc: Document, run: () => void): number {
  let commits = 0;
  const unsubscribe = doc.history.subscribe(() => {
    commits += 1;
  });
  run();
  unsubscribe();
  return commits;
}

describe('value-graph key drag', () => {
  it('moves a key in time and value as a single coalesced undo step', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'arm');
    const animId = addAnimation(doc, 'idle', DURATION);
    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
    setRotateKeys(doc, animId, boneId, [
      { time: 0.0, value: { angle: 0 } },
      { time: 1.0, value: { angle: 10 } },
    ]);
    const keyId = doc.model.getAnimation(animId)!.bones.get(boneId)!.rotate[0]!.id;
    const before = doc.model.snapshot();

    const drag = beginValueDrag(doc.model, animId, target, { shape: 'rotate' }, keyId)!;
    expect(drag.originTime).toBe(0);
    expect(drag.originScalar).toBe(0);

    const commits = countCommits(doc, () => {
      doc.history.beginInteraction();
      // Two intermediate frames then the final delta: all coalesce into one entry.
      updateValueDrag(doc.history, doc.model, drag, 0.1, 5, true, FPS, DURATION);
      updateValueDrag(doc.history, doc.model, drag, 0.25, 12, true, FPS, DURATION);
      updateValueDrag(doc.history, doc.model, drag, 0.5, 20, true, FPS, DURATION);
      doc.history.endInteraction('Edit Value');
    });

    expect(commits).toBe(1); // the whole drag is one undo entry

    const moved = rotateKeyframe(doc, animId, boneId, keyId);
    expect(frameOf(moved.time, FPS)).toBe(15); // 0 + 0.5s snapped to 30fps
    expect(moved.value).toEqual({ angle: 20 }); // origin 0 + final delta 20

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-drag state
  });

  it('edits one vec2 component while preserving the other (drag translate X, keep Y)', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'arm');
    const animId = addAnimation(doc, 'idle', DURATION);
    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'translate' };
    setKeys(doc, animId, target, [{ time: 0.5, value: { x: 4, y: 9 } }]);
    const keyId = doc.model.getAnimation(animId)!.bones.get(boneId)!.translate[0]!.id;

    const drag = beginValueDrag(doc.model, animId, target, { shape: 'vec2', axis: 'x' }, keyId)!;
    doc.history.beginInteraction();
    updateValueDrag(doc.history, doc.model, drag, 0, 6, true, FPS, DURATION); // value-only, +6 on x
    doc.history.endInteraction('Edit Value');

    const key = doc.model.getAnimation(animId)!.bones.get(boneId)!.translate[0]!;
    expect(key.value).toEqual({ x: 10, y: 9 }); // x moved, y untouched
    expect(key.time).toBe(0.5); // no time change
  });

  it('skips a time move that collides with a static key but still writes the value', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'arm');
    const animId = addAnimation(doc, 'idle', DURATION);
    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
    setRotateKeys(doc, animId, boneId, [
      { time: 0.0, value: { angle: 0 } },
      { time: 0.2, value: { angle: 90 } }, // static neighbor the drag will land on
    ]);
    const keyId = doc.model.getAnimation(animId)!.bones.get(boneId)!.rotate[0]!.id;

    const drag = beginValueDrag(doc.model, animId, target, { shape: 'rotate' }, keyId)!;
    doc.history.beginInteraction();
    // +0.2s lands exactly on the static key at frame 6 (collision), but value +45 still applies.
    updateValueDrag(doc.history, doc.model, drag, 0.2, 45, true, FPS, DURATION);
    doc.history.endInteraction('Edit Value');

    const key = rotateKeyframe(doc, animId, boneId, keyId);
    expect(key.time).toBe(0); // move skipped, key stays at origin
    expect(key.value).toEqual({ angle: 45 }); // value written at the origin (live) time
  });

  it('returns null when the target key does not resolve', () => {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'arm');
    const animId = addAnimation(doc, 'idle', DURATION);
    const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
    // A freshly minted id belongs to no keyframe, so the drag has nothing to resolve.
    const unusedId = doc.ids.mint('keyframe');
    expect(beginValueDrag(doc.model, animId, target, { shape: 'rotate' }, unusedId)).toBeNull();
  });
});
