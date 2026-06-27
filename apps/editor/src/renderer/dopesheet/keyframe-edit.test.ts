import { describe, expect, it } from 'vitest';
import type { AnimationId, BoneId, Document } from '../document';
import {
  copySelectionToClipboard,
  moveSelectedKeyframes,
  pasteClipboardAtPlayhead,
} from './keyframe-edit';
import { frameOf } from './timeline-math';
import {
  addAnimation,
  addBone,
  createEmptyDocument,
  rotateKeyframes,
  setRotateKeys,
} from './seed-document';

const DURATION = 2;

interface Rig {
  readonly doc: Document;
  readonly animId: AnimationId;
  readonly boneId: BoneId;
}

// Three rotate keys at frames 0, 6, 12 (t = 0.0, 0.2, 0.4 at 30fps).
function rig(): Rig {
  const doc = createEmptyDocument();
  const boneId = addBone(doc, 'root');
  const animId = addAnimation(doc, 'idle', DURATION);
  setRotateKeys(doc, animId, boneId, [
    { time: 0.0, value: { angle: 0 } },
    { time: 0.2, value: { angle: 10 } },
    { time: 0.4, value: { angle: 20 } },
  ]);
  return { doc, animId, boneId };
}

function frames(doc: Document, animId: AnimationId, boneId: BoneId): number[] {
  return rotateKeyframes(doc, animId, boneId).map((kf) => frameOf(kf.time, 30));
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

describe('dopesheet keyframe editing', () => {
  it('moves all selected keyframes by the delta in a single undo step', () => {
    const { doc, animId, boneId } = rig();
    const ids = rotateKeyframes(doc, animId, boneId).map((kf) => kf.id);
    const before = doc.model.snapshot();

    const commits = countCommits(doc, () =>
      moveSelectedKeyframes(doc.history, doc.model, animId, ids, 0.5, true, 30, DURATION),
    );

    expect(commits).toBe(1); // the whole drag is one undo entry
    expect(frames(doc, animId, boneId)).toEqual([15, 21, 27]); // shifted +0.5s

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo restores all three
  });

  it('skips a move that would collide with a non-selected key and writes no history', () => {
    const { doc, animId, boneId } = rig();
    const ids = rotateKeyframes(doc, animId, boneId).map((kf) => kf.id);
    const before = doc.model.snapshot();

    // Move only the first key (frame 0) by +0.2s, which lands on the unselected key at frame 6.
    const commits = countCommits(doc, () =>
      moveSelectedKeyframes(doc.history, doc.model, animId, [ids[0]!], 0.2, true, 30, DURATION),
    );

    expect(commits).toBe(0); // the colliding move is skipped, so the empty session commits nothing
    expect(doc.history.canUndo).toBe(true); // still only the seeding history, no empty entry
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('copies keys then pastes them at the playhead as one undo step (original + playhead)', () => {
    const { doc, animId, boneId } = rig();
    const seeded = rotateKeyframes(doc, animId, boneId);
    const before = doc.model.snapshot();

    // Copy the first and last keys (frames 0 and 12); their earliest time anchors the clipboard.
    const clipboard = copySelectionToClipboard(doc.model, animId, [seeded[0]!.id, seeded[2]!.id]);
    expect(clipboard).toHaveLength(2);

    const commits = countCommits(doc, () =>
      pasteClipboardAtPlayhead(doc.history, animId, clipboard, 1.0, DURATION),
    );

    expect(commits).toBe(1);
    // originals at frames 0, 6, 12 plus pasted at 1.0s and 1.4s -> frames 30 and 42.
    expect(frames(doc, animId, boneId)).toEqual([0, 6, 12, 30, 42]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // one undo removes exactly the pasted keys
  });
});
