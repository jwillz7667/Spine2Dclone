import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cropRegion,
  decodePng,
  encodePng,
  labelComponents,
  mergeAndFilter,
  removeBackground,
  DEFAULT_WHITE_FLOOD,
  type DecodedImage,
} from './cut-core.mts';

// GUNNER head expression variants: pasted mouth overlays on a 3/4 head read as stickers, so the
// mouth states are baked into full replacement heads instead (user direction). Generates ONE
// 2x2 sheet of the exact same head with four mouth states via Gemini (chained to the cut head
// piece so the skull registers), cuts it, and nose-registers each variant against the original
// head.png so the head slot can swap attachments without the face moving.
//
// Grid contract: top-left closed (discarded, the original head.png stays canonical),
// top-right talking (head-talk), bottom-left wide bark (head-wide), bottom-right grit (head-grit).
//
// Usage: tsx gen-head-variants.mts [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sheetPath = join(root, 'source-sheets', 'gunner-head-variants.png');
const layersDir = join(root, 'source-layers', 'gunner');
const force = process.argv.includes('--force');

function loadApiKey(): string {
  const envPath = join(root, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  const key = line?.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (key === undefined || key.length === 0) throw new Error('GEMINI_API_KEY missing from .env');
  return key;
}

const MODELS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

async function generateSheet(): Promise<Buffer> {
  const apiKey = loadApiKey();
  const prompt = [
    'TEXTURE SPRITE SHEET for a game engine on a flat PURE WHITE background (#FFFFFF).',
    'The attached reference image is a cartoon dog head game sprite. Draw a 2x2 grid containing',
    'FOUR COPIES OF EXACTLY THAT SAME HEAD: identical breed, angle, proportions, palette, white',
    'blaze, outline weight and size. The ONLY thing that changes between the four copies is the',
    'MOUTH state, everything above the muzzle stays pixel-identical to the reference.',
    'Top-left: mouth closed with the same gentle smile as the reference.',
    'Top-right: mouth slightly open mid-word, small talking mouth with the jaw a little dropped.',
    'Bottom-left: mouth wide open in a joyful shout, big open jaw, pink tongue visible.',
    'Bottom-right: determined clenched teeth grin, gritted white teeth showing.',
    'CRITICAL, match the reference exactly on these points: NO eyes (the eye area is blank fur,',
    'eyes are composited separately by the engine), NO ears (bare rounded skull dome, the breed',
    'has cropped ears added separately), NO neck, NO body, head only.',
    'Each head fully separated from its neighbors by empty white background, nothing touching,',
    'nothing overlapping, nothing touching the image border. Identical head size in all four cells.',
    'ABSOLUTELY NO TEXT anywhere: no words, letters, numbers, labels or captions.',
  ].join(' ');
  const refHead = readFileSync(join(layersDir, 'head.png')).toString('base64');
  const refChar = readFileSync(join(root, 'source', 'refs', 'gunner.png')).toString('base64');
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: refHead } },
          { inline_data: { mime_type: 'image/png', data: refChar } },
        ],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } },
  });

  let lastError = 'no attempt';
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      );
      if (res.status === 429 || res.status >= 500) {
        lastError = `${model}: HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, attempt * 8000));
        continue;
      }
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
        break;
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> }; finishReason?: string }>;
      };
      const image = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (image === undefined) {
        lastError = `${model}: no image (finishReason=${json.candidates?.[0]?.finishReason})`;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return Buffer.from(image, 'base64');
    }
  }
  throw new Error(`generation failed: ${lastError}`);
}

if (!existsSync(sheetPath) || force) {
  console.log('generating gunner-head-variants sheet...');
  const png = await generateSheet();
  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, png);
  console.log(`-> ${sheetPath}`);
} else {
  console.log('sheet exists, skipping generation (use --force to re-roll)');
}

// ---- cut the four grid cells ---------------------------------------------------------------------
const sheet = decodePng(readFileSync(sheetPath));
const removed = removeBackground(sheet, DEFAULT_WHITE_FLOOD);
const comps = mergeAndFilter(labelComponents(sheet.width, sheet.height, removed.foreground), 24, 900);
if (comps.length !== 4) {
  console.log(`expected 4 components, found ${comps.length}: re-roll the sheet (--force) or adjust merge params`);
  for (const c of comps) console.log(`  comp n=${c.area} bbox x[${c.bbox.minX}..${c.bbox.maxX}] y[${c.bbox.minY}..${c.bbox.maxY}]`);
  process.exit(1);
}
const cells = comps
  .map((c) => ({ c, cx: (c.bbox.minX + c.bbox.maxX) / 2, cy: (c.bbox.minY + c.bbox.maxY) / 2 }))
  .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
const rows = [cells.slice(0, 2).sort((a, b) => a.cx - b.cx), cells.slice(2, 4).sort((a, b) => a.cx - b.cx)];
const names: Array<string | null> = [null, 'head-talk', 'head-wide', 'head-grit']; // TL discarded
const grid = [rows[0]![0]!, rows[0]![1]!, rows[1]![0]!, rows[1]![1]!];

// ---- dome registration ----------------------------------------------------------------------------
// The skull dome is the one region every jaw state keeps identical, so variants register dome-to-dome
// with the original head: crown-band centroid x, crown top y, and dome width (max opaque row width in
// the top 35 percent) measured IDENTICALLY on the original and each variant.
interface DomeInfo { topY: number; crownCx: number; domeW: number }
function measureDome(img: DecodedImage): DomeInfo {
  const { width: W, height: H, rgba } = img;
  const opaquePx = (x: number, y: number): boolean => rgba[(y * W + x) * 4 + 3]! > 128;
  let topY = -1;
  for (let y = 0; y < H && topY < 0; y += 1) {
    for (let x = 0; x < W; x += 1) if (opaquePx(x, y)) { topY = y; break; }
  }
  if (topY < 0) throw new Error('empty piece');
  let sx = 0;
  let n = 0;
  for (let y = topY; y < Math.min(H, topY + 13); y += 1) {
    for (let x = 0; x < W; x += 1) if (opaquePx(x, y)) { sx += x; n += 1; }
  }
  let domeW = 0;
  for (let y = topY; y < Math.min(H, topY + Math.floor(H * 0.35)); y += 1) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < W; x += 1) if (opaquePx(x, y)) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0 && x1 - x0 + 1 > domeW) domeW = x1 - x0 + 1;
  }
  return { topY, crownCx: sx / n, domeW };
}

const orig = decodePng(readFileSync(join(layersDir, 'head.png')));
const origDome = measureDome(orig);
const K_ORIG = 250 / orig.height; // original head targetH 250
// original head attachment: center (-25,-20), scaleX -1
const crownLocalX = -25 - (origDome.crownCx - orig.width / 2) * K_ORIG;
const crownLocalY = -20 + (origDome.topY - orig.height / 2) * K_ORIG;
console.log(
  `orig head ${orig.width}x${orig.height} dome top ${origDome.topY} crownCx ${origDome.crownCx.toFixed(0)}` +
  ` domeW ${origDome.domeW} -> crown local (${crownLocalX.toFixed(1)}, ${crownLocalY.toFixed(1)})`,
);

for (let i = 1; i < 4; i += 1) {
  const name = names[i]!;
  const piece = cropRegion(removed.image, grid[i]!.c.bbox, 4);
  const out = join(layersDir, `${name}.png`);
  writeFileSync(out, encodePng(piece));
  const dome = measureDome(piece);
  const k = K_ORIG * (origDome.domeW / dome.domeW);
  const targetH = piece.height * k;
  // mirrored placement: crown_local_x = AX - (crownCx - W/2) * k  =>  AX = crownLocalX + (crownCx - W/2) * k
  const ax = crownLocalX + (dome.crownCx - piece.width / 2) * k;
  const ay = crownLocalY - (dome.topY - piece.height / 2) * k;
  console.log(
    `${name}: ${piece.width}x${piece.height} dome top ${dome.topY} crownCx ${dome.crownCx.toFixed(0)} domeW ${dome.domeW}` +
    ` -> targetH ${targetH.toFixed(1)}, attach x ${ax.toFixed(1)}, y ${ay.toFixed(1)} (scaleX -1)`,
  );
}
console.log('done; add the printed transforms as head slot variants in author-gunner.mts and rebuild the gunner atlas');
