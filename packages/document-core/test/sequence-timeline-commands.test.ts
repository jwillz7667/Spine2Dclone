import { describe, expect, it } from 'vitest';
import {
  DeleteSequenceKeyframeCommand,
  KeyframeCollisionError,
  MoveSequenceKeyframeCommand,
  SetSequenceKeyframeCommand,
  assertInvariants,
  exportDocument,
  loadDocument,
  type AnimationId,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// PP-D10 (Stage F2) slot frame-sequence timeline (ADR-0009 section 3). The 'rigged' seed's 'move' animation
// carries a 2-key sequence timeline on 'mesh_slot'. The generic round-trip harness proves do/undo/redo; these
// tests pin the set insert/update, the coalescing-on-set merged sequence, the move collision, and delete.

function rigged(): { doc: Document; animId: AnimationId; slotId: SlotId } {
  const { env } = makeTestEnv();
  const doc = loadDocument(seeds.rigged, env);
  const animation = doc.model.animations().find((a) => a.name === 'move');
  const slot = doc.model.slots().find((s) => s.name === 'mesh_slot');
  if (!animation || !slot) throw new Error('rigged seed lost its move animation / mesh_slot');
  return { doc, animId: animation.id, slotId: slot.id };
}

function seq(doc: Document, animId: AnimationId, slotId: SlotId) {
  return doc.model.getAnimation(animId)!.slots.get(slotId)!.sequence;
}

describe('SetSequenceKeyframe', () => {
  it('inserts a new key at a free time and round-trips', () => {
    const { doc, animId, slotId } = rigged();
    const before = doc.model.snapshot();
    doc.history.execute(new SetSequenceKeyframeCommand(animId, slotId, 0.5, 'pingpong', 1, 0.2));
    const keys = seq(doc, animId, slotId);
    expect(keys.length).toBe(3);
    expect(keys.find((k) => k.time === 0.5)!.mode).toBe('pingpong');
    assertInvariants(doc.model);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('updates an existing key at the same time, keeping its id', () => {
    const { doc, animId, slotId } = rigged();
    const first = seq(doc, animId, slotId)[0]!;
    doc.history.execute(new SetSequenceKeyframeCommand(animId, slotId, first.time, 'once', 3, 0.5));
    const updated = seq(doc, animId, slotId).find((k) => k.id === first.id)!;
    expect(updated.mode).toBe('once');
    expect(updated.index).toBe(3);
    expect(seq(doc, animId, slotId).length).toBe(2); // no insert
  });

  it('coalesces repeated edits of the same key into one undo step', () => {
    const { doc, animId, slotId } = rigged();
    const first = seq(doc, animId, slotId)[0]!;
    const before = doc.model.snapshot();
    doc.history.beginInteraction();
    for (let i = 1; i <= 4; i += 1) {
      doc.history.execute(
        new SetSequenceKeyframeCommand(animId, slotId, first.time, 'loop', 0, i * 0.05),
      );
    }
    const event = doc.history.endInteraction('Set Sequence Key');
    expect(event?.kind).toBe('anim.sequence.set'); // one merged command, not a composite
    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('MoveSequenceKeyframe', () => {
  it('moves a key to a free time and undo restores it', () => {
    const { doc, animId, slotId } = rigged();
    const first = seq(doc, animId, slotId)[0]!; // t=0
    const before = doc.model.snapshot();
    doc.history.execute(new MoveSequenceKeyframeCommand(animId, slotId, first.id, 0.5));
    expect(seq(doc, animId, slotId).find((k) => k.id === first.id)!.time).toBe(0.5);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a move onto an occupied time with no mutation', () => {
    const { doc, animId, slotId } = rigged();
    const first = seq(doc, animId, slotId)[0]!; // t=0; t=1 occupied
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(new MoveSequenceKeyframeCommand(animId, slotId, first.id, 1)),
    ).toThrow(KeyframeCollisionError);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('DeleteSequenceKeyframe', () => {
  it('deletes a key and undo restores it; the timeline survives export+reload', () => {
    const { doc, animId, slotId } = rigged();
    const first = seq(doc, animId, slotId)[0]!;
    const before = doc.model.snapshot();
    doc.history.execute(new DeleteSequenceKeyframeCommand(animId, slotId, first.id));
    expect(seq(doc, animId, slotId).length).toBe(1);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);

    const reloaded = loadDocument(exportDocument(doc.model), makeTestEnv().env);
    expect(reloaded.model.snapshot()).toEqual(doc.model.snapshot());
  });
});
