import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cropRegion,
  decodePng,
  despeckleLayerImage,
  encodePng,
  labelComponents,
  mergeAndFilter,
  opaqueBounds,
  removeBackground,
  DEFAULT_DESPECKLE,
  DEFAULT_WHITE_FLOOD,
  type Bbox,
  type Component,
} from './cut-core.mts';

// Deterministic asset-prep cutter for the Little Aliens slot game. Cuts the AI-generated manifest sheets
// (individual sprites, chrome, per-part character pieces) into clean, individually named transparent
// PNGs for the atlas pipeline. Every cut goes through cut-core's edge-flood white removal + connected
// component extraction; nothing shells out to a background-removal tool. bg.png is a full-canvas photo
// copied through with a sips downscale (macOS), the one sanctioned native step, matching the kraken demo.
//
// Reproducibility: SYMBOL_TARGETS anchors are the component centroids observed on symbols.png; each
// named sprite is matched to the labelled component nearest its anchor. Components no target claims
// (duplicate royals, a merged mini-flask + K) are dropped and recorded as `unclaimed` in the manifest.

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, '..', '..', 'slot-assets', 'little-aliens');
const sourceDir = join(here, 'source');
const layersDir = join(here, 'source-layers');
mkdirSync(sourceDir, { recursive: true });
mkdirSync(layersDir, { recursive: true });

const SYMBOL_PAD = 6;
const SYMBOL_GAP = 24;
const SYMBOL_MIN_AREA = 900;
const ANCHOR_TOLERANCE = 80; // px; guards against silent drift if the source sheet changes.

interface Target {
  readonly name: string;
  readonly ax: number;
  readonly ay: number;
}

// Named sprites to keep from symbols.png (the clean white-background sheet; the transparent "firefly"
// variant is discarded, it carries a dirty dark halo). Duplicate royals keep the single cleanest
// instance from the right-hand block; the other duplicates go unclaimed.
const SYMBOL_TARGETS: readonly Target[] = [
  { name: 'alien-pink-blob', ax: 371, ay: 371 },
  { name: 'crystal', ax: 3172, ay: 374 },
  { name: 'potion', ax: 3926, ay: 378 },
  { name: 'raygun', ax: 4705, ay: 321 },
  { name: 'alien-teal', ax: 382, ay: 1048 },
  { name: 'alien-green-bean', ax: 1079, ay: 1049 },
  { name: 'alien-yellow-trieye', ax: 1760, ay: 1049 },
  { name: 'royal-q', ax: 3991, ay: 1030 },
  { name: 'royal-j', ax: 4669, ay: 1049 },
  { name: 'alien-blue-spiky', ax: 379, ay: 1712 },
  { name: 'alien-green-slime', ax: 1775, ay: 1728 },
  { name: 'alien-blue-horned', ax: 3203, ay: 1726 },
  { name: 'royal-10', ax: 4704, ay: 1712 },
  { name: 'alien-green-small', ax: 376, ay: 2387 },
  { name: 'alien-orange-sun', ax: 1080, ay: 2388 },
  { name: 'alien-red-slug', ax: 1780, ay: 2386 },
  { name: 'royal-a', ax: 3231, ay: 2398 },
  { name: 'royal-k', ax: 3953, ay: 2394 },
  { name: 'alien-teal-mini', ax: 1098, ay: 3066 },
  { name: 'alien-pale-grump', ax: 1793, ay: 3077 },
];

// Per-part character pieces (layers/). Single-piece white removal, no component split: label -> drop
// specks -> crop the union so multi-part files (eyes + mouth) stay together at their relative offsets.
// Garbled source filenames are renamed to clean kebab-case; content-accurate where it disagrees with the
// raw name (the 'gren\en-eyes' file is a second set of BLUE eyes, named blue-eyes-alt).
const LAYER_FILES: ReadonlyArray<readonly [string, string]> = [
  ['blob.png', 'blob.png'],
  ['blob2.png', 'blob2.png'],
  ['blob-face.png', 'blob-face.png'],
  ['blue.png', 'blue.png'],
  ['blue-eyes.png', 'blue-eyes.png'],
  ['blue-arms.png', 'blue-arms.png'],
  ['blue-legs.png', 'blue-legs.png'],
  ['blue-noface.png', 'blue-noface.png'],
  ['blue,ant.png', 'blue-antenna.png'],
  ['green.png', 'green.png'],
  ['green-horns.png', 'green-horns.png'],
  ['green-noface.png', 'green-noface.png'],
  ['green-feet.png', 'green-feet.png'],
  ['green-friown.png', 'green-frown.png'],
  ['gren\\en-eyes.png', 'blue-eyes-alt.png'],
  ['orange.png', 'orange.png'],
  ['layers-symbols copy 2.png', 'pale-grump-noface.png'],
  ['layers-symbols copy 3.png', 'pale-grump.png'],
  ['layers-symbols copy 5.png', 'orange-arms.png'],
  ['layers-symbols copy 15.png', 'orange-noface.png'],
];

interface ManifestEntry {
  readonly file: string;
  readonly sourceSheet: string;
  readonly bbox: Bbox;
  readonly area: number;
}

const manifest: ManifestEntry[] = [];
const dist2 = (c: Component, t: Target): number =>
  (c.centroidX - t.ax) ** 2 + (c.centroidY - t.ay) ** 2;

