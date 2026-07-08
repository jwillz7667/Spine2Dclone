import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cropRegion,
  decodePng,
  encodePng,
  labelComponents,
  mergeAndFilter,
  removeBackground,
  DEFAULT_WHITE_FLOOD,
  type Bbox,
  type Component,
  type DecodedImage,
} from './cut-core.mts';

// Deterministic asset-prep cutter for GUNNER!. Every sheet is a grid of elements on a pure white
// background. The grid POSITIONS drift between generations, so the six character part sheets are cut
// into NUMBERED pieces (piece-01.png ... in row-major order) plus a per-sheet pieces.json and a
// contact.png QA grid; a later mapping step assigns real part names. Props, logo, refs, and
// backgrounds have stable layouts and keep semantic names. Pipeline per sheet: white-flood removal,
// 8-connected labelling, bbox merge (gap 24 unless overridden, minArea 250), row clustering by
// centroid y (split the sorted ys at the largest gaps), stack-aware x ordering inside each row
// (vertically stacked pairs like the duck bill halves order top-first), row-major flatten, then a
// pad-6 crop per piece. Sheets are polled while the generator writes them (20 s interval, 20 minute
// cap, and a file whose mtime is younger than 3 s is treated as still being written).

const here = dirname(fileURLToPath(import.meta.url));
const gunnerDir = join(here, '..');
const sheetsDir = join(gunnerDir, 'source-sheets');

const PAD = 6;
const GAP = 24;
// Part sheets: duckling's eyes-closed arcs and the thin mouth-line pieces are tiny at 4K, so the
// speck floor sits at 250. Refs union everything, where a 250-area JPEG speck could inflate the
// union bbox, so they keep the safer 900 floor. The logo keeps 250 so sparkle satellites survive.
const PART_MIN_AREA = 250;
const REF_MIN_AREA = 900;
const LOGO_GAP = 60;
const POLL_MS = 20_000;
const TIMEOUT_MS = 20 * 60 * 1000;
const SETTLE_MS = 3_000;

const CONTACT_CELL = 256;
const CONTACT_GAP = 8;
const CONTACT_COLS = 6;

interface ManifestEntry {
  readonly file: string;
  readonly sheet: string;
  readonly bbox: Bbox;
  readonly width: number;
  readonly height: number;
}

const manifest: ManifestEntry[] = [];
const failures: string[] = [];
const rowCountReport = new Map<string, number[]>();

const fmtBbox = (b: Bbox): string => `(${b.minX},${b.minY})-(${b.maxX},${b.maxY})`;
const fmtComp = (c: Component): string =>
  `${fmtBbox(c.bbox)} ${c.bbox.maxX - c.bbox.minX + 1}x${c.bbox.maxY - c.bbox.minY + 1} area=${c.area} centroid=(${Math.round(c.centroidX)},${Math.round(c.centroidY)})`;

const unionBbox = (a: Bbox, b: Bbox): Bbox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

const unionAll = (comps: readonly Component[]): Bbox =>
  comps.slice(1).reduce<Bbox>((acc, c) => unionBbox(acc, c.bbox), comps[0].bbox);

// The generator labels every sheet .png but actually writes JPEG bytes. The cutter's codec is the
// pure-JS decodePng, so a non-PNG sheet is converted once through sips (the macOS-native step this
// repo's demos already sanction) into a cache dir, keyed by mtime so a re-rolled sheet reconverts.
const pngCacheDir = join(sheetsDir, '.png-cache');
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

function isPngFile(path: string): boolean {
  const bytes = readFileSync(path);
  return bytes.length >= 4 && PNG_SIG.every((b, i) => bytes[i] === b);
}

// Path to a real-PNG version of the sheet: the sheet itself when it already is one, otherwise a
// sips-converted cache copy.
function asPngPath(sheet: string): string {
  const src = join(sheetsDir, sheet);
  if (isPngFile(src)) return src;
  const cached = join(pngCacheDir, sheet);
  if (!existsSync(cached) || statSync(cached).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(pngCacheDir, { recursive: true });
    execFileSync('sips', ['-s', 'format', 'png', src, '--out', cached], { stdio: 'ignore' });
  }
  return cached;
}

const decodeSheet = (sheet: string): DecodedImage => decodePng(readFileSync(asPngPath(sheet)));

function loadSheet(
  sheet: string,
  gap: number,
  minArea: number,
): { comps: Component[]; cut: DecodedImage } {
  const img = decodeSheet(sheet);
  const { image, foreground } = removeBackground(img, DEFAULT_WHITE_FLOOD);
  const comps = mergeAndFilter(labelComponents(img.width, img.height, foreground), gap, minArea);
  return { comps, cut: image };
}

