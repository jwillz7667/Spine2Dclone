import { execSync } from 'node:child_process';
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
  type Component,
  type DecodedImage,
} from './cut-core.mts';

// LUNA body regeneration: the original luna-parts torso is a 585x900 VERTICAL mannequin shape that
// reads wrong on a standing quadruped ("the cats body is not right"). This generates ONE sheet with
// a proper side-view HORIZONTAL cat torso plus four straight legs and the tail, style-matched to
// the character reference, and cuts it into source-layers/luna/.
//
// Sheet contract: top row torso (left) then tail (right); bottom row four legs left to right:
// front-near (white paw), front-far (shadowed), back-near (white paw + haunch), back-far (shadowed).
//
// Usage: tsx gen-luna-body.mts [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sheetPath = join(root, 'source-sheets', 'luna-body-parts.png');
const layersDir = join(root, 'source-layers', 'luna');
const force = process.argv.includes('--force');

function loadApiKey(): string {
  const envPath = join(root, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  const key = line
    ?.slice('GEMINI_API_KEY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (key === undefined || key.length === 0) throw new Error('GEMINI_API_KEY missing from .env');
  return key;
}

const MODELS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

async function generateSheet(): Promise<Buffer> {
  const apiKey = loadApiKey();
  const prompt = [
    'TEXTURE SPRITE SHEET for a game engine on a flat PURE WHITE background (#FFFFFF).',
    'The attached reference image shows LUNA, a sleek cartoon dark-navy cat standing in side view',
    'facing LEFT. Draw SIX SEPARATE BODY PARTS for that exact cat, matching its dark navy fur,',
    'lighter navy belly shading, dark outline weight and clean cartoon style EXACTLY.',
    'TOP ROW, two parts side by side:',
    '1) Top-left: the TORSO ONLY as one smooth HORIZONTAL side-view body mass from the chest to',
    'the rear haunches, clearly WIDER than it is tall, gently arched back on top, smooth slightly',
    'rounded belly at the bottom, chest end on the LEFT with a soft white fur chest patch,',
    'rounded rear haunch on the RIGHT. NO head, NO neck, NO legs, NO tail, NO face on this part.',
    '2) Top-right: one LONG CURVED CAT TAIL, thick at its base (bottom-left end) tapering to a',
    'rounded tip, curving upward like the reference.',
    'BOTTOM ROW, four parts side by side, each a STRAIGHT VERTICAL cat leg with the paw at the',
    'bottom, matching the reference legs:',
    '3) Bottom row 1st (leftmost): near FRONT leg, slim and straight, dark navy, WHITE paw.',
    '4) Bottom row 2nd: far FRONT leg, same shape but a uniformly DARKER shadowed navy, dark paw.',
    '5) Bottom row 3rd: near BACK leg, WHITE paw, with the wide rounded thigh/haunch bulge at the',
    'TOP tapering to a slim straight lower leg.',
    '6) Bottom row 4th (rightmost): far BACK leg, same shape as the near back leg but uniformly',
    'DARKER shadowed navy, dark paw.',
    'All four legs the same height and clearly TALLER than they are wide. Every part fully',
    'separated from its neighbors by empty white background, nothing touching, nothing overlapping,',
    'nothing touching the image border.',
    'ABSOLUTELY NO TEXT anywhere: no words, letters, numbers, labels or captions.',
  ].join(' ');
  // the .png-cache copy is the decode-safe real PNG (the raw sheet is JPEG bytes named .png)
  const refChar = readFileSync(join(root, 'source-sheets', '.png-cache', 'luna-ref.png')).toString(
    'base64',
  );
  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: refChar } }],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
    },
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
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string } }> };
          finishReason?: string;
        }>;
      };
      const image = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
        ?.inlineData?.data;
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
  console.log('generating luna-body-parts sheet...');
  const png = await generateSheet();
  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, png);
  console.log(`-> ${sheetPath}`);
} else {
  console.log('sheet exists, skipping generation (use --force to re-roll)');
}

