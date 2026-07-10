import { describe, expect, it } from 'vitest';
import {
  AddPathCurveCommand,
  computePathLengthsFromFlat,
  CreatePathAttachmentCommand,
  MovePathControlPointCommand,
  PathError,
  RemovePathCurveCommand,
  SetPathClosedCommand,
  SetPathConstantSpeedCommand,
  loadDocument,
  type Document,
  type SlotId,
} from '../src';
import { makeTestEnv, pathedSeed, seeds } from './seeds';

// PP-D11 path attachment authoring: the round-trip harness proves every command's do/undo is bit-exact on
// the 'pathed' seed; this file pins the behaviors the harness does not, per the working agreement: the
// coalesced-drag MERGED sequence (one undo per gesture), the arc-length recompute on every control-point
// edit (the ADR-0011 authoring requirement), the flag/close semantics, and the typed rejections.

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// The 'pathed' seed's editable path: returns (slotId, attachmentName).
function pathTarget(doc: Document): { slotId: SlotId; name: string } {
  for (const slot of doc.model.slots()) {
    const att = doc.model.attachments(slot.id).find((a) => a.kind === 'path');
    if (att && att.kind === 'path') return { slotId: slot.id, name: att.name };
  }
  throw new Error('no path attachment in seed');
}

function currentPath(doc: Document, slotId: SlotId, name: string) {
  const att = doc.model.getAttachment(slotId, name);
  if (!att || att.kind !== 'path') throw new Error('expected a path attachment');
  return att;
}

describe('CreatePathAttachment', () => {
  it('lays down a default two-curve open path with a recomputed arc-length table', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const slot = doc.model.slots()[0]!;

    doc.history.execute(new CreatePathAttachmentCommand(slot.id, 'rail'));

    const path = currentPath(doc, slot.id, 'rail');
    expect(path.closed).toBe(false);
    expect(path.constantSpeed).toBe(true);
    expect(path.vertices).toHaveLength(14); // V = 7 control points, two open curves
    expect(path.lengths).toEqual(computePathLengthsFromFlat(path.vertices, false));

    doc.history.undo();
    expect(doc.model.getAttachment(slot.id, 'rail')).toBeUndefined();
  });
});

describe('MovePathControlPoint', () => {
  it('recomputes the arc-length table from the moved control points', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);

    // Pull an interior anchor off the x axis; the two adjacent curves get longer, so the cumulative
    // lengths must both grow (and stay the exact table for the new geometry).
    doc.history.execute(new MovePathControlPointCommand(slotId, name, 3, 90, 60));

    const path = currentPath(doc, slotId, name);
    expect(path.vertices[6]).toBe(90);
    expect(path.vertices[7]).toBe(60);
    expect(path.lengths).toEqual(computePathLengthsFromFlat(path.vertices, false));
    expect(path.lengths[0]!).toBeGreaterThan(90);
    expect(path.lengths[1]!).toBeGreaterThan(180);
  });

  it('coalesces a drag of one control point into a single undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 10; i += 1) {
      doc.history.execute(new MovePathControlPointCommand(slotId, name, 3, 90, i * 5));
    }
    const event = doc.history.endInteraction('Move Path Point');
    expect(event?.kind).toBe('path.moveControlPoint'); // one merged command, not a composite of ten

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo returns to the pre-drag geometry
  });

  it('does not coalesce moves of different control points (composite, still one undo step)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new MovePathControlPointCommand(slotId, name, 3, 90, 10));
    doc.history.execute(new MovePathControlPointCommand(slotId, name, 1, 30, 10));
    doc.history.execute(new MovePathControlPointCommand(slotId, name, 3, 90, 20));
    const event = doc.history.endInteraction('Move Path Points');
    expect(event?.kind).toBe('composite'); // two distinct points -> two mementos -> composite

    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an out-of-range control-point index and mutates nothing', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new MovePathControlPointCommand(slotId, name, 99, 0, 0)),
    ).toThrow(PathError);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('AddPathCurve / RemovePathCurve', () => {
  it('appends and drops exactly one curve, recomputing lengths each time', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);

    doc.history.execute(new AddPathCurveCommand(slotId, name));
    let path = currentPath(doc, slotId, name);
    expect(path.vertices).toHaveLength(20); // 7 -> 10 control points
    expect(path.lengths).toHaveLength(3);
    expect(path.lengths).toEqual(computePathLengthsFromFlat(path.vertices, false));

    doc.history.execute(new RemovePathCurveCommand(slotId, name));
    path = currentPath(doc, slotId, name);
    expect(path.vertices).toHaveLength(14);
    expect(path.lengths).toHaveLength(2);
  });

  it('refuses to remove the final curve of a single-curve path', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);

    doc.history.execute(new RemovePathCurveCommand(slotId, name)); // 2 -> 1 curve
    expect(() => doc.history.execute(new RemovePathCurveCommand(slotId, name))).toThrow(PathError);
  });
});

describe('SetPathClosed', () => {
  it('closing drops the trailing anchor and keeps a valid closed spline', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const before = doc.model.snapshot();

    doc.history.execute(new SetPathClosedCommand(slotId, name, true));
    const path = currentPath(doc, slotId, name);
    expect(path.closed).toBe(true);
    expect(path.vertices).toHaveLength(12); // 7 -> 6 control points (V = 3C for a closed spline)
    expect(path.lengths).toEqual(computePathLengthsFromFlat(path.vertices, true));

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // full-geometry memento restores the open spline
  });

  it('is a no-op when the flag already matches', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const before = doc.model.snapshot();

    doc.history.execute(new SetPathClosedCommand(slotId, name, false)); // already open
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('SetPathConstantSpeed', () => {
  it('flips the flag without touching the control points or the lengths table', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const { slotId, name } = pathTarget(doc);
    const beforePath = currentPath(doc, slotId, name);

    doc.history.execute(new SetPathConstantSpeedCommand(slotId, name, false));
    const path = currentPath(doc, slotId, name);
    expect(path.constantSpeed).toBe(false);
    expect(path.vertices).toEqual(beforePath.vertices);
    expect(path.lengths).toEqual(beforePath.lengths);
  });
});
