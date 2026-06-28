import { describe, expect, it } from 'vitest';
import { CreateBoneCommand, MoveBoneCommand, loadDocument, type Document } from '../src';
import { makeTestEnv, seeds } from './seeds';

const GEOM = {
  length: 40,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  transformMode: 'normal',
} as const;

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// TASK-2.1.0: cancelInteraction discards an open interaction group, undoing every applied command in
// reverse so the document returns to its pre-group state, with nothing pushed to the undo stack. The
// commit path (endInteraction) of the same group is exactly one undo step (the coalesce.test.ts suite
// pins the commit case; here we add the cancel case and the commit-vs-cancel symmetry).
describe('History.cancelInteraction', () => {
  it('restores the pre-group snapshot deep-equal after N coalescing commands', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 8; i += 1) {
      doc.history.execute(new MoveBoneCommand(id, { x: i * 10, y: i * 4 }));
    }
    doc.history.cancelInteraction();

    expect(doc.model.snapshot()).toEqual(before); // every applied move undone
    expect(doc.history.canUndo).toBe(false); // a cancelled gesture is not an undo step
    expect(doc.history.canRedo).toBe(false);
  });

  it('undoes a mixed structural + transform group (create then move) on cancel', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const root = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    const created = doc.ids.mint('bone');
    doc.history.execute(new CreateBoneCommand(created, root, { name: 'temp', ...GEOM }));
    doc.history.execute(new MoveBoneCommand(created, { x: 9, y: 9 }));
    doc.history.execute(new MoveBoneCommand(root, { x: 3, y: 3 }));
    expect(doc.model.bones()).toHaveLength(2); // mid-gesture the created bone exists

    doc.history.cancelInteraction();

    expect(doc.model.snapshot()).toEqual(before); // create + both moves rolled back
    expect(doc.model.bones()).toHaveLength(1);
    expect(doc.history.canUndo).toBe(false);
  });

  it('commit (endInteraction) of the same N commands is exactly one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 8; i += 1) {
      doc.history.execute(new MoveBoneCommand(id, { x: i * 10, y: i * 4 }));
    }
    doc.history.endInteraction('Move Bone');

    expect(countUndoSteps(doc)).toBe(1); // one undo step for the whole committed gesture
    expect(doc.model.snapshot()).toEqual(before); // that one undo restores the pre-group state
  });

  it('resets the coalescing sentinel so the next discrete edit is a fresh step', () => {
    const t = makeTestEnv();
    const doc = loadDocument(seeds.minimal, t.env);
    const id = doc.model.bones()[0]!.id;

    t.setNow(0);
    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 10, y: 10 }));
    doc.history.cancelInteraction();

    t.setNow(50); // well inside the 250ms window
    doc.history.execute(new MoveBoneCommand(id, { x: 20, y: 20 }));
    // The cancelled gesture left no entry, so the later discrete edit must NOT window-merge into it: it
    // stands alone as exactly one undo step.
    expect(countUndoSteps(doc)).toBe(1);
  });

  it('is a no-op when no interaction is open and leaves later edits intact', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;

    expect(() => doc.history.cancelInteraction()).not.toThrow();

    doc.history.execute(new MoveBoneCommand(id, { x: 5, y: 5 }));
    expect(doc.history.canUndo).toBe(true);
    // A second cancel with no open session must not disturb the committed edit.
    doc.history.cancelInteraction();
    expect(doc.history.canUndo).toBe(true);
  });

  it('discards the session so a fresh begin/commit cycle works after a cancel', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const id = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 1, y: 1 }));
    doc.history.cancelInteraction();

    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 2, y: 2 }));
    doc.history.endInteraction('Move Bone');
    expect(countUndoSteps(doc)).toBe(1); // the cancelled session left nothing behind
    expect(doc.model.snapshot()).toEqual(before);
  });
});