// Gemini returns JPEG bytes despite the .png name; normalize with sips when pngjs rejects it.
function decodeSheet(path: string): DecodedImage {
  try {
    return decodePng(readFileSync(path));
  } catch {
    const tmp = `${path}.tmp.png`;
    execSync(`sips -s format png '${path}' --out '${tmp}' && mv '${tmp}' '${path}'`);
    return decodePng(readFileSync(path));
  }
}

// ---- cut the six parts -----------------------------------------------------------------------------
const sheet = decodeSheet(sheetPath);
const removed = removeBackground(sheet, DEFAULT_WHITE_FLOOD);
const comps = mergeAndFilter(
  labelComponents(sheet.width, sheet.height, removed.foreground),
  24,
  900,
);
if (comps.length !== 6) {
  console.log(
    `expected 6 components, found ${comps.length}: re-roll the sheet (--force) or adjust merge params`,
  );
  for (const c of comps)
    console.log(
      `  comp n=${c.area} bbox x[${c.bbox.minX}..${c.bbox.maxX}] y[${c.bbox.minY}..${c.bbox.maxY}]`,
    );
  process.exit(1);
}
// sheet contract: top row = torso, tail (by cx); bottom row = the four legs left to right
const cells = comps
  .map((c) => ({ c, cx: (c.bbox.minX + c.bbox.maxX) / 2, cy: (c.bbox.minY + c.bbox.maxY) / 2 }))
  .sort((a, b) => a.cy - b.cy);
const topRow = cells.slice(0, 2).sort((a, b) => a.cx - b.cx);
const legRow = cells.slice(2).sort((a, b) => a.cx - b.cx);
const assignment: Array<{ name: string; comp: Component }> = [
  { name: 'torso', comp: topRow[0]!.c },
  { name: 'tail', comp: topRow[1]!.c },
  { name: 'leg-front-near', comp: legRow[0]!.c },
  { name: 'leg-front-far', comp: legRow[1]!.c },
  { name: 'leg-back-near', comp: legRow[2]!.c },
  { name: 'leg-back-far', comp: legRow[3]!.c },
];

// per-piece stats that drive the rig transforms: dims, aspect, white-paw check (white pixels in
// the bottom quarter), mean luminance (near legs read lighter than the shadowed far legs)
function stats(img: DecodedImage): { whitePawPct: number; meanLum: number } {
  const { width: W, height: H, rgba } = img;
  let white = 0;
  let bottom = 0;
  let lumSum = 0;
  let n = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      if (rgba[o + 3]! <= 128) continue;
      const lum = (rgba[o]! + rgba[o + 1]! + rgba[o + 2]!) / 3;
      lumSum += lum;
      n += 1;
      if (y >= H * 0.75) {
        bottom += 1;
        if (lum > 200) white += 1;
      }
    }
  }
  return { whitePawPct: bottom > 0 ? (100 * white) / bottom : 0, meanLum: n > 0 ? lumSum / n : 0 };
}

let shapeOk = true;
for (const { name, comp } of assignment) {
  const piece = cropRegion(removed.image, comp.bbox, 4);
  writeFileSync(join(layersDir, `${name}.png`), encodePng(piece));
  const { whitePawPct, meanLum } = stats(piece);
  const aspect = piece.width / piece.height;
  console.log(
    `${name}: ${piece.width}x${piece.height} aspect ${aspect.toFixed(2)}` +
      ` whitePaw ${whitePawPct.toFixed(0)}% lum ${meanLum.toFixed(0)}`,
  );
  if (name === 'torso' && aspect <= 1.15) {
    console.log('  WARNING: torso is not clearly horizontal (aspect <= 1.15)');
    shapeOk = false;
  }
  if (name.startsWith('leg') && aspect >= 0.9) {
    console.log('  WARNING: leg is not clearly vertical (aspect >= 0.9)');
    shapeOk = false;
  }
}
if (!shapeOk) {
  console.log('shape sanity failed: re-roll with --force rather than rigging bad art');
  process.exit(1);
}
console.log(
  'done; VIEW each cut piece, then update the body transforms in author-luna.mts and rebuild the luna atlas',
);
