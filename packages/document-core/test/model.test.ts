import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import { MoveBoneCommand, loadDocument } from '../src';
import { makeTestEnv, seeds } from './seeds';

describe('DocumentModel read surface', () => {
  it('hands out frozen copies, so a caller cannot mutate the model through a read accessor', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const before = doc.model.snapshot();

    const bone = doc.model.bones()[0]!;
    expect(Object.isFrozen(bone)).toBe(true);
    // A frozen copy: attempting to write throws in strict mode and never reaches the model.
    expect(() => {
      (bone as { x: number }).x = 999;
    }).toThrow();

    expect(doc.model.snapshot()).toEqual(before);
  });

  it('produces deterministic, deep-equal snapshots for two loads of the same seed', () => {
    const a = loadDocument(seeds.rig, makeTestEnv().env);
    const b = loadDocument(seeds.rig, makeTestEnv().env);
    // Fresh per-load id factories mint the same deterministic ids, so the projections are equal.
    expect(a.model.snapshot()).toEqual(b.model.snapshot());
  });

  it('bumps revision on each applied mutation and leaves it unchanged by reads', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;

    const r0 = doc.model.revision;
    doc.model.bones();
    doc.model.snapshot();
    expect(doc.model.revision).toBe(r0); // pure reads do not bump

    doc.history.execute(new MoveBoneCommand(id, { x: 1, y: 1 }));
    expect(doc.model.revision).toBeGreaterThan(r0);
  });

  it('retains bounded heap across a long batch drag (no per-move clone is retained)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error('the batch allocation probe requires the worker to run with --expose-gc');
    }

    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const id = doc.model.bones()[0]!.id;

    // Warm up the JIT, then measure a long single-target drag (batch mode, one memento).
    doc.history.beginInteraction();
    for (let i = 0; i < 2000; i += 1) doc.history.execute(new MoveBoneCommand(id, { x: i, y: i }));
    doc.history.endInteraction('Move Bone');

    runGc();
    const before = memoryUsage().heapUsed;
    const drag = loadDocument(seeds.rig, makeTestEnv().env);
    const dragId = drag.model.bones()[0]!.id;
    drag.history.beginInteraction();
    for (let i = 0; i < 20_000; i += 1) {
      drag.history.execute(new MoveBoneCommand(dragId, { x: i, y: i }));
    }
    drag.history.endInteraction('Move Bone');
    runGc();
    const growth = memoryUsage().heapUsed - before;

    // The whole 20k-move drag collapses to one memento and one copy-on-write boundary, so retained
    // growth is a small constant, not 20k cloned maps. A per-move clone would add many megabytes.
    expect(growth).toBeLessThan(2 * 1024 * 1024);
    // And the drag still produced exactly one undo step.
    let steps = 0;
    while (drag.history.canUndo) {
      drag.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
  });
});
