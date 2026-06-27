import { describe, expect, it } from 'vitest';
import { compose, identity, multiply, type Mat2x3 } from '@marionette/runtime-core';
import { FormatValidationError } from '@marionette/format';
import type { Bone, SkeletonDocument } from '@marionette/format/types';
import {
  AddRegionAttachmentCommand,
  CommandTargetMissingError,
  CompositeCommand,
  CreateBoneCommand,
  CreateSlotCommand,
  DeleteBoneCommand,
  DeleteSlotCommand,
  DocumentInvariantError,
  MoveBoneCommand,
  NormalizeBoneRotationCommand,
  RemoveAttachmentCommand,
  ReorderSlotCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  RotateBoneCommand,
  SetActiveAttachmentCommand,
  SetBoneTransformModeCommand,
  SetSlotColorCommand,
  assertInvariants,
  createDocument,
  exportDocument,
  makeIdFactory,
  wrapDegrees,
  type BoneId,
  type Command,
  type CommandContext,
  type DocState,
  type Document,
  type SlotId,
  loadDocument,
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

// WP-1.2: slot + region-attachment commands. The round-trip harness already covers do/undo/redo on the
// 'slotted' seed; these target the behaviors a generic harness cannot: session coalescing of a color
// drag, draw-order reordering that survives save/load, the RemoveAttachment active-attachment clear,
// the DeleteBone slot/attachment cascade, and the fail-loud dangling-reference path.
function slotIdByName(doc: Document, name: string): SlotId {
  const slot = doc.model.slots().find((s) => s.name === name);
  if (!slot) throw new Error(`no slot named ${name}`);
  return slot.id;
}

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

// A hand-built DocState whose only slot rides a bone id that was never inserted: corrupt internal state
// the public API cannot produce, used to prove the fail-loud guards fire.
function danglingSlotState(): DocState {
  const ids = makeIdFactory();
  const rootId = ids.mint('bone');
  const ghostBone = ids.mint('bone');
  const slotId = ids.mint('slot');
  return {
    formatVersion: '0.1.0',
    name: 'dangling',
    bones: new Map([
      [
        rootId,
        {
          id: rootId,
          name: 'root',
          parent: null,
          length: 100,
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          shearX: 0,
          shearY: 0,
          transformMode: 'normal',
        },
      ],
    ]),
    boneOrder: [rootId],
    slots: new Map([
      [
        slotId,
        {
          id: slotId,
          name: 'body',
          bone: ghostBone,
          color: { r: 1, g: 1, b: 1, a: 1 },
          darkColor: null,
          attachment: null,
          blendMode: 'normal',
        },
      ],
    ]),
    slotOrder: [slotId],
    attachments: new Map(),
    animations: new Map(),
    preserved: { atlas: { pages: [] }, extraSkins: [] },
  };
}

describe('WP-1.2 slot and attachment commands', () => {
  it('SetSlotColor collapses a color-picker drag into one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const id = slotIdByName(doc, 'body');
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 6; i += 1) {
      doc.history.execute(new SetSlotColorCommand(id, { r: i / 6, g: 0, b: 0, a: 1 }));
    }
    const event = doc.history.endInteraction('Set Slot Color');
    expect(event?.kind).toBe('slot.color'); // single command (one memento), not a composite

    expect(doc.model.getSlot(id)!.color.r).toBe(1); // final value applied
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo returns to the pre-drag color
  });

  it('SetSlotColor merges within the 250ms window and splits beyond it', () => {
    const within = makeTestEnv();
    const a = loadDocument(seeds.slotted, within.env);
    const idA = slotIdByName(a, 'body');
    within.setNow(0);
    a.history.execute(new SetSlotColorCommand(idA, { r: 0.1, g: 0, b: 0, a: 1 }));
    within.setNow(100); // 100ms < 250ms
    a.history.execute(new SetSlotColorCommand(idA, { r: 0.2, g: 0, b: 0, a: 1 }));
    expect(countUndoSteps(a)).toBe(1);

    const beyond = makeTestEnv();
    const b = loadDocument(seeds.slotted, beyond.env);
    const idB = slotIdByName(b, 'body');
    beyond.setNow(0);
    b.history.execute(new SetSlotColorCommand(idB, { r: 0.1, g: 0, b: 0, a: 1 }));
    beyond.setNow(300); // 300ms > 250ms
    b.history.execute(new SetSlotColorCommand(idB, { r: 0.2, g: 0, b: 0, a: 1 }));
    expect(countUndoSteps(b)).toBe(2);
  });

  it('ReorderSlot changes the draw order, persists through save/load, and round-trips on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const before = doc.model.snapshot();
    const bodyId = slotIdByName(doc, 'body');
    expect(doc.model.slots().map((s) => s.name)).toEqual(['body', 'hand']);

    doc.history.execute(new ReorderSlotCommand(bodyId, 1)); // move body to the end
    expect(doc.model.slots().map((s) => s.name)).toEqual(['hand', 'body']);

    // The new draw order survives a format round-trip (slots[] order is the setup draw order).
    const exported = exportDocument(doc.model);
    expect(exported.slots.map((s) => s.name)).toEqual(['hand', 'body']);
    const reloaded = loadDocument(exported, makeTestEnv().env);
    expect(reloaded.model.slots().map((s) => s.name)).toEqual(['hand', 'body']);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('AddRegionAttachment then RemoveAttachment each round-trip on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const handId = slotIdByName(doc, 'hand');
    const before = doc.model.snapshot();

    doc.history.execute(
      new AddRegionAttachmentCommand(handId, {
        name: 'glove',
        path: 'skin_hand',
        x: 1,
        y: 2,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
    );
    const added = doc.model.getAttachment(handId, 'glove');
    expect(added?.kind).toBe('region');
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // add round-trips exactly

    doc.history.redo();
    doc.history.execute(new RemoveAttachmentCommand(handId, 'glove'));
    expect(doc.model.getAttachment(handId, 'glove')).toBeUndefined();
    doc.history.undo();
    expect(doc.model.getAttachment(handId, 'glove')?.kind).toBe('region'); // remove round-trips
  });

  it('RemoveAttachment clears the slot active attachment and undo restores both', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const bodyId = slotIdByName(doc, 'body');
    const before = doc.model.snapshot();
    expect(doc.model.getSlot(bodyId)!.attachment).toBe('body'); // active in setup

    doc.history.execute(new RemoveAttachmentCommand(bodyId, 'body'));
    expect(doc.model.getSlot(bodyId)!.attachment).toBeNull(); // active cleared, no dangling ref
    expect(doc.model.getAttachment(bodyId, 'body')).toBeUndefined();
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // attachment AND active restored
  });

  it('SetActiveAttachment changes the setup attachment and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const bodyId = slotIdByName(doc, 'body');
    const before = doc.model.snapshot();

    doc.history.execute(new SetActiveAttachmentCommand(bodyId, null));
    expect(doc.model.getSlot(bodyId)!.attachment).toBeNull();

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('CreateSlot selects the new slot on execute/redo and clears on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const boneId = doc.model.bones()[0]!.id;
    const slotId = doc.ids.mint('slot');

    const created = doc.history.execute(
      new CreateSlotCommand(slotId, {
        name: 'torso',
        bone: boneId,
        color: { r: 1, g: 1, b: 1, a: 1 },
        darkColor: null,
        attachment: null,
        blendMode: 'normal',
      }),
    );
    expect(created?.selectionHint).toEqual({
      kind: 'select',
      entities: [{ type: 'slot', id: slotId }],
    });
    const undone = doc.history.undo();
    expect(undone?.selectionHint).toEqual({ kind: 'clear' });
  });

  it('DeleteBone cascades the riding slots and their attachments in one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env); // root + arm; slots body (on root), hand (on arm)
    const before = doc.model.snapshot();
    const rootId = doc.model.bones().find((b) => b.name === 'root')!.id;

    expect(doc.model.slots()).toHaveLength(2);
    doc.history.execute(new DeleteBoneCommand(rootId)); // root subtree includes arm
    expect(doc.model.bones()).toHaveLength(0);
    expect(doc.model.slots()).toHaveLength(0); // both slots cascaded
    expect(doc.model.snapshot().attachments).toHaveLength(0); // the body attachment cascaded
    assertInvariants(doc.model);

    expect(countUndoSteps(doc)).toBe(1); // the whole cascade is ONE undo step
    expect(doc.model.snapshot()).toEqual(before); // bones, slots, and attachments all restored
  });

  it('DeleteSlot cascades its attachments and round-trips on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const bodyId = slotIdByName(doc, 'body');
    const before = doc.model.snapshot();

    doc.history.execute(new DeleteSlotCommand(bodyId));
    expect(doc.model.getSlot(bodyId)).toBeUndefined();
    expect(doc.model.snapshot().attachments.some((a) => a.slotId === bodyId)).toBe(false);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('fails loudly on an internal dangling slot.bone (invariant + export)', () => {
    const doc = createDocument(danglingSlotState(), makeTestEnv().env);
    expect(() => assertInvariants(doc.model)).toThrow(DocumentInvariantError);
    expect(() => exportDocument(doc.model)).toThrow(DocumentInvariantError);
  });

  it('rejects a format document with a dangling slot.bone at the load boundary', () => {
    // The validator catches the dangling reference at the boundary (SLOT_BONE_MISSING) before any
    // internal resolution runs, so load fails loudly with the format error, building no Document.
    const bad: SkeletonDocument = {
      formatVersion: '0.1.0',
      name: 'bad',
      hash: '',
      bones: [
        {
          name: 'root',
          parent: null,
          length: 100,
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          shearX: 0,
          shearY: 0,
          transformMode: 'normal',
        },
      ],
      slots: [
        {
          name: 'body',
          bone: 'ghost',
          color: { r: 1, g: 1, b: 1, a: 1 },
          attachment: null,
          blendMode: 'normal',
        },
      ],
      skins: [{ name: 'default', attachments: {} }],
      animations: {},
      atlas: { pages: [] },
    };
    expect(() => loadDocument(bad, makeTestEnv().env)).toThrow(FormatValidationError);
  });
});
