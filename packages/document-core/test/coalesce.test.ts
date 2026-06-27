import { describe, expect, it } from 'vitest';
import { MoveBoneCommand, loadDocument, type Document } from '../src';
import { makeTestEnv, seeds } from './seeds';

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

describe('coalescing', () => {
  it('collapses an N-move single-target session into one undo step with one memento', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 6; i += 1) {
      doc.history.execute(new MoveBoneCommand(id, { x: i * 10, y: i * 5 }));
    }
    const event = doc.history.endInteraction('Move Bone');
    // A single distinct target collapses to one command (one memento), not a composite of six.
    expect(event?.kind).toBe('bone.move');

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo returns to the pre-session state
  });

  it('keeps the ORIGINAL before-memento across a coalesced drag', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const root = doc.model.bones()[0]!;
    const id = root.id;
    const originalX = root.x;

    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 10, y: 0 }));
    doc.history.execute(new MoveBoneCommand(id, { x: 20, y: 0 }));
    doc.history.execute(new MoveBoneCommand(id, { x: 30, y: 0 }));
    doc.history.endInteraction('Move Bone');

    expect(doc.model.getBone(id)!.x).toBe(30); // final position applied
    doc.history.undo();
    expect(doc.model.getBone(id)!.x).toBe(originalX); // back to the start of the gesture, not 20
  });

  it('does not coalesce across different targets (cross-target guard)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const [a, b] = doc.model.bones();
    doc.history.execute(new MoveBoneCommand(a!.id, { x: 5, y: 5 }));
    doc.history.execute(new MoveBoneCommand(b!.id, { x: 7, y: 7 }));
    expect(countUndoSteps(doc)).toBe(2); // two distinct targets, two undo steps
  });

  it('merges same-kind same-target within the time window and not beyond it', () => {
    const within = makeTestEnv();
    const merged = loadDocument(seeds.minimal, within.env);
    const id1 = merged.model.bones()[0]!.id;
    within.setNow(0);
    merged.history.execute(new MoveBoneCommand(id1, { x: 1, y: 1 }));
    within.setNow(100); // 100ms < 250ms window
    merged.history.execute(new MoveBoneCommand(id1, { x: 2, y: 2 }));
    expect(countUndoSteps(merged)).toBe(1);

    const beyond = makeTestEnv();
    const split = loadDocument(seeds.minimal, beyond.env);
    const id2 = split.model.bones()[0]!.id;
    beyond.setNow(0);
    split.history.execute(new MoveBoneCommand(id2, { x: 1, y: 1 }));
    beyond.setNow(300); // 300ms > 250ms window
    split.history.execute(new MoveBoneCommand(id2, { x: 2, y: 2 }));
    expect(countUndoSteps(split)).toBe(2);
  });
});
