import { describe, expect, it } from 'vitest';
import {
  MoveBoneCommand,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetBoneShearCommand,
  SetBoneLengthCommand,
  loadDocument,
  type BoneId,
  type Command,
  type Document,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// Every Phase-0 coalescing command, with a factory that produces a distinct edit per step on a target.
const COALESCING: ReadonlyArray<{ kind: string; make: (id: BoneId, i: number) => Command }> = [
  { kind: 'bone.move', make: (id, i) => new MoveBoneCommand(id, { x: i * 3, y: i * 2 }) },
  { kind: 'bone.rotate', make: (id, i) => new RotateBoneCommand(id, i * 11) },
  {
    kind: 'bone.scale',
    make: (id, i) => new ScaleBoneCommand(id, { scaleX: 1 + i, scaleY: 1 + i * 0.5 }),
  },
  {
    kind: 'bone.shear',
    make: (id, i) => new SetBoneShearCommand(id, { shearX: i * 4, shearY: i * -3 }),
  },
  { kind: 'bone.length', make: (id, i) => new SetBoneLengthCommand(id, 30 + i * 7) },
];

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

  // Every coalescing command must collapse an N-edit single-target session to ONE memento. The proof
  // is that endInteraction returns the single command's kind, NOT 'composite': if coalesceIntoSession
  // failed to merge per target, six session entries would become a CompositeCommand of six.
  it.each(COALESCING.map((c) => [c.kind, c] as const))(
    '%s collapses an N-edit single-target session to one memento',
    (_kind, command) => {
      const { env } = makeTestEnv();
      const doc = loadDocument(seeds.minimal, env);
      const id = doc.model.bones()[0]!.id;
      const before = doc.model.snapshot();

      doc.history.beginInteraction();
      for (let i = 1; i <= 6; i += 1) doc.history.execute(command.make(id, i));
      const event = doc.history.endInteraction(`Edit ${command.kind}`);
      expect(event?.kind).toBe(command.kind); // single command, not 'composite'

      expect(countUndoSteps(doc)).toBe(1);
      expect(doc.model.snapshot()).toEqual(before);
    },
  );

  it('collapses an interleaved multi-target session to one composite undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const [a, b] = doc.model.bones();
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    // Interleaved repeated edits on two targets: A, B, A, B, A. The per-target backward merge keeps one
    // memento per distinct target (two), not one per edit (five).
    doc.history.execute(new MoveBoneCommand(a!.id, { x: 1, y: 0 }));
    doc.history.execute(new MoveBoneCommand(b!.id, { x: 2, y: 0 }));
    doc.history.execute(new MoveBoneCommand(a!.id, { x: 3, y: 0 }));
    doc.history.execute(new MoveBoneCommand(b!.id, { x: 4, y: 0 }));
    doc.history.execute(new MoveBoneCommand(a!.id, { x: 5, y: 0 }));
    const event = doc.history.endInteraction('Move Bones');
    expect(event?.kind).toBe('composite'); // two distinct targets -> composite

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo restores both targets to pre-session
  });

  it('does not window-merge a discrete edit into a just-completed gesture', () => {
    const t = makeTestEnv();
    const doc = loadDocument(seeds.minimal, t.env);
    const id = doc.model.bones()[0]!.id;

    t.setNow(0);
    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 10, y: 10 }));
    doc.history.endInteraction('Move Bone');

    t.setNow(50); // well inside the 250ms window
    doc.history.execute(new MoveBoneCommand(id, { x: 20, y: 20 }));
    // The gesture and the later discrete nudge are SEPARATE undo steps (sessions are deterministic
    // boundaries; the window must not fold a post-gesture edit back into the gesture entry).
    expect(countUndoSteps(doc)).toBe(2);
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
