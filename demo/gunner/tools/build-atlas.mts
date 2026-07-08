import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  emitAtlas,
  importSprites,
  packAtlas,
  trimSprite,
  type TrimmedSprite,
} from '../../../packages/atlas-pack/src/index';

// GUNNER! atlas build: one atlas per rigged character (2048 pages) plus one props atlas (4096 page),
// via the SAME shared atlas-pack primitives the editor and the MCP atlas.pack tool run: import ->
// trim -> maxrects pack -> emit, then atlas-ref.json alongside the pages for the rig-authoring step.
// Targets come from argv (e.g. `tsx build-atlas.mts props` or `tsx build-atlas.mts gunner luna`),
// defaulting to every character plus props; character atlases read source-layers/<char>/, which the
// piece-mapping rename step populates. A target whose source directory is absent or empty is skipped
// with a note so the rest still packs.

const here = dirname(fileURLToPath(import.meta.url));
const gunnerDir = join(here, '..');
const fileStore = createNodeFileStore();

interface AtlasRow {
  readonly name: string;
  readonly regions: number;
  readonly pages: string;
  readonly fillPct: string;
}

const rows: AtlasRow[] = [];

async function buildAtlas(name: string, sourceDir: string, maxPageSize: number): Promise<void> {
  if (!existsSync(sourceDir)) {
    console.log(`SKIP ${name}: ${sourceDir} does not exist`);
    return;
  }
  const sprites = await importSprites(sourceDir, fileStore);
  if (sprites.length === 0) {
    console.log(`SKIP ${name}: no PNGs in ${sourceDir}`);
    return;
  }
  const trimmed: TrimmedSprite[] = sprites.map((s) => {
    const trim = trimSprite(s.rgba, s.width, s.height);
    return {
      name: s.name,
      trimmedW: trim.trimmedW,
      trimmedH: trim.trimmedH,
      offsetX: trim.offsetX,
      offsetY: trim.offsetY,
      originalW: trim.originalW,
      originalH: trim.originalH,
      pixels: trim.pixels,
    };
  });
  const { atlas, pageBitmaps } = packAtlas(trimmed, { maxPageSize, padding: 2 });
  const outDir = join(gunnerDir, 'atlas', name);
  mkdirSync(outDir, { recursive: true });
  const ref = await emitAtlas(atlas, pageBitmaps, outDir, fileStore);
  writeFileSync(join(outDir, 'atlas-ref.json'), `${JSON.stringify(ref, null, 2)}\n`);

  const regionCount = ref.pages.reduce((sum, p) => sum + p.regions.length, 0);
  const pageArea = ref.pages.reduce((sum, p) => sum + p.width * p.height, 0);
  const usedArea = ref.pages.reduce(
    (sum, p) => sum + p.regions.reduce((a, r) => a + r.w * r.h, 0),
    0,
  );
  rows.push({
    name,
    regions: regionCount,
    pages: ref.pages.map((p) => `${p.width}x${p.height}`).join(' + '),
    fillPct: ((usedArea / pageArea) * 100).toFixed(1),
  });
}

const CHARACTERS = ['gunner', 'luna', 'beans', 'pip', 'mama', 'duckling'];
const KNOWN = new Set([...CHARACTERS, 'props']);
const requested = process.argv.slice(2);
const invalid = requested.filter((t) => !KNOWN.has(t));
if (invalid.length > 0) {
  throw new Error(
    `unknown atlas target(s): ${invalid.join(', ')} (valid: ${[...KNOWN].join(', ')})`,
  );
}
const targets = requested.length > 0 ? requested : [...CHARACTERS, 'props'];
for (const target of targets) {
  if (target === 'props') {
    await buildAtlas('props', join(gunnerDir, 'source', 'props'), 4096);
  } else {
    await buildAtlas(target, join(gunnerDir, 'source-layers', target), 2048);
  }
}

const header = ['atlas', 'regions', 'pages', 'fill %'];
const table = [header, ...rows.map((r) => [r.name, String(r.regions), r.pages, r.fillPct])];
const widths = header.map((_, col) => Math.max(...table.map((row) => row[col].length)));
for (const row of table) {
  console.log(row.map((cell, col) => cell.padEnd(widths[col])).join('  '));
}