// Cluster components into `rowCount` rows by centroid y: sort by y, split the sorted list at the
// (rowCount - 1) largest consecutive-y gaps. Pure ordering, no thresholds, so uneven row heights
// and ragged baselines survive.
function clusterRows(comps: readonly Component[], rowCount: number): Component[][] {
  const byY = comps.slice().sort((a, b) => a.centroidY - b.centroidY);
  if (rowCount <= 1 || byY.length <= rowCount) {
    return rowCount <= 1 ? [byY] : byY.map((c) => [c]);
  }
  const gaps: Array<{ readonly index: number; readonly size: number }> = [];
  for (let i = 1; i < byY.length; i += 1) {
    gaps.push({ index: i, size: byY[i].centroidY - byY[i - 1].centroidY });
  }
  const splits = gaps
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, rowCount - 1)
    .map((g) => g.index)
    .sort((a, b) => a - b);
  const rows: Component[][] = [];
  let start = 0;
  for (const split of splits) {
    rows.push(byY.slice(start, split));
    start = split;
  }
  rows.push(byY.slice(start));
  return rows;
}

// Fraction of the narrower component's width shared by the two x-ranges (0 when disjoint).
function xOverlapRatio(a: Bbox, b: Bbox): number {
  const overlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) + 1;
  if (overlap <= 0) return 0;
  return overlap / Math.min(a.maxX - a.minX + 1, b.maxX - b.minX + 1);
}

// Order a row's components left to right, EXCEPT that components sharing >= 50 percent of the
// narrower one's x-range are a vertical stack occupying one grid cell (the duck bill halves): a
// stack keeps one x position and orders its members top-first. Stacks are transitive (union-find).
function orderRow(row: readonly Component[]): Component[] {
  const parent = row.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    let c = i;
    while (parent[c] !== c) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  };
  for (let i = 0; i < row.length; i += 1) {
    for (let j = i + 1; j < row.length; j += 1) {
      if (xOverlapRatio(row[i].bbox, row[j].bbox) >= 0.5) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Component[]>();
  row.forEach((c, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(c);
    else groups.set(root, [c]);
  });
  const stacks = [...groups.values()].map((members) => ({
    members: members.slice().sort((a, b) => a.centroidY - b.centroidY),
    x:
      members.reduce((s, c) => s + c.centroidX * c.area, 0) /
      members.reduce((s, c) => s + c.area, 0),
  }));
  stacks.sort((a, b) => a.x - b.x);
  return stacks.flatMap((s) => s.members);
}

function writeCrop(
  image: DecodedImage,
  bbox: Bbox,
  outAbs: string,
  outRel: string,
  sheet: string,
): DecodedImage {
  mkdirSync(dirname(outAbs), { recursive: true });
  const crop = cropRegion(image, bbox, PAD);
  writeFileSync(outAbs, encodePng(crop));
  manifest.push({ file: outRel, sheet, bbox, width: crop.width, height: crop.height });
  return crop;
}

// Alpha-weighted area-average downscale (transparent-edge pixels do not darken the fringe).
function downscale(img: DecodedImage, scale: number): DecodedImage {
  if (scale >= 1) return img;
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8Array(dw * dh * 4);
  const sxStep = img.width / dw;
  const syStep = img.height / dh;
  for (let dy = 0; dy < dh; dy += 1) {
    const sy0 = Math.floor(dy * syStep);
    const sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * syStep));
    for (let dx = 0; dx < dw; dx += 1) {
      const sx0 = Math.floor(dx * sxStep);
      const sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * sxStep));
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const o = (sy * img.width + sx) * 4;
          const a = img.rgba[o + 3];
          rSum += img.rgba[o] * a;
          gSum += img.rgba[o + 1] * a;
          bSum += img.rgba[o + 2] * a;
          aSum += a;
          n += 1;
        }
      }
      const d = (dy * dw + dx) * 4;
      if (aSum > 0) {
        out[d] = Math.round(rSum / aSum);
        out[d + 1] = Math.round(gSum / aSum);
        out[d + 2] = Math.round(bSum / aSum);
      }
      out[d + 3] = Math.round(aSum / n);
    }
  }
  return { width: dw, height: dh, rgba: out };
}

