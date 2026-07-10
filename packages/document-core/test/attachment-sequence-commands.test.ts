import { describe, expect, it } from 'vitest';
import {
  SequenceError,
  SetAttachmentSequenceCommand,
  assertInvariants,
  exportDocument,
  loadDocument,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// PP-D10 (Stage F2) attachment frame-sequence (ADR-0009 section 3). The 'linked' seed carries a plain mesh
// 'panel' on 'mesh_slot'. The generic round-trip harness proves do/undo/redo; these tests pin the set/clear
// round-trip, the setupIndex/shape validation, and an export+reload survival.

function meshSlot(doc: Document): { slotId: SlotId; name: string } {
  const slot = doc.model.slots().find((s) => s.name === 'mesh_slot');
  if (!slot) throw new Error('seed lost mesh_slot');
  const mesh = doc.model.attachments(slot.id).find((a) => a.kind === 'mesh');
  if (!mesh) throw new Error('seed lost its mesh');
  return { slotId: slot.id, name: mesh.name };
}

describe('SetAttachmentSequence', () => {
  it('sets a sequence and one undo restores the absent state', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const { slotId, name } = meshSlot(doc);
    const before = doc.model.snapshot();

    doc.history.execute(
      new SetAttachmentSequenceCommand(slotId, name, {
        count: 8,
        start: 1,
        digits: 2,
        setupIndex: 3,
      }),
    );
    const att = doc.model.getAttachment(slotId, name);
    expect(att?.kind === 'mesh' ? att.sequence?.count : undefined).toBe(8);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('clears an existing sequence (null) and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const { slotId, name } = meshSlot(doc);
    doc.history.execute(
      new SetAttachmentSequenceCommand(slotId, name, {
        count: 4,
        start: 0,
        digits: 2,
        setupIndex: 0,
      }),
    );
    const withSeq = doc.model.snapshot();

    doc.history.execute(new SetAttachmentSequenceCommand(slotId, name, null));
    const att = doc.model.getAttachment(slotId, name);
    expect(att?.kind === 'mesh' ? att.sequence : 'x').toBeUndefined();
    // A cleared attachment has no sequence key at all.
    if (att?.kind === 'mesh') expect('sequence' in att).toBe(false);

    doc.history.undo(); // undo the clear -> sequence back
    expect(doc.model.snapshot()).toEqual(withSeq);
  });

  it('rejects an out-of-range setupIndex (setupRange) with no mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const { slotId, name } = meshSlot(doc);
    const before = doc.model.snapshot();
    try {
      doc.history.execute(
        new SetAttachmentSequenceCommand(slotId, name, {
          count: 3,
          start: 0,
          digits: 1,
          setupIndex: 3,
        }),
      );
      throw new Error('expected SequenceError');
    } catch (error) {
      expect(error).toBeInstanceOf(SequenceError);
      expect((error as SequenceError).reason).toBe('setupRange');
    }
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a target that is not a region or mesh (notFound)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const { slotId } = meshSlot(doc);
    expect(() =>
      doc.history.execute(
        new SetAttachmentSequenceCommand(slotId, 'panel_ref', {
          count: 2,
          start: 0,
          digits: 1,
          setupIndex: 0,
        }),
      ),
    ).toThrow(SequenceError); // 'panel_ref' is a linked mesh, not region/mesh
  });

  it('survives export and reload deep-equal', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const { slotId, name } = meshSlot(doc);
    doc.history.execute(
      new SetAttachmentSequenceCommand(slotId, name, {
        count: 6,
        start: 2,
        digits: 3,
        setupIndex: 1,
      }),
    );
    const reloaded = loadDocument(exportDocument(doc.model), makeTestEnv().env);
    expect(reloaded.model.snapshot()).toEqual(doc.model.snapshot());
  });
});
