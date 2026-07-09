import { describe, expect, it } from 'vitest';
import {
  CreateLinkedMeshCommand,
  LinkedMeshError,
  UnlinkMeshCommand,
  assertInvariants,
  exportDocument,
  loadDocument,
  type Document,
  type LinkedMeshInit,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// PP-D10 (Stage F2) linked meshes (ADR-0009 section 2). The 'linked' seed carries a linked mesh 'panel_ref'
// on 'mesh_slot' whose parent is the real mesh 'panel'; 'slotted' carries a region attachment for the
// parent-invalid case. The generic round-trip harness proves do/undo/redo bit-exact; these tests pin the
// command-boundary validation (mirroring the format's LINKED_MESH_* codes) and the unlink bake.

function meshSlotId(doc: Document, name = 'mesh_slot'): SlotId {
  const slot = doc.model.slots().find((s) => s.name === name);
  if (!slot) throw new Error(`seed lost its ${name} slot`);
  return slot.id;
}

const baseInit: Omit<LinkedMeshInit, 'name' | 'parent'> = {
  path: 'skin_panel',
  timelines: true,
  width: 32,
  height: 32,
  color: { r: 1, g: 1, b: 1, a: 1 },
};

describe('CreateLinkedMesh', () => {
  it('adds a linked mesh referencing a mesh and round-trips', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();

    doc.history.execute(
      new CreateLinkedMeshCommand(slotId, { ...baseInit, name: 'ref2', parent: 'panel' }),
    );
    const added = doc.model.getAttachment(slotId, 'ref2');
    expect(added?.kind).toBe('linkedmesh');
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a duplicate attachment name with no mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(
        new CreateLinkedMeshCommand(slotId, { ...baseInit, name: 'panel', parent: 'panel' }),
      ),
    ).toThrow(LinkedMeshError);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a parent that does not resolve (parentMissing)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    try {
      doc.history.execute(
        new CreateLinkedMeshCommand(slotId, { ...baseInit, name: 'ref3', parent: 'ghost' }),
      );
      throw new Error('expected LinkedMeshError');
    } catch (error) {
      expect(error).toBeInstanceOf(LinkedMeshError);
      expect((error as LinkedMeshError).reason).toBe('parentMissing');
    }
  });

  it('rejects a parent that is not a mesh (parentInvalid)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env);
    const slotId = meshSlotId(doc, 'body'); // 'body' slot carries a region attachment 'body'
    try {
      doc.history.execute(
        new CreateLinkedMeshCommand(slotId, { ...baseInit, name: 'ref', parent: 'body' }),
      );
      throw new Error('expected LinkedMeshError');
    } catch (error) {
      expect((error as LinkedMeshError).reason).toBe('parentInvalid');
    }
  });
});

describe('UnlinkMesh', () => {
  it('bakes a linked mesh to a plain mesh with the root geometry, keeping its own identity', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    const parent = doc.model.getAttachment(slotId, 'panel');
    if (parent?.kind !== 'mesh') throw new Error('seed parent is not a mesh');
    const before = doc.model.snapshot();

    doc.history.execute(new UnlinkMeshCommand(slotId, 'panel_ref'));
    const baked = doc.model.getAttachment(slotId, 'panel_ref');
    expect(baked?.kind).toBe('mesh');
    if (baked?.kind === 'mesh') {
      expect(baked.uvs).toEqual(parent.uvs); // inherited geometry
      expect(baked.width).toBe(32); // its OWN size, not the parent's
      expect(baked.path).toBe('skin_panel');
    }
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // exact restore of the linked mesh
  });

  it('rejects unlinking an attachment that is not a linked mesh (notFound)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    try {
      doc.history.execute(new UnlinkMeshCommand(slotId, 'panel')); // 'panel' is a plain mesh
      throw new Error('expected LinkedMeshError');
    } catch (error) {
      expect((error as LinkedMeshError).reason).toBe('notFound');
    }
  });
});

describe('linked mesh save/load', () => {
  it('a created linked mesh survives export and reload deep-equal', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.linked, env);
    const slotId = meshSlotId(doc);
    doc.history.execute(
      new CreateLinkedMeshCommand(slotId, { ...baseInit, name: 'ref2', parent: 'panel' }),
    );
    const exported = exportDocument(doc.model);
    const reloaded = loadDocument(exported, makeTestEnv().env);
    expect(reloaded.model.snapshot()).toEqual(doc.model.snapshot());
  });
});