// Row-major QA contact sheet: 6 uniform 256px cells per row, 8px gaps, white background, each piece
// centered in its cell and downscaled to fit (never upscaled). Index = row-major position.
function buildContactSheet(pieces: readonly DecodedImage[]): DecodedImage {
  const cols = Math.min(CONTACT_COLS, Math.max(1, pieces.length));
  const rows = Math.ceil(pieces.length / cols);
  const width = cols * CONTACT_CELL + (cols + 1) * CONTACT_GAP;
  const height = rows * CONTACT_CELL + (rows + 1) * CONTACT_GAP;
  const rgba = new Uint8Array(width * height * 4).fill(255);
  pieces.forEach((piece, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const scale = Math.min(1, CONTACT_CELL / piece.width, CONTACT_CELL / piece.height);
    const thumb = downscale(piece, scale);
    const cellX = CONTACT_GAP + col * (CONTACT_CELL + CONTACT_GAP);
    const cellY = CONTACT_GAP + row * (CONTACT_CELL + CONTACT_GAP);
    const offX = cellX + ((CONTACT_CELL - thumb.width) >> 1);
    const offY = cellY + ((CONTACT_CELL - thumb.height) >> 1);
    for (let y = 0; y < thumb.height; y += 1) {
      for (let x = 0; x < thumb.width; x += 1) {
        const s = (y * thumb.width + x) * 4;
        const a = thumb.rgba[s + 3] / 255;
        if (a === 0) continue;
        const d = ((offY + y) * width + (offX + x)) * 4;
        rgba[d] = Math.round(thumb.rgba[s] * a + 255 * (1 - a));
        rgba[d + 1] = Math.round(thumb.rgba[s + 1] * a + 255 * (1 - a));
        rgba[d + 2] = Math.round(thumb.rgba[s + 2] * a + 255 * (1 - a));
        rgba[d + 3] = 255;
      }
    }
  });
  return { width, height, rgba };
}

interface PieceEntry {
  readonly file: string;
  readonly bbox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly area: number;
  readonly centroid: { readonly x: number; readonly y: number };
}

// A character part sheet: grid positions drift between generations, so pieces are emitted NUMBERED
// in row-major order (stack-aware within each row); a later mapping step assigns real part names.
function cutPieceSheet(sheet: string, rowCount: number): void {
  const sheetId = basename(sheet, '.png');
  const { comps, cut } = loadSheet(sheet, GAP, PART_MIN_AREA);
  if (comps.length === 0) throw new Error(`${sheet}: no components above minArea ${PART_MIN_AREA}`);
  const rows = clusterRows(comps, rowCount).map(orderRow);
  const flat = rows.flat();

  const outDir = join(gunnerDir, 'source-layers', sheetId);
  const entries: PieceEntry[] = [];
  const crops: DecodedImage[] = [];
  flat.forEach((comp, index) => {
    const file = `piece-${String(index + 1).padStart(2, '0')}.png`;
    const rel = `source-layers/${sheetId}/${file}`;
    crops.push(writeCrop(cut, comp.bbox, join(outDir, file), rel, sheet));
    entries.push({
      file,
      bbox: {
        x: comp.bbox.minX,
        y: comp.bbox.minY,
        w: comp.bbox.maxX - comp.bbox.minX + 1,
        h: comp.bbox.maxY - comp.bbox.minY + 1,
      },
      area: comp.area,
      centroid: { x: Math.round(comp.centroidX), y: Math.round(comp.centroidY) },
    });
  });
  writeFileSync(join(outDir, 'pieces.json'), `${JSON.stringify(entries, null, 2)}\n`);
  writeFileSync(join(outDir, 'contact.png'), encodePng(buildContactSheet(crops)));
  rowCountReport.set(
    sheet,
    rows.map((r) => r.length),
  );
  console.log(
    `${sheet}: ${flat.length} pieces cut, rows [${rows.map((r) => r.length).join(', ')}] -> source-layers/${sheetId}/`,
  );
}

