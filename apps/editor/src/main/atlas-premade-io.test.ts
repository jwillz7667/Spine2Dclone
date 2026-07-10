import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng } from '@marionette/atlas-pack';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGridAtlasFromImage, importPremadeAtlasFromDescriptor } from './atlas-premade-io';

// Unit tests for the Electron-free filesystem seam of the pre-made atlas import (PP-D5). The grid path takes
// image BYTES and is exercised end to end with a real PNG built via the atlas-pack encoder; the descriptor
// path reads a descriptor plus its sibling page image from a temp directory (no Electron dialog). The dialog
// wrapper itself (atlas-premade-import.ts) is a thin path-to-delegate shim, not tested here, matching the
// spine-import precedent of testing the core rather than the Electron dialog.

// A solid-color RGBA PNG of the given size, encoded with the same pure codec the pipeline uses.
function solidPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200;
    rgba[i + 1] = 100;
    rgba[i + 2] = 50;
    rgba[i + 3] = 255;
  }
  return new Uint8Array(encodePng({ width, height, rgba }));
}

describe('importGridAtlasFromImage', () => {
  it('decodes a sheet and slices it by column/row count, returning the source image as the page', async () => {
    const data = solidPng(64, 32);
    const result = await importGridAtlasFromImage(
      { name: 'sheet.png', data },
      {
        mode: 'grid',
        columns: 2,
        rows: 1,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== 'imported') return;
    const atlas = result.data.atlas as { pages: { file: string; regions: { name: string }[] }[] };
    expect(atlas.pages).toHaveLength(1);
    expect(atlas.pages[0]?.file).toBe('sheet.png');
    expect(atlas.pages[0]?.regions.map((r) => r.name)).toEqual(['sheet_0', 'sheet_1']);
    // No repack: the returned page bytes ARE the source sheet.
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.pages[0]?.file).toBe('sheet.png');
    expect(result.data.pages[0]?.data).toBe(data);
  });

  it('slices by fixed cell size', async () => {
    const result = await importGridAtlasFromImage(
      { name: 'tiles.png', data: solidPng(96, 32) },
      {
        mode: 'cell',
        cellWidth: 32,
        cellHeight: 32,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== 'imported') return;
    const atlas = result.data.atlas as { pages: { regions: unknown[] }[] };
    expect(atlas.pages[0]?.regions).toHaveLength(3);
  });

  it('surfaces a typed decode error for non-PNG bytes', async () => {
    const result = await importGridAtlasFromImage(
      { name: 'broken.png', data: new Uint8Array([1, 2, 3, 4]) },
      { mode: 'grid', columns: 2, rows: 2 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('IPC_HANDLER_ERROR');
    expect(result.error.message).toContain('ATLAS_DECODE_FAILED');
  });

  it('surfaces the grid error when the cell does not fit the image', async () => {
    const result = await importGridAtlasFromImage(
      { name: 'small.png', data: solidPng(16, 16) },
      {
        mode: 'cell',
        cellWidth: 64,
        cellHeight: 64,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('ATLAS_GRID_INVALID');
  });
});

describe('importPremadeAtlasFromDescriptor', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'premade-atlas-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a generic region descriptor plus its sibling PNG and builds the atlas', async () => {
    await writeFile(join(dir, 'hero.png'), solidPng(64, 64));
    await writeFile(
      join(dir, 'hero.json'),
      JSON.stringify({
        regions: [
          { name: 'head', x: 0, y: 0, w: 32, h: 32 },
          { name: 'body', x: 0, y: 32, w: 32, h: 32 },
        ],
      }),
    );

    const result = await importPremadeAtlasFromDescriptor(join(dir, 'hero.json'));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== 'imported') return;
    const atlas = result.data.atlas as { pages: { file: string; regions: { name: string }[] }[] };
    expect(atlas.pages[0]?.file).toBe('hero.png');
    expect(atlas.pages[0]?.regions.map((r) => r.name)).toEqual(['head', 'body']);
    expect(result.data.pages[0]?.file).toBe('hero.png');
  });

  it('reads our own AtlasRef descriptor shape and pins the page size to the true image', async () => {
    await writeFile(join(dir, 'sheet.png'), solidPng(128, 128));
    await writeFile(
      join(dir, 'atlas.json'),
      JSON.stringify({
        pages: [
          {
            file: 'sheet.png',
            width: 999,
            height: 999,
            regions: [
              {
                name: 'r0',
                x: 0,
                y: 0,
                w: 40,
                h: 40,
                rotated: false,
                offsetX: 0,
                offsetY: 0,
                originalW: 40,
                originalH: 40,
              },
            ],
          },
        ],
      }),
    );

    const result = await importPremadeAtlasFromDescriptor(join(dir, 'atlas.json'));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== 'imported') return;
    const atlas = result.data.atlas as { pages: { width: number }[] };
    expect(atlas.pages[0]?.width).toBe(128);
  });

  it('fails with a typed code when a region overflows the true image bounds', async () => {
    await writeFile(join(dir, 'tiny.png'), solidPng(16, 16));
    await writeFile(
      join(dir, 'tiny.json'),
      JSON.stringify({ regions: [{ name: 'big', x: 0, y: 0, w: 64, h: 64 }] }),
    );

    const result = await importPremadeAtlasFromDescriptor(join(dir, 'tiny.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('ATLAS_REGION_OUT_OF_BOUNDS');
  });

  it('fails with a typed code when the sibling page image is missing', async () => {
    await writeFile(
      join(dir, 'orphan.json'),
      JSON.stringify({ regions: [{ name: 'a', x: 0, y: 0, w: 8, h: 8 }] }),
    );

    const result = await importPremadeAtlasFromDescriptor(join(dir, 'orphan.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('ATLAS_REGION_INVALID');
  });

  it('fails with a typed code for a non-JSON descriptor', async () => {
    await writeFile(join(dir, 'bad.json'), 'not json {');
    const result = await importPremadeAtlasFromDescriptor(join(dir, 'bad.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('ATLAS_DESCRIPTOR_INVALID');
  });
});