function cutSymbolSheet(): void {
  const sheet = 'symbols.png';
  const img = decodePng(readFileSync(join(rawDir, sheet)));
  const { image, foreground } = removeBackground(img, DEFAULT_WHITE_FLOOD);
  const comps = mergeAndFilter(
    labelComponents(img.width, img.height, foreground),
    SYMBOL_GAP,
    SYMBOL_MIN_AREA,
  );

  const claimed = new Set<Component>();
  for (const target of SYMBOL_TARGETS) {
    let best: Component | undefined;
    let bestD = Infinity;
    for (const c of comps) {
      const d = dist2(c, target);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || Math.sqrt(bestD) > ANCHOR_TOLERANCE) {
      throw new Error(
        `no component within ${ANCHOR_TOLERANCE}px of ${target.name} anchor (${target.ax},${target.ay}); nearest ${Math.round(Math.sqrt(bestD))}px`,
      );
    }
    claimed.add(best);
    const crop = cropRegion(image, best.bbox, SYMBOL_PAD);
    const file = `${target.name}.png`;
    writeFileSync(join(sourceDir, file), encodePng(crop));
    manifest.push({ file: `source/${file}`, sourceSheet: sheet, bbox: best.bbox, area: best.area });
  }

  const unclaimed = comps.filter((c) => !claimed.has(c));
  for (const c of unclaimed) {
    manifest.push({ file: 'DROPPED(unclaimed)', sourceSheet: sheet, bbox: c.bbox, area: c.area });
  }
  console.log(
    `symbols.png: ${SYMBOL_TARGETS.length} sprites emitted, ${unclaimed.length} components dropped (duplicate royals / merged mini-flask+K)`,
  );
}

// Single-piece white removal for a per-part layer file: no component split, specks dropped, cropped to
// the union of the surviving parts so eyes/mouths/antennae keep their in-file relative positions.
function cutLayerFile(rawName: string, outName: string): void {
  const img = decodePng(readFileSync(join(rawDir, 'layers', rawName)));
  // removeBackground clears the white margin but cannot see the dark, near-transparent checkerboard the
  // pre-alpha'd layer sheets bake into their background (it reads RGB, not the source alpha). Despeckle
  // using the source alpha before labelling so only the character pieces reach the crop.
  const { image, foreground } = despeckleLayerImage(
    img,
    removeBackground(img, DEFAULT_WHITE_FLOOD),
    DEFAULT_DESPECKLE,
    DEFAULT_WHITE_FLOOD,
  );
  const parts = mergeAndFilter(
    labelComponents(img.width, img.height, foreground),
    SYMBOL_GAP,
    SYMBOL_MIN_AREA,
  );
  if (parts.length === 0)
    throw new Error(`layer ${rawName} produced no content above the speck threshold`);
  const union: Bbox = parts.reduce<Bbox>(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.bbox.minX),
      minY: Math.min(acc.minY, p.bbox.minY),
      maxX: Math.max(acc.maxX, p.bbox.maxX),
      maxY: Math.max(acc.maxY, p.bbox.maxY),
    }),
    parts[0].bbox,
  );
  const area = parts.reduce((sum, p) => sum + p.area, 0);
  writeFileSync(join(layersDir, outName), encodePng(cropRegion(image, union, SYMBOL_PAD)));
  manifest.push({
    file: `source-layers/${outName}`,
    sourceSheet: `layers/${rawName}`,
    bbox: union,
    area,
  });
}

// reelframe.png: white outside AND a grey/white centre window that must both become transparent. Edge
// flood clears the outer white; a second flood seeded at the canvas centre clears the enclosed low-
// saturation window, bounded by the saturated neon frame. The whole assembly (handle, tray, frame, WIN
// plate) is kept together, cropped to its opaque bounds.
function cutReelFrame(): void {
  const sheet = 'reelframe.png';
  const img = decodePng(readFileSync(join(rawDir, sheet)));
  const { image } = removeBackground(img, DEFAULT_WHITE_FLOOD, {
    seedX: img.width >> 1,
    seedY: img.height >> 1,
    minLight: 190,
    maxSat: 48,
  });
  const bounds = opaqueBounds(image);
  if (!bounds) throw new Error('reelframe removal left no opaque content');
  writeFileSync(join(sourceDir, 'reelframe.png'), encodePng(cropRegion(image, bounds, SYMBOL_PAD)));
  manifest.push({ file: 'source/reelframe.png', sourceSheet: sheet, bbox: bounds, area: 0 });
  console.log('reelframe.png: outer + centre window cut, frame assembly kept');
}

// bg.png is a full-canvas background photo (no cutting): copy through, downscaled so height <= 1835 via
// sips (the kraken-demo precedent). full-game.png is the finished-game mock reference for the build stage.
function passthroughAssets(): void {
  const bgOut = join(sourceDir, 'bg.png');
  execFileSync('sips', ['-Z', '1835', join(rawDir, 'bg.png'), '--out', bgOut], { stdio: 'ignore' });
  console.log('bg.png: copied through, downscaled to height <= 1835');
  copyFileSync(join(rawDir, 'full-game.png'), join(here, 'reference.png'));
  console.log('full-game.png -> reference.png');
}

cutSymbolSheet();
for (const [rawName, outName] of LAYER_FILES) cutLayerFile(rawName, outName);
cutReelFrame();
passthroughAssets();

manifest.sort(
  (a, b) => a.file.localeCompare(b.file) || a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX,
);
writeFileSync(join(here, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `DONE: ${manifest.filter((m) => !m.file.startsWith('DROPPED')).length} files emitted, manifest written`,
);