// A props sheet has a stable layout, so pieces keep semantic names; the exact-count assertion stays
// as the guard against layout drift.
function cutNamedSheet(
  sheet: string,
  rowCounts: readonly number[],
  dests: readonly string[],
  mergeGap: number = GAP,
): void {
  const expected = rowCounts.reduce((sum, n) => sum + n, 0);
  if (expected !== dests.length)
    throw new Error(`task bug: ${sheet} expects ${expected} parts but has ${dests.length} names`);
  const { comps, cut } = loadSheet(sheet, mergeGap, PART_MIN_AREA);
  const rows = clusterRows(comps, rowCounts.length).map(orderRow);
  const total = rows.reduce((sum, r) => sum + r.length, 0);
  const rowsOk = total === expected && rows.every((row, i) => row.length === rowCounts[i]);
  if (!rowsOk) {
    throw new Error(
      `${sheet}: expected ${expected} components in rows [${rowCounts.join(', ')}], found ${total} in rows [${rows.map((r) => r.length).join(', ')}]\n${rows
        .map(
          (row, i) =>
            `  row ${i}: ${row.length} comps\n${row.map((c) => `    ${fmtComp(c)}`).join('\n')}`,
        )
        .join('\n')}`,
    );
  }
  const flat = rows.flat();
  for (let i = 0; i < flat.length; i += 1) {
    writeCrop(cut, flat[i].bbox, join(gunnerDir, dests[i]), dests[i], sheet);
  }
  rowCountReport.set(
    sheet,
    rows.map((r) => r.length),
  );
  console.log(`${sheet}: ${flat.length} parts cut (rows ${rowCounts.join('+')})`);
}

// The logo may fragment even under an aggressive merge; whatever survives (letters plus sparkle
// satellites) is one mark, so union every remaining component into a single bbox.
function cutLogo(sheet: string, dest: string): void {
  const img = decodeSheet(sheet);
  const { image, foreground } = removeBackground(img, DEFAULT_WHITE_FLOOD);
  const comps = mergeAndFilter(
    labelComponents(img.width, img.height, foreground),
    LOGO_GAP,
    PART_MIN_AREA,
  );
  if (comps.length === 0) throw new Error(`${sheet}: no components above minArea ${PART_MIN_AREA}`);
  writeCrop(image, unionAll(comps), join(gunnerDir, dest), dest, sheet);
  console.log(`${sheet}: logo cut (${comps.length} component(s) unioned)`);
}

// A character reference: one whole piece, the union of every surviving component.
function cutRefWhole(sheet: string, dest: string): void {
  const { comps, cut } = loadSheet(sheet, GAP, REF_MIN_AREA);
  if (comps.length === 0) throw new Error(`${sheet}: no components above minArea ${REF_MIN_AREA}`);
  writeCrop(cut, unionAll(comps), join(gunnerDir, dest), dest, sheet);
  console.log(`${sheet}: ref cut (${comps.length} component(s) unioned)`);
}

// ducks-ref carries two characters side by side: cluster into 2 column groups at the largest
// centroid-x gap, union each group, emit mama (left) then duckling (right).
function cutDucksRef(sheet: string, destLeft: string, destRight: string): void {
  const { comps, cut } = loadSheet(sheet, GAP, REF_MIN_AREA);
  if (comps.length < 2) {
    throw new Error(
      `${sheet}: expected 2 characters, found ${comps.length} component(s)\n${comps.map((c) => `  ${fmtComp(c)}`).join('\n')}`,
    );
  }
  const byX = comps.slice().sort((a, b) => a.centroidX - b.centroidX);
  let split = 1;
  let bestGap = -1;
  for (let i = 1; i < byX.length; i += 1) {
    const gap = byX[i].centroidX - byX[i - 1].centroidX;
    if (gap > bestGap) {
      bestGap = gap;
      split = i;
    }
  }
  writeCrop(cut, unionAll(byX.slice(0, split)), join(gunnerDir, destLeft), destLeft, sheet);
  writeCrop(cut, unionAll(byX.slice(split)), join(gunnerDir, destRight), destRight, sheet);
  console.log(
    `${sheet}: 2 refs cut (mama ${split} comp(s), duckling ${byX.length - split} comp(s))`,
  );
}

// Backgrounds are full-canvas paintings: no cutting, no scaling. A real-PNG source copies verbatim;
// a JPEG-bytes source is container-converted to PNG so the downstream PNG loaders can read it.
function copyBg(sheet: string, dest: string): void {
  const outAbs = join(gunnerDir, dest);
  mkdirSync(dirname(outAbs), { recursive: true });
  copyFileSync(asPngPath(sheet), outAbs);
  const img = decodePng(readFileSync(outAbs));
  manifest.push({
    file: dest,
    sheet,
    bbox: { minX: 0, minY: 0, maxX: img.width - 1, maxY: img.height - 1 },
    width: img.width,
    height: img.height,
  });
  console.log(`${sheet}: copied to ${dest}`);
}

interface Task {
  readonly sheet: string;
  readonly run: () => void;
}

