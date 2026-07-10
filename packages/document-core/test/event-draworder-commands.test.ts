import { describe, expect, it } from 'vitest';
import {
  DefineEventCommand,
  DeleteEventCommand,
  DeleteSlotCommand,
  DrawOrderError,
  EventEditError,
  KeyframeCollisionError,
  MoveDrawOrderKeyCommand,
  RenameEventCommand,
  SetDocumentMetadataCommand,
  SetDrawOrderKeyCommand,
  SetEventAudioCommand,
  SetEventDefaultsCommand,
  SetEventKeyCommand,
  assertInvariants,
  exportDocument,
  loadDocument,
  type Command,
  type Document,
  type EventDefId,
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

function evented(): Document {
  return loadDocument(seeds.evented, makeTestEnv().env);
}

function eventIdByName(doc: Document, name: string): EventDefId {
  const def = doc.model.eventDefs().find((d) => d.name === name);
  if (!def) throw new Error(`no event definition named "${name}"`);
  return def.id;
}

function walkId(doc: Document) {
  return doc.model.animations().find((a) => a.name === 'walk')!.id;
}

describe('event definition commands (PP-D9)', () => {
  it('rejects a duplicate name on define and on rename, before any mutation', () => {
    const doc = evented();
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(
        new DefineEventCommand(doc.ids.mint('eventDef'), 'footstep', {
          int: undefined,
          float: undefined,
          string: undefined,
          audio: undefined,
        }),
      ),
    ).toThrow(EventEditError);
    // A rejected define leaves NO document change and NO history entry.
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);

    expect(() =>
      doc.history.execute(new RenameEventCommand(eventIdByName(doc, 'landing'), 'footstep')),
    ).toThrow(EventEditError);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an out-of-range audio volume/balance on setAudio', () => {
    const doc = evented();
    const id = eventIdByName(doc, 'landing');
    expect(() =>
      doc.history.execute(new SetEventAudioCommand(id, { path: 'a.wav', volume: 2, balance: 0 })),
    ).toThrow(EventEditError);
    expect(() =>
      doc.history.execute(
        new SetEventAudioCommand(id, { path: 'a.wav', volume: 0.5, balance: -3 }),
      ),
    ).toThrow(EventEditError);
    expect(doc.model.getEventDef(id)!.audio).toBeUndefined(); // unchanged
  });

  it('rename is a single-field change with zero cascade to the animation event keys', () => {
    const doc = evented();
    const id = eventIdByName(doc, 'footstep');
    const wId = walkId(doc);
    const before = doc.model.getAnimation(wId)!.events.filter((k) => k.event === id).length;

    doc.history.execute(new RenameEventCommand(id, 'stomp'));
    expect(doc.model.getEventDef(id)!.name).toBe('stomp');
    // The event keys still reference the SAME EventDefId, so the rename does not touch them.
    const after = doc.model.getAnimation(wId)!.events.filter((k) => k.event === id).length;
    expect(after).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('delete cascades the event keys across animations and restores them on undo', () => {
    const doc = evented();
    const id = eventIdByName(doc, 'footstep');
    const wId = walkId(doc);
    const snapshotBefore = doc.model.snapshot();
    expect(doc.model.getAnimation(wId)!.events.some((k) => k.event === id)).toBe(true);

    doc.history.execute(new DeleteEventCommand(id));
    expect(doc.model.getEventDef(id)).toBeUndefined();
    // Every key that fired the deleted event is gone (no dangling reference).
    expect(doc.model.getAnimation(wId)!.events.some((k) => k.event === id)).toBe(false);
    expect(() => assertInvariants(doc.model)).not.toThrow();

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(snapshotBefore); // definition + keys restored exactly
  });
});

describe('draw-order key commands (PP-D9)', () => {
  it('rejects an inconsistent reordering before any mutation', () => {
    const doc = evented();
    const wId = walkId(doc);
    const [back, front] = doc.model.slots();
    const before = doc.model.snapshot();

    // Same slot twice in one key.
    expect(() =>
      doc.history.execute(
        new SetDrawOrderKeyCommand(wId, 0.1, [
          { slot: back!.id, offset: 1 },
          { slot: back!.id, offset: -1 },
        ]),
      ),
    ).toThrow(DrawOrderError);
    // Two slots resolving to the same target index (both -> 0): collision.
    expect(() =>
      doc.history.execute(
        new SetDrawOrderKeyCommand(wId, 0.1, [
          { slot: back!.id, offset: 0 },
          { slot: front!.id, offset: -1 },
        ]),
      ),
    ).toThrow(DrawOrderError);
    // A target index out of range (front at index 1 + offset 1 -> 2, slotCount 2).
    expect(() =>
      doc.history.execute(new SetDrawOrderKeyCommand(wId, 0.1, [{ slot: front!.id, offset: 1 }])),
    ).toThrow(DrawOrderError);

    expect(doc.model.snapshot()).toEqual(before); // nothing applied
  });

  it('rejects a move onto a time another draw-order key occupies', () => {
    const doc = evented();
    const wId = walkId(doc);
    const back = doc.model.slots()[0]!;
    // Add a second draw-order key at t=0.2, then try to move it onto the existing 0.5 key.
    doc.history.execute(new SetDrawOrderKeyCommand(wId, 0.2, [{ slot: back.id, offset: 1 }]));
    const moved = doc.model.getAnimation(wId)!.drawOrder.find((k) => k.time === 0.2)!;
    expect(() => doc.history.execute(new MoveDrawOrderKeyCommand(wId, moved.id, 0.5))).toThrow(
      KeyframeCollisionError,
    );
  });
});

describe('coalescing (PP-D9 value-drag commands)', () => {
  // A single-target session of N edits must collapse to ONE undo step whose one undo restores the
  // pre-interaction state (LAW 2 merged-sequence contract).
  const cases: ReadonlyArray<{
    kind: string;
    make: (doc: Document, i: number) => Command;
  }> = [
    {
      kind: 'event.setDefaults',
      make: (doc, i) =>
        new SetEventDefaultsCommand(eventIdByName(doc, 'footstep'), {
          int: i,
          float: undefined,
          string: undefined,
        }),
    },
    {
      kind: 'event.setAudio',
      make: (doc, i) =>
        new SetEventAudioCommand(eventIdByName(doc, 'landing'), {
          path: 'x.wav',
          volume: i / 10,
          balance: 0,
        }),
    },
    {
      kind: 'event.key.set',
      make: (doc, i) =>
        new SetEventKeyCommand(walkId(doc), eventIdByName(doc, 'footstep'), 0.4, {
          int: i,
          float: undefined,
          string: undefined,
        }),
    },
    {
      kind: 'draworder.key.set',
      make: (doc, i) =>
        new SetDrawOrderKeyCommand(walkId(doc), 0.6, [
          { slot: doc.model.slots()[0]!.id, offset: (i % 2) as 0 | 1 },
        ]),
    },
    {
      kind: 'document.setMetadata',
      make: (_doc, i) => new SetDocumentMetadataCommand({ fps: 24 + i }),
    },
  ];

  it.each(cases.map((c) => [c.kind, c] as const))(
    '%s collapses an N-edit single-target session to one undo step',
    (_kind, testCase) => {
      const doc = evented();
      const before = doc.model.snapshot();

      doc.history.beginInteraction();
      for (let i = 1; i <= 5; i += 1) doc.history.execute(testCase.make(doc, i));
      const event = doc.history.endInteraction(`Edit ${testCase.kind}`);
      expect(event?.kind).toBe(testCase.kind); // one merged command, not a composite of five

      expect(countUndoSteps(doc)).toBe(1);
      expect(doc.model.snapshot()).toEqual(before); // one undo restores the pre-interaction state
    },
  );

  it('does not coalesce setDefaults across different event definitions', () => {
    const doc = evented();
    const footstep = eventIdByName(doc, 'footstep');
    const landing = eventIdByName(doc, 'landing');
    // Two DISTINCT targets within the window must remain two undo steps.
    doc.history.execute(
      new SetEventDefaultsCommand(footstep, { int: 1, float: undefined, string: undefined }),
    );
    doc.history.execute(
      new SetEventDefaultsCommand(landing, { int: 2, float: undefined, string: undefined }),
    );
    expect(countUndoSteps(doc)).toBe(2);
  });
});

describe('document metadata (PP-D9)', () => {
  it('sets and clears the metadata block, restoring exactly on undo', () => {
    const doc = loadDocument(seeds.minimal, makeTestEnv().env);
    expect(doc.model.metadata()).toBeUndefined();

    doc.history.execute(new SetDocumentMetadataCommand({ fps: 60, imagesPath: 'img' }));
    expect(doc.model.metadata()).toEqual({ fps: 60, imagesPath: 'img' });

    doc.history.undo();
    expect(doc.model.metadata()).toBeUndefined(); // restored to the absent block
  });
});

describe('delete-slot draw-order cascade (PP-D9)', () => {
  it('prunes a deleted slot from every draw-order key and restores it on undo, staying exportable', () => {
    const doc = evented();
    const wId = walkId(doc);
    const back = doc.model.slots().find((s) => s.name === 'back')!;
    const before = doc.model.snapshot();
    // The seed keys a reorder that moves `back`; deleting `back` must not leave a dangling offset.
    expect(
      doc.model.getAnimation(wId)!.drawOrder.some((k) => k.offsets.some((o) => o.slot === back.id)),
    ).toBe(true);

    doc.history.execute(new DeleteSlotCommand(back.id));
    // The offset referencing `back` is gone; the key survives as an identity reorder (empty offsets).
    const key = doc.model.getAnimation(wId)!.drawOrder.find((k) => k.time === 0.5)!;
    expect(key.offsets).toHaveLength(0);
    expect(() => assertInvariants(doc.model)).not.toThrow();
    expect(() => exportDocument(doc.model)).not.toThrow(); // no dangling slot reference at export

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // slot + its draw-order offset restored exactly
  });
});
