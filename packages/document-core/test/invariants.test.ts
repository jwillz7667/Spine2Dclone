import { describe, expect, it } from 'vitest';
import { DocumentInvariantError, assertInvariants } from '../src';
import { emptyPreservedContent } from '../src/model/doc-state';
import { defaultSlotSceneState } from '../src/model/slot-scene';
import type { AttachmentEntity, BoneEntity, DocState, SlotEntity } from '../src/model/doc-state';
import { makeIdFactory, type BoneId, type SlotId } from '../src/model/ids';
import { DocumentModelInternal } from '../src/model/internal';

function bone(id: BoneId, name: string, parent: BoneId | null): BoneEntity {
  return {
    id,
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
  };
}

function slot(id: SlotId, name: string, boneId: BoneId, attachment: string | null): SlotEntity {
  return {
    id,
    name,
    bone: boneId,
    color: { r: 1, g: 1, b: 1, a: 1 },
    darkColor: null,
    attachment,
    blendMode: 'normal',
  };
}

// Build a DocState with empty slot/attachment collections by default; tests override the parts they
// exercise. Keeps each test literal focused on the one invariant it violates.
function state(partial: Partial<DocState> & Pick<DocState, 'bones' | 'boneOrder'>): DocState {
  return {
    formatVersion: '0.1.0',
    name: 'test',
    slots: new Map(),
    slotOrder: [],
    attachments: new Map(),
    animations: new Map(),
    ikConstraints: new Map(),
    ikConstraintOrder: [],
    transformConstraints: new Map(),
    transformConstraintOrder: [],
    skins: new Map(),
    skinOrder: [],
    events: new Map(),
    eventOrder: [],
    metadata: undefined,
    slotScene: defaultSlotSceneState(),
    preserved: emptyPreservedContent(),
    ...partial,
  };
}

// assertInvariants is the dev/test guard the round-trip harness runs after every step. Its failure
// paths must actually fire, or it could silently rot into a no-op. These deep-import a hand-built
// (validation-bypassing) internal model to exercise each throw branch.
describe('assertInvariants failure paths', () => {
  it('throws on a dangling parent reference', () => {
    const ids = makeIdFactory();
    const childId = ids.mint('bone');
    const ghostParent = ids.mint('bone'); // never inserted
    const model = new DocumentModelInternal(
      state({
        bones: new Map([[childId, bone(childId, 'child', ghostParent)]]),
        boneOrder: [childId],
      }),
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when a child precedes its parent in boneOrder', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const childId = ids.mint('bone');
    const model = new DocumentModelInternal(
      state({
        bones: new Map([
          [rootId, bone(rootId, 'root', null)],
          [childId, bone(childId, 'child', rootId)],
        ]),
        boneOrder: [childId, rootId], // child before parent: violation
      }),
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when a slot references a missing bone', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const ghostBone = ids.mint('bone'); // never inserted
    const slotId = ids.mint('slot');
    const model = new DocumentModelInternal(
      state({
        bones: new Map([[rootId, bone(rootId, 'root', null)]]),
        boneOrder: [rootId],
        slots: new Map([[slotId, slot(slotId, 'body', ghostBone, null)]]),
        slotOrder: [slotId],
      }),
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when a slot sets an active attachment it does not define', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const slotId = ids.mint('slot');
    const model = new DocumentModelInternal(
      state({
        bones: new Map([[rootId, bone(rootId, 'root', null)]]),
        boneOrder: [rootId],
        slots: new Map([[slotId, slot(slotId, 'body', rootId, 'missing')]]),
        slotOrder: [slotId],
      }),
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when an attachment is owned by a missing slot', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const ghostSlot = ids.mint('slot'); // never inserted into slots
    const orphan: AttachmentEntity = {
      kind: 'region',
      name: 'img',
      path: 'tex',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 1,
      height: 1,
      color: { r: 1, g: 1, b: 1, a: 1 },
    };
    const model = new DocumentModelInternal(
      state({
        bones: new Map([[rootId, bone(rootId, 'root', null)]]),
        boneOrder: [rootId],
        attachments: new Map([[ghostSlot, new Map([['img', orphan]])]]),
      }),
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('passes a valid model', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const childId = ids.mint('bone');
    const slotId = ids.mint('slot');
    const model = new DocumentModelInternal(
      state({
        bones: new Map([
          [rootId, bone(rootId, 'root', null)],
          [childId, bone(childId, 'child', rootId)],
        ]),
        boneOrder: [rootId, childId],
        slots: new Map([[slotId, slot(slotId, 'body', rootId, null)]]),
        slotOrder: [slotId],
      }),
      ids,
    );
    expect(() => assertInvariants(model)).not.toThrow();
  });
});
