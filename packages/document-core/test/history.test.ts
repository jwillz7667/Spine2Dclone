import { describe, expect, it } from 'vitest';
import {
  HISTORY_DEFAULTS,
  HistoryReentrancyError,
  MoveBoneCommand,
  RenameBoneCommand,
  loadDocument,
  type Document,
  type HistoryEvent,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function loadMinimal(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.minimal, env);
}

function rootId(doc: Document): import('../src').BoneId {
  const root = doc.model.bones()[0];
  if (!root) throw new Error('seed had no bones');
  return root.id;
}

describe('History', () => {
  it('clears the redo stack on a fresh action', () => {
    const doc = loadMinimal();
    const id = rootId(doc);
    doc.history.execute(new MoveBoneCommand(id, { x: 5, y: 5 }));
    doc.history.undo();
    expect(doc.history.canRedo).toBe(true);
    doc.history.execute(new MoveBoneCommand(id, { x: 9, y: 9 }));
    expect(doc.history.canRedo).toBe(false);
  });

  it('pushes a single command from a one-command interaction and a composite from many', () => {
    const single = loadMinimal();
    const id = rootId(single);
    single.history.beginInteraction();
    single.history.execute(new MoveBoneCommand(id, { x: 1, y: 1 }));
    const event = single.history.endInteraction('Move Bone');
    expect(event?.kind).toBe('bone.move'); // the single command, not a composite

    const { env } = makeTestEnv();
    const multi = loadDocument(seeds.rig, env);
    const bones = multi.model.bones();
    multi.history.beginInteraction();
    multi.history.execute(new MoveBoneCommand(bones[0]!.id, { x: 1, y: 1 }));
    multi.history.execute(new MoveBoneCommand(bones[1]!.id, { x: 2, y: 2 }));
    const composite = multi.history.endInteraction('Move Bones');
    expect(composite?.kind).toBe('composite');
    // One undo step for the whole gesture; undoing it reverts both bones.
    const pre = loadDocument(seeds.rig, env).model.snapshot();
    multi.history.undo();
    expect(multi.model.bones()[0]!.x).toBe(0);
    expect(multi.model.bones()[1]!.x).toBe(100); // child seed x
    expect(pre.bones.length).toBe(2);
  });

  it('returns null and no-ops on empty undo/redo', () => {
    const doc = loadMinimal();
    let fired = 0;
    doc.history.subscribe(() => {
      fired += 1;
    });
    expect(doc.history.undo()).toBeNull();
    expect(doc.history.redo()).toBeNull();
    expect(fired).toBe(0);
  });

  it('endInteraction with zero commands pushes nothing and returns null', () => {
    const doc = loadMinimal();
    doc.history.beginInteraction();
    expect(doc.history.endInteraction('Nothing')).toBeNull();
    expect(doc.history.canUndo).toBe(false);
  });

  it('bounds the past stack at maxDepth, dropping the oldest', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, { ...env, maxDepth: 3 });
    const id = doc.model.bones()[0]!.id;
    for (let i = 0; i < 8; i += 1) {
      doc.history.execute(new RenameBoneCommand(id, `name_${i}`));
    }
    expect(doc.history.maxDepth).toBe(3);
    // 8 distinct (non-coalescing) renames, capped at 3 undo steps.
    let depth = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      depth += 1;
    }
    expect(depth).toBe(3);
  });

  it('fires the commit channel exactly once per committed action, never during a session', () => {
    const doc = loadMinimal();
    const id = rootId(doc);
    const events: HistoryEvent[] = [];
    doc.history.subscribe((e) => events.push(e));

    doc.history.beginInteraction();
    doc.history.execute(new MoveBoneCommand(id, { x: 1, y: 1 }));
    doc.history.execute(new MoveBoneCommand(id, { x: 2, y: 2 }));
    expect(events).toHaveLength(0); // in-session execute does not commit
    doc.history.endInteraction('Move Bone');
    expect(events).toHaveLength(1); // one commit for the whole gesture
    expect(events[0]?.phase).toBe('execute');

    doc.history.undo();
    doc.history.redo();
    expect(events.map((e) => e.phase)).toEqual(['execute', 'undo', 'redo']);
  });

  it('throws HistoryReentrancyError when a listener mutates history during commit', () => {
    const doc = loadMinimal();
    const id = rootId(doc);
    doc.history.subscribe(() => {
      doc.history.undo();
    });
    expect(() => doc.history.execute(new MoveBoneCommand(id, { x: 1, y: 1 }))).toThrow(
      HistoryReentrancyError,
    );
  });

  it('single-sources the tunable defaults', () => {
    expect(HISTORY_DEFAULTS.maxDepth).toBe(500);
    expect(HISTORY_DEFAULTS.coalesceWindowMs).toBe(250);
    const doc = loadMinimal();
    expect(doc.history.maxDepth).toBe(HISTORY_DEFAULTS.maxDepth);
  });
});
