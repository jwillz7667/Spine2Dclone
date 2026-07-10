import { describe, expect, it } from 'vitest';
import {
  buildGridAtlas,
  buildSinglePageAtlas,
  classifyDescriptor,
  validateAtlasRefPages,
  type GenericRegionInput,
} from './atlas-premade';

// Unit tests for the PURE pre-made atlas builder (PP-D5). No filesystem, no Electron: descriptor parsing,
// region-to-AtlasRef assembly, grid slicing, and the typed diagnostics are all exercised headless. Each
// negative case asserts the EXACT typed error code (LAW 3).

describe('classifyDescriptor', () => {
  it('recognizes our own AtlasRef shape and validates it', () => {
    const atlas = {
      pages: [
        {
          file: 'sheet.png',
          width: 64,
          height: 64,
          regions: [
            {
              name: 'head',
              x: 0,
              y: 0,
              w: 32,
              h: 32,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 32,
              originalH: 32,
            },
          ],
        },
      ],
    };
    const result = classifyDescriptor(atlas);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.kind).toBe('atlasRef');
  });

  it('rejects an AtlasRef-shaped object that fails schema validation', () => {
    const result = classifyDescriptor({ pages: [{ file: 'x.png' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_DESCRIPTOR_INVALID');
  });

  it('parses a generic region list with an explicit image name', () => {
    const result = classifyDescriptor({
      image: 'atlas.png',
      regions: [{ name: 'a', x: 0, y: 0, w: 10, h: 10, rotation: 90 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.parsed.kind !== 'regions') return;
    expect(result.parsed.descriptor.image).toBe('atlas.png');
    expect(result.parsed.descriptor.regions[0]?.rotated).toBe(true);
  });

  it('parses a bare region array with an implicit image', () => {
    const result = classifyDescriptor([{ name: 'a', x: 1, y: 2, w: 3, h: 4 }]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.parsed.kind !== 'regions') return;
    expect(result.parsed.descriptor.image).toBeNull();
    expect(result.parsed.descriptor.regions).toHaveLength(1);
  });

  it('rejects an unrecognized descriptor shape', () => {
    const result = classifyDescriptor({ hello: 'world' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_DESCRIPTOR_INVALID');
  });

  it('rejects a region missing a name', () => {
    const result = classifyDescriptor({ regions: [{ x: 0, y: 0, w: 4, h: 4 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_INVALID');
  });

  it('rejects a region with a non-integer size', () => {
    const result = classifyDescriptor({ regions: [{ name: 'a', x: 0, y: 0, w: 4.5, h: 4 }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_INVALID');
  });
});

describe('buildSinglePageAtlas', () => {
  const regions: GenericRegionInput[] = [
    { name: 'head', x: 0, y: 0, w: 16, h: 16 },
    { name: 'body', x: 16, y: 0, w: 16, h: 32 },
  ];

  it('assembles a single-page AtlasRef with untrimmed regions', () => {
    const result = buildSinglePageAtlas('sheet.png', 64, 64, regions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = result.atlas.pages[0];
    expect(page?.file).toBe('sheet.png');
    expect(page?.regions).toHaveLength(2);
    const head = page?.regions[0];
    expect(head).toMatchObject({
      name: 'head',
      offsetX: 0,
      offsetY: 0,
      originalW: 16,
      originalH: 16,
    });
  });

  it('reports an empty descriptor', () => {
    const result = buildSinglePageAtlas('sheet.png', 64, 64, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_DESCRIPTOR_EMPTY');
  });

  it('rejects a duplicate region name', () => {
    const result = buildSinglePageAtlas('sheet.png', 64, 64, [
      { name: 'dup', x: 0, y: 0, w: 8, h: 8 },
      { name: 'dup', x: 8, y: 0, w: 8, h: 8 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_DUPLICATE');
  });

  it('rejects a region that overflows the page', () => {
    const result = buildSinglePageAtlas('sheet.png', 32, 32, [
      { name: 'big', x: 16, y: 16, w: 32, h: 32 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_OUT_OF_BOUNDS');
  });

  it('checks the rotated footprint (h x w) against the page bounds', () => {
    // Logical 40x10, rotated => footprint 10 wide x 40 tall. It fits a 16x48 page but not a 48x16 one.
    const rotated: GenericRegionInput = { name: 'r', x: 0, y: 0, w: 40, h: 10, rotated: true };
    expect(buildSinglePageAtlas('s.png', 16, 48, [rotated]).ok).toBe(true);
    const tooShort = buildSinglePageAtlas('s.png', 48, 16, [rotated]);
    expect(tooShort.ok).toBe(false);
    if (tooShort.ok) return;
    expect(tooShort.error.code).toBe('ATLAS_REGION_OUT_OF_BOUNDS');
  });
});

describe('validateAtlasRefPages', () => {
  const atlas = {
    pages: [
      {
        file: 'sheet.png',
        width: 100,
        height: 100,
        regions: [
          {
            name: 'a',
            x: 0,
            y: 0,
            w: 20,
            h: 20,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            originalW: 20,
            originalH: 20,
          },
        ],
      },
    ],
  };

  it('pins the page size to the true decoded image and passes valid regions', () => {
    const result = validateAtlasRefPages(
      atlas,
      new Map([['sheet.png', { width: 128, height: 128 }]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.atlas.pages[0]?.width).toBe(128);
  });

  it('reports a page image the descriptor references but no file was found', () => {
    const result = validateAtlasRefPages(atlas, new Map());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_INVALID');
  });

  it('rejects a region that falls outside the true image bounds', () => {
    const result = validateAtlasRefPages(
      atlas,
      new Map([['sheet.png', { width: 10, height: 10 }]]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_REGION_OUT_OF_BOUNDS');
  });
});

describe('buildGridAtlas', () => {
  it('slices a sheet by cell size in row-major order', () => {
    const result = buildGridAtlas(
      'sheet.png',
      64,
      32,
      { mode: 'cell', cellWidth: 32, cellHeight: 32 },
      'tile',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regions = result.atlas.pages[0]?.regions ?? [];
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ name: 'tile_0', x: 0, y: 0, w: 32, h: 32 });
    expect(regions[1]).toMatchObject({ name: 'tile_1', x: 32, y: 0, w: 32, h: 32 });
  });

  it('slices a sheet by column/row count', () => {
    const result = buildGridAtlas('sheet.png', 90, 60, { mode: 'grid', columns: 3, rows: 2 }, 'f');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const regions = result.atlas.pages[0]?.regions ?? [];
    expect(regions).toHaveLength(6);
    // 90/3 = 30 wide, 60/2 = 30 tall; the last cell of the first row starts at x = 60.
    expect(regions[2]).toMatchObject({ name: 'f_2', x: 60, y: 0, w: 30, h: 30 });
    expect(regions[3]).toMatchObject({ name: 'f_3', x: 0, y: 30, w: 30, h: 30 });
  });

  it('drops the remainder when the cell size does not divide the image evenly', () => {
    const result = buildGridAtlas(
      'sheet.png',
      70,
      32,
      { mode: 'cell', cellWidth: 32, cellHeight: 32 },
      't',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // floor(70/32) = 2 columns; the trailing 6px column is dropped.
    expect(result.atlas.pages[0]?.regions).toHaveLength(2);
  });

  it('rejects a cell larger than the image', () => {
    const result = buildGridAtlas(
      'sheet.png',
      16,
      16,
      { mode: 'cell', cellWidth: 32, cellHeight: 32 },
      't',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_GRID_INVALID');
  });

  it('rejects a non-positive grid count', () => {
    const result = buildGridAtlas('sheet.png', 64, 64, { mode: 'grid', columns: 0, rows: 2 }, 't');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ATLAS_GRID_INVALID');
  });
});