const propsA = [
  'float-donut',
  'rope-coil',
  'rope-straight',
  'basket',
  'blanket',
  'wagon-catapult',
  'branch',
  'boulder',
  'log',
  'leaf-hat',
];
const propsB = [
  'bush-round',
  'bush-low',
  'tree',
  'willow-fronds',
  'butterfly-up',
  'butterfly-flat',
  'sun',
  'cloud',
];
const bgs = [
  'bg-title-skyline.png',
  'bg-meadow.png',
  'bg-creek.png',
  'bg-bank-run.png',
  'bg-log-bend.png',
  'bg-fog-hollow.png',
  'bg-waterfall.png',
  'bg-golden-meadow.png',
  'card-the-end.png',
];

const propDest = (n: string): string => `source/props/${n}.png`;

// Character part sheets -> numbered pieces. The row count per sheet is the one stable layout fact.
const PIECE_SHEETS: ReadonlyArray<readonly [string, number]> = [
  ['gunner-body-parts.png', 2],
  ['gunner-face-parts.png', 2],
  ['luna-parts.png', 3],
  ['beans-parts.png', 3],
  ['pip-parts.png', 2],
  ['ducks-parts.png', 2],
];

const tasks: Task[] = [
  ...PIECE_SHEETS.map(
    ([sheet, rowCount]): Task => ({ sheet, run: () => cutPieceSheet(sheet, rowCount) }),
  ),
  { sheet: 'props-a.png', run: () => cutNamedSheet('props-a.png', [5, 5], propsA.map(propDest)) },
  // props-b needs merge gap 6: the tree canopy's bbox interleaves with bush-low's to within 7 empty
  // columns while their pixels stay far apart, so any gap >= 7 would union two grid cells.
  {
    sheet: 'props-b.png',
    run: () => cutNamedSheet('props-b.png', [4, 4], propsB.map(propDest), 6),
  },
  { sheet: 'logo.png', run: () => cutLogo('logo.png', 'source/props/logo.png') },
  { sheet: 'gunner-ref.png', run: () => cutRefWhole('gunner-ref.png', 'source/refs/gunner.png') },
  { sheet: 'luna-ref.png', run: () => cutRefWhole('luna-ref.png', 'source/refs/luna.png') },
  { sheet: 'beans-ref.png', run: () => cutRefWhole('beans-ref.png', 'source/refs/beans.png') },
  { sheet: 'pip-ref.png', run: () => cutRefWhole('pip-ref.png', 'source/refs/pip.png') },
  {
    sheet: 'ducks-ref.png',
    run: () => cutDucksRef('ducks-ref.png', 'source/refs/mama.png', 'source/refs/duckling.png'),
  },
  ...bgs.map((bg): Task => ({ sheet: bg, run: () => copyBg(bg, `source/bg/${bg}`) })),
];

// A sheet is ready when it exists and its mtime is at least SETTLE_MS old (the generator writes
// files atomically enough; the settle window skips a file still being flushed).
function isReady(sheet: string): boolean {
  const path = join(sheetsDir, sheet);
  if (!existsSync(path)) return false;
  return Date.now() - statSync(path).mtimeMs >= SETTLE_MS;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pending = new Map<string, Task>(tasks.map((t) => [t.sheet, t]));
const deadline = Date.now() + TIMEOUT_MS;
while (pending.size > 0) {
  for (const [sheet, task] of [...pending]) {
    if (!isReady(sheet)) continue;
    pending.delete(sheet);
    try {
      task.run();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.startsWith(sheet) ? raw : `${sheet}: ${raw}`;
      failures.push(message);
      console.error(`FAIL ${message}`);
    }
  }
  if (pending.size === 0) break;
  if (Date.now() >= deadline) {
    for (const sheet of pending.keys()) {
      failures.push(`${sheet}: still missing after ${TIMEOUT_MS / 60000} minutes`);
      console.error(`MISSING ${sheet}: not written within the timeout`);
    }
    break;
  }
  console.log(`waiting for ${pending.size} sheet(s): ${[...pending.keys()].join(', ')}`);
  await sleep(POLL_MS);
}

manifest.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(gunnerDir, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const [sheet, rows] of rowCountReport) {
  console.log(`rows ${sheet}: [${rows.join(', ')}] = ${rows.reduce((s, n) => s + n, 0)} pieces`);
}
console.log(`DONE: ${manifest.length} files emitted, manifest written to source-manifest.json`);
if (failures.length > 0) {
  console.error(`\n${failures.length} sheet(s) failed:\n${failures.join('\n\n')}`);
  process.exitCode = 1;
}
