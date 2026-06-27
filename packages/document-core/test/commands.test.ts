import { describe, expect, it } from 'vitest';
import { compose, identity, multiply, type Mat2x3 } from '@marionette/runtime-core';
import type { Bone, SkeletonDocument } from '@marionette/format/types';
import {
  CommandTargetMissingError,
  CompositeCommand,
  CreateBoneCommand,
  DeleteBoneCommand,
  MoveBoneCommand,
  NormalizeBoneRotationCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  RotateBoneCommand,
  SetBoneTransformModeCommand,
  loadDocument,
  wrapDegrees,
  type BoneId,
  type Command,
  type CommandContext,
  type Document,
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

  it('DeleteBone selects the parent on execute/redo and reselects the restored bone on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env); // root + child
    const [root, child] = doc.model.bones();

    // Delete the non-root child: execute selects the parent, undo reselects the restored child.
    const exec = doc.history.execute(new DeleteBoneCommand(child!.id));
    expect(exec?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'bone', id: root!.id }],
    });
    const undo = doc.history.undo();
    expect(undo?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'bone', id: child!.id }],
    });

    // Deleting a root clears the selection on execute and reselects the restored root on undo.
    const rootDoc = loadDocument(seeds.minimal, makeTestEnv().env);
    const onlyBone = rootDoc.model.bones()[0]!;
    const execRoot = rootDoc.history.execute(new DeleteBoneCommand(onlyBone.id));
    expect(execRoot?.selectionHint).toEqual({ kind: 'clear' });
    const undoRoot = rootDoc.history.undo();
    expect(undoRoot?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'bone', id: onlyBone.id }],
    });
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

// WP-1.1: ReparentBone (world-stable + cycle-safe) and SetBoneTransformMode. The round-trip harness
// already covers do/undo/redo on the 'rig' seed; these target the behaviors a trivial seed cannot show:
// world preservation under a TRANSFORMED parent (the R1.3 risk) and cycle rejection without mutation.
function mkBone(name: string, parent: string | null, overrides: Partial<Bone> = {}): Bone {
  return {
    name,
    parent,
    length: 100,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
    ...overrides,
  };
}

// A root with a non-identity transform, then a two-link chain, so reparenting tip skips a transformed
// link and must recompute a non-trivial local to hold the world fixed.
function chainDoc(): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name: 'chain',
    hash: '',
    bones: [
      mkBone('root', null, { x: 10, y: 20, rotation: 30, scaleX: 1.25, scaleY: 0.8 }),
      mkBone('mid', 'root', { x: 50, y: 5, rotation: 15 }),
      mkBone('tip', 'mid', { x: 40, y: 0, rotation: 10, scaleX: 1.1, scaleY: 1.3 }),
    ],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: { pages: [] },
  };
}

// The world matrix of a named bone, computed by walking its parent chain (the same math the command
// uses), so the test is an independent check of world preservation.
function worldOf(doc: Document, name: string): Mat2x3 {
  const chain: Bone[] = [];
  let cursor = doc.model.findBoneByName(name);
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parent === null ? undefined : doc.model.getBone(cursor.parent);
  }
  let world = identity();
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const b = chain[i]!;
    world = multiply(world, compose(b.x, b.y, b.rotation, b.scaleX, b.scaleY, b.shearX, b.shearY));
  }
  return world;
}

describe('WP-1.1 ReparentBone and SetBoneTransformMode', () => {
  it('holds the world transform fixed when reparenting under a transformed grandparent', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(chainDoc(), env);
    const tipId = doc.model.findBoneByName('tip')!.id;
    const rootId = doc.model.findBoneByName('root')!.id;

    const worldBefore = worldOf(doc, 'tip');
    doc.history.execute(new ReparentBoneCommand(tipId, rootId));

    expect(doc.model.getBone(tipId)!.parent).toBe(rootId);
    const worldAfter = worldOf(doc, 'tip');
    // decompose is the exact inverse of compose, so the world is preserved to f64 round-off, far
    // tighter than the A.5 basis (1e-6) and translation (1e-4) tolerances the milestone requires.
    for (let i = 0; i < 6; i += 1) {
      expect(Math.abs(worldAfter[i]! - worldBefore[i]!)).toBeLessThan(1e-9);
    }
  });

  it('keeps boneOrder parent-before-child and round-trips on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(chainDoc(), env);
    const before = doc.model.snapshot();
    const tipId = doc.model.findBoneByName('tip')!.id;
    const rootId = doc.model.findBoneByName('root')!.id;

    doc.history.execute(new ReparentBoneCommand(tipId, rootId));
    // tip now sits directly under root; the order still lists each parent before its children.
    const order = doc.model.bones().map((b) => b.id);
    const indexOf = (id: BoneId): number => order.indexOf(id);
    expect(indexOf(rootId)).toBeLessThan(indexOf(tipId));

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a cycle (reparent under a descendant) with no mutation and no history entry', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(chainDoc(), env);
    const before = doc.model.snapshot();
    const rootId = doc.model.findBoneByName('root')!.id;
    const tipId = doc.model.findBoneByName('tip')!.id;

    // root under tip would create a cycle (tip is root's descendant).
    expect(() => doc.history.execute(new ReparentBoneCommand(rootId, tipId))).toThrow(
      ReparentCycleError,
    );
    expect(doc.model.snapshot()).toEqual(before); // no partial mutation
    expect(doc.history.canUndo).toBe(false); // no empty history entry
  });

  it('rejects reparenting a bone under itself', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(chainDoc(), env);
    const midId = doc.model.findBoneByName('mid')!.id;
    expect(() => doc.history.execute(new ReparentBoneCommand(midId, midId))).toThrow(
      ReparentCycleError,
    );
  });

  it('SetBoneTransformMode changes only the mode and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const id = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.execute(new SetBoneTransformModeCommand(id, 'noScale'));
    expect(doc.model.getBone(id)!.transformMode).toBe('noScale');

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
