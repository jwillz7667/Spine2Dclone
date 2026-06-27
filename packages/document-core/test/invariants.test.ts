import { describe, expect, it } from 'vitest';
import { DocumentInvariantError, assertInvariants } from '../src';
import { emptyPreservedContent } from '../src/model/doc-state';
import { makeIdFactory, type BoneId } from '../src/model/ids';
import { DocumentModelInternal } from '../src/model/internal';
import type { BoneEntity } from '../src/model/doc-state';

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

// assertInvariants is the dev/test guard the round-trip harness runs after every step. Its failure
// paths must actually fire, or it could silently rot into a no-op. These deep-import a hand-built
// (validation-bypassing) internal model to exercise each throw branch.
describe('assertInvariants failure paths', () => {
  it('throws on a dangling parent reference', () => {
    const ids = makeIdFactory();
    const childId = ids.mint('bone');
    const ghostParent = ids.mint('bone'); // never inserted
    const model = new DocumentModelInternal(
      {
        formatVersion: '0.1.0',
        name: 'bad',
        bones: new Map([[childId, bone(childId, 'child', ghostParent)]]),
        boneOrder: [childId],
        preserved: emptyPreservedContent(),
      },
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when a child precedes its parent in boneOrder', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const childId = ids.mint('bone');
    const model = new DocumentModelInternal(
      {
        formatVersion: '0.1.0',
        name: 'bad',
        bones: new Map([
          [rootId, bone(rootId, 'root', null)],
          [childId, bone(childId, 'child', rootId)],
        ]),
        boneOrder: [childId, rootId], // child before parent: violation
        preserved: emptyPreservedContent(),
      },
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('throws when a preserved slot references a missing bone', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const model = new DocumentModelInternal(
      {
        formatVersion: '0.1.0',
        name: 'bad',
        bones: new Map([[rootId, bone(rootId, 'root', null)]]),
        boneOrder: [rootId],
        preserved: {
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
        },
      },
      ids,
    );
    expect(() => assertInvariants(model)).toThrow(DocumentInvariantError);
  });

  it('passes a valid model', () => {
    const ids = makeIdFactory();
    const rootId = ids.mint('bone');
    const childId = ids.mint('bone');
    const model = new DocumentModelInternal(
      {
        formatVersion: '0.1.0',
        name: 'ok',
        bones: new Map([
          [rootId, bone(rootId, 'root', null)],
          [childId, bone(childId, 'child', rootId)],
        ]),
        boneOrder: [rootId, childId],
        preserved: emptyPreservedContent(),
      },
      ids,
    );
    expect(() => assertInvariants(model)).not.toThrow();
  });
});
