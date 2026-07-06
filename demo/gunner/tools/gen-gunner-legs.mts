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

// GUNNER leg regeneration: the original legs are bare columns with no shoulder/thigh mass, cut to
// hide UNDER the torso; at any pose they read as sticks poked into a loaf (user: "way too messed
// up... the legs should be layed on the outside of gunners body, just like beans"). This generates
// ONE 2x2 sheet of four COMPLETE bully limbs, each including its drawn shoulder or haunch mass at
// the top, so the near legs can draw ON TOP of the torso the way Beans' do.
//
// Sheet contract: top row front-near (fawn, white paw), front-far (darker); bottom row back-near
// (fawn, white paw, haunch top), back-far (darker). All legs face RIGHT like every gunner piece
// (the rig mirrors with scaleX -1).
//
// Usage: tsx gen-gunner-legs.mts [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sheetPath = join(root, 'source-sheets', 'gunner-leg-parts.png');
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
    'The attached reference image shows GUNNER, a stocky fawn-tan cartoon pocket bully dog with a',
    'white chest and white paws, standing in side view facing RIGHT. Draw a 2x2 grid of FOUR',
    'SEPARATE COMPLETE LEGS for that exact dog, matching its warm fawn-tan fur, cream-white paws,',
    'dark chocolate outline weight and clean cartoon style EXACTLY. Every leg is one COMPLETE limb',
    'in side view including the muscle mass at its top, thick and powerfully muscled like a pocket',
    'bully, clearly TALLER than wide, paw at the bottom with drawn toes, toes pointing RIGHT.',
    'Top-left: the NEAR FRONT leg: a broad rounded SHOULDER muscle mass at the top flowing into a',
    'thick straight foreleg, fawn-tan, WHITE paw.',
    'Top-right: the FAR front leg: identical shape, every part a uniformly DARKER shadowed tan,',
    'darker tan paw.',
    'Bottom-left: the NEAR HIND leg: a big rounded THIGH/HAUNCH mass at the top, hock bending',
    'slightly rearward, fawn-tan, WHITE paw.',
    'Bottom-right: the FAR hind leg: identical shape, every part a uniformly DARKER shadowed tan,',
    'darker tan paw.',
    'The two front legs must be IDENTICAL in shape and size to each other; the two hind legs must',
    'be IDENTICAL in shape and size to each other. NO body, NO head, NO tail, legs only.',
    'Each leg fully separated from its neighbors by empty white background, nothing touching,',
    'nothing overlapping, nothing touching the image border.',
    'ABSOLUTELY NO TEXT anywhere: no words, letters, numbers, labels or captions.',
  ].join(' ');
  const refChar = readFileSync(join(root, 'source-sheets', '.png-cache', 'gunner-ref.png')).toString('base64');
  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
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
  console.log('generating gunner-leg-parts sheet...');
  const png = await generateSheet();
  mkdirSync(dirname(sheetPath), { recursive: true });
  writeFileSync(sheetPath, png);
  console.log(`-> ${sheetPath}`);
} else {
  console.log('sheet exists, skipping generation (use --force to re-roll)');
}

function decodeSheet(path: string): DecodedImage {
  try {
    return decodePng(readFileSync(path));
  } catch {
    const tmp = `${path}.tmp.png`;
    execSync(`sips -s format png '${path}' --out '${tmp}' && mv '${tmp}' '${path}'`);
    return decodePng(readFileSync(path));
  }
}

// ---- cut the four legs -----------------------------------------------------------------------------
const sheet = decodeSheet(sheetPath);
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
const assignment: Array<{ name: string; comp: Component; boneWorldY: number }> = [
  // bone world y = torso world (0,-175) + bone torso-local offset (author-gunner.mts)
  { name: 'leg-front-near', comp: rows[0]![0]!.c, boneWorldY: -105 },
  { name: 'leg-front-far', comp: rows[0]![1]!.c, boneWorldY: -113 },
  { name: 'leg-back-near', comp: rows[1]![0]!.c, boneWorldY: -130 },
  { name: 'leg-back-far', comp: rows[1]![1]!.c, boneWorldY: -127 },
];

// The pivot belongs at the centroid of the drawn shoulder/thigh mass (top ~26% of alpha rows);
// the paw bottom lands on the ground (world y 0). Solving both pins the whole transform:
// targetH = |boneY| / (bottomFrac - thighFrac), attachY = targetH * (0.5 - thighFrac), and the
// mirrored attachX puts the pivot on the thigh centroid column.
function measure(img: DecodedImage): { thighCx: number; thighFrac: number; bottomFrac: number } {
  const { width: W, height: H, rgba } = img;
  const opaque = (x: number, y: number): boolean => rgba[(y * W + x) * 4 + 3]! > 128;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (opaque(x, y)) {
        if (top < 0) top = y;
        bottom = y;
        break;
      }
    }
  }
  const bandEnd = top + (bottom - top) * 0.26;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = top; y <= bandEnd; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!opaque(x, y)) continue;
      sx += x;
      sy += y;
      n += 1;
    }
  }
  return { thighCx: sx / Math.max(1, n), thighFrac: sy / Math.max(1, n) / H, bottomFrac: (bottom + 1) / H };
}

let shapeOk = true;
for (const { name, comp, boneWorldY } of assignment) {
  const piece = cropRegion(removed.image, comp.bbox, 4);
  writeFileSync(join(layersDir, `${name}.png`), encodePng(piece));
  const aspect = piece.width / piece.height;
  const { thighCx, thighFrac, bottomFrac } = measure(piece);
  const targetH = -boneWorldY / (bottomFrac - thighFrac);
  const k = targetH / piece.height;
  const attachY = targetH * (0.5 - thighFrac);
  const attachX = (thighCx - piece.width / 2) * k; // mirrored placement (scaleX -1)
  console.log(
    `${name}: ${piece.width}x${piece.height} aspect ${aspect.toFixed(2)} thigh (${thighCx.toFixed(0)}, ${(thighFrac * 100).toFixed(0)}%)` +
    ` -> targetH ${targetH.toFixed(1)}, attach x ${attachX.toFixed(1)}, y ${attachY.toFixed(1)} (scaleX -1)`,
  );
  if (aspect >= 0.95) {
    console.log('  WARNING: leg is not clearly vertical (aspect >= 0.95)');
    shapeOk = false;
  }
}
if (!shapeOk) {
  console.log('shape sanity failed: re-roll with --force rather than rigging bad art');
  process.exit(1);
}
console.log('done; VIEW each piece, update the leg transforms + draw order in author-gunner.mts, rebuild the gunner atlas');
