import { describe, expect, it } from 'vitest';
import type { AtlasRef } from '@marionette/format/types';
import { SetAtlasRefCommand, loadDocument } from '../src';
import { makeTestEnv, seeds } from './seeds';

// WP-1.3 SetAtlasRef (atlas.set). The round-trip harness already covers do/undo/redo deep-equality on
// every seed; this focused test pins the field-level behavior: the live preserved atlas becomes the new
// value, undo restores the prior atlas exactly, redo re-applies, extraSkins are never touched, and the
// selection is preserved (an atlas import selects nothing).
const newAtlas: AtlasRef = {
  pages: [
    {
      file: 'packed.png',
      width: 512,
      height: 512,
      regions: [
        {
          name: 'hero',
          x: 2,
          y: 3,
          w: 40,
          h: 60,
          rotated: true,
          offsetX: 1,
          offsetY: 1,
          originalW: 42,
          originalH: 62,
        },
      ],
    },
  ],
};

describe('WP-1.3 SetAtlasRef command', () => {
  it('sets the preserved atlas, restores it on undo, and re-applies on redo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const before = doc.model.snapshot();
    expect(doc.model.preserved().atlas).toEqual({ pages: [] }); // minimal seeds an empty atlas

    doc.history.execute(new SetAtlasRefCommand(newAtlas));
    expect(doc.model.preserved().atlas).toEqual(newAtlas);
    const afterDo = doc.model.snapshot();

    doc.history.undo();
    expect(doc.model.preserved().atlas).toEqual({ pages: [] });
    expect(doc.model.snapshot()).toEqual(before); // prior atlas restored exactly

    doc.history.redo();
    expect(doc.model.preserved().atlas).toEqual(newAtlas);
    expect(doc.model.snapshot()).toEqual(afterDo); // redo replays the same value
  });

  it('replaces a non-empty seed atlas and leaves the rest of the document untouched, restoring it on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.slotted, env); // seeds an atlas of one page with two regions
    const before = doc.model.snapshot();
    const priorSkins = doc.model.skins();

    doc.history.execute(new SetAtlasRefCommand(newAtlas));
    expect(doc.model.preserved().atlas).toEqual(newAtlas);
    expect(doc.model.skins()).toEqual(priorSkins); // atlas-only change leaves named skins untouched

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // the prior multi-region atlas restored exactly
  });

  it('preserves the current selection across the command', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const event = doc.history.execute(new SetAtlasRefCommand(newAtlas));
    expect(event?.selectionHint).toEqual({ kind: 'preserve' });
  });
});
