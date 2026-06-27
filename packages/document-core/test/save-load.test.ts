import {
  computeContentHash,
  CURRENT_FORMAT_VERSION,
  FormatValidationError,
  verifyContentHash,
} from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { describe, expect, it } from 'vitest';
import {
  CreateBoneCommand,
  createDocument,
  exportDocument,
  loadDocument,
  newDocState,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

const GEOM = {
  length: 80,
  x: 0,
  y: 0,
  rotation: 10,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  transformMode: 'normal',
} as const;

// A rich document (slot, region attachment, atlas, animation) carrying the format's own content hash,
// so exportDocument(loadDocument(R)) must reproduce R exactly, preserved body included.
function richDocument(): SkeletonDocument {
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'rich',
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
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'body',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: {
            body: {
              type: 'region',
              path: 'body',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 64,
              height: 64,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'body',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
  return { ...draft, hash: computeContentHash(draft) };
}

describe('save / load seam', () => {
  it('round-trips a command-built document through the format projection', () => {
    const { env } = makeTestEnv();
    const doc = createDocument(newDocState('built'), env);
    const root = doc.ids.mint('bone');
    const child = doc.ids.mint('bone');
    doc.history.execute(new CreateBoneCommand(root, null, { name: 'root', ...GEOM }));
    doc.history.execute(new CreateBoneCommand(child, root, { name: 'child', ...GEOM, x: 50 }));

    const json1 = exportDocument(doc.model);
    expect(json1.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(verifyContentHash(json1)).toBe(true);
    // Only format keys are present: no camera/selection/tool (editor state never serializes).
    expect(Object.keys(json1).sort()).toEqual(
      ['atlas', 'bones', 'formatVersion', 'hash', 'name', 'skins', 'slots', 'animations'].sort(),
    );

    const reloaded = loadDocument(json1, makeTestEnv().env);
    const json2 = exportDocument(reloaded.model);
    expect(json2).toEqual(json1); // format-projection round-trip, hash included
  });

  it('preserves the non-bone body (slots, skins, attachments, atlas) across a round-trip', () => {
    const original = richDocument();
    const doc = loadDocument(original, makeTestEnv().env);
    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original);
  });

  it('rejects malformed JSON with a typed error and builds no Document', () => {
    const { env } = makeTestEnv();
    expect(() => loadDocument({ formatVersion: '0.1.0', name: 'broken' }, env)).toThrow(
      FormatValidationError,
    );
    expect(() => loadDocument(null, env)).toThrow(FormatValidationError);
  });

  it('resets history on load: a new Document has empty history regardless of a prior edit', () => {
    const { env } = makeTestEnv();
    const first = loadDocument(seeds.minimal, env);
    first.history.execute(
      new CreateBoneCommand(first.ids.mint('bone'), null, { name: 'x', ...GEOM }),
    );
    expect(first.history.canUndo).toBe(true);

    const second = loadDocument(seeds.minimal, env);
    expect(second.history.canUndo).toBe(false);
    expect(second.history.canRedo).toBe(false);
  });
});
