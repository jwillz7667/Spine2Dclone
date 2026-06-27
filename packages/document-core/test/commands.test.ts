import { describe, expect, it } from 'vitest';
import {
  CommandTargetMissingError,
  CompositeCommand,
  CreateBoneCommand,
  DeleteBoneCommand,
  MoveBoneCommand,
  NormalizeBoneRotationCommand,
  RotateBoneCommand,
  loadDocument,
  wrapDegrees,
  type BoneId,
  type Command,
  type CommandContext,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

const GEOM = {
  name: 'new',
  length: 50,
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  transformMode: 'normal',
} as const;

describe('Phase 0 command behaviors', () => {
  it('CreateBone selects the new bone on execute/redo and clears on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const newId = doc.ids.mint('bone');

    const created = doc.history.execute(new CreateBoneCommand(newId, null, GEOM));
    expect(created?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'bone', id: newId }],
    });

    const undone = doc.history.undo();
    expect(undone?.selectionHint).toEqual({ kind: 'clear' });

    const redone = doc.history.redo();
    expect(redone?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'bone', id: newId }],
    });
  });

  it('MoveBone and RotateBone never coalesce with each other (cross-channel guard)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;
    const move = new MoveBoneCommand(id, { x: 1, y: 1 });
    const rotate = new RotateBoneCommand(id, 10);
    expect(move.coalesceWith(rotate)).toBeNull();
    expect(rotate.coalesceWith(move)).toBeNull();
    // Same kind same target DOES coalesce.
    expect(move.coalesceWith(new MoveBoneCommand(id, { x: 2, y: 2 }))).not.toBeNull();
  });

  it('NormalizeBoneRotation wraps out-of-range rotation and round-trips through redo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rotated, env);
    const id = doc.model.bones()[0]!.id;
    expect(doc.model.getBone(id)!.rotation).toBe(270);

    doc.history.execute(new NormalizeBoneRotationCommand(id));
    expect(doc.model.getBone(id)!.rotation).toBe(wrapDegrees(270)); // -90

    doc.history.undo();
    expect(doc.model.getBone(id)!.rotation).toBe(270);

    // Redo replays the stored, already-computed result (the `after === undefined` guard ensures it is
    // computed once on first do and not recomputed here).
    doc.history.redo();
    expect(doc.model.getBone(id)!.rotation).toBe(wrapDegrees(270));
  });

  it('CompositeCommand runs children forward on do and in strict reverse on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const trace: string[] = [];
    const recorder = (name: string): Command => ({
      kind: 'test.recorder',
      label: name,
      do: (_ctx: CommandContext) => {
        trace.push(`do:${name}`);
      },
      undo: (_ctx: CommandContext) => {
        trace.push(`undo:${name}`);
      },
    });

    doc.history.execute(
      new CompositeCommand('Macro', [recorder('a'), recorder('b'), recorder('c')]),
    );
    doc.history.undo();
    expect(trace).toEqual(['do:a', 'do:b', 'do:c', 'undo:c', 'undo:b', 'undo:a']);
  });

  it('throws a typed error when a command targets a missing bone', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const missing = 'bone_does_not_exist' as unknown as BoneId;
    expect(() => doc.history.execute(new MoveBoneCommand(missing, { x: 1, y: 1 }))).toThrow(
      CommandTargetMissingError,
    );
  });

  it('DeleteBone restores the full subtree exactly on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);
    const before = doc.model.snapshot();
    const rootId = doc.model.bones()[0]!.id;

    // Delete is covered by the harness too; here assert exact subtree restore on undo.
    doc.history.execute(new DeleteBoneCommand(rootId));
    expect(doc.model.bones()).toHaveLength(0); // root + child both gone

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // exact restore, order included
  });
});
