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
  type DecodedImage,
} from './cut-core.mts';

// LUNA head expression variants, same approved pattern as gen-head-variants.mts (Gunner): pasted
// mouth overlays read as stickers and separate ear/goggle pieces never sit right, so the mouth
// states are FULL REPLACEMENT HEADS with the ears AND the aviator goggles baked in. Generates ONE
// 2x2 sheet of the exact same cat head via Gemini (chained to the current cut head piece and the
// full-character reference so the skull stays on-model), cuts it, and nose-registers every head
// against the rig's canonical nose anchor so the head slot can swap attachments without the face
// moving.
//
// Grid contract: top-left closed content smile (replaces head.png), top-right small talking mouth
// (head-talk), bottom-left big happy open smile (head-smile), bottom-right surprised o-mouth
// (head-oo).
//
// Usage: tsx gen-luna-heads.mts [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sheetPath = join(root, 'source-sheets', 'luna-head-variants.png');
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
    'The first attached reference image is a cartoon black cat HEAD game sprite (the bare skull',
    'shape); the second shows the full character it belongs to: LUNA, a sleek dark-navy cat',
    'inventor with brass aviator goggles. Draw a 2x2 grid containing FOUR COPIES OF EXACTLY THAT',
    'SAME HEAD: identical dark navy fur, angle, proportions, palette, dark outline weight and size,',
    'matching the full-character reference exactly. Each head must include, identical in all four',
    'cells: both pointy cat ears with dusty-pink inners rooted WIDE APART on top of the skull,',
    'the brass-rimmed aviator goggles with pale blue lenses resting ABOVE the forehead at the ear',
    'line exactly like the reference, a small PINK triangle nose, and a soft gray-blue muzzle',
    'around the nose and mouth.',
    'The ONLY thing that changes between the four copies is the MOUTH state; everything else',
    'stays pixel-identical across cells.',
    'Top-left: mouth closed with the same small content smile as the reference.',
    'Top-right: mouth slightly open mid-word, small open talking mouth, jaw a little dropped.',
    'Bottom-left: big happy open smile, wide open mouth with tiny white teeth and pink tongue.',
    'Bottom-right: small surprised round o-shaped mouth.',
    'CRITICAL: NO eyes in any cell (the eye area is blank navy fur, eyes are composited separately',
    'by the engine). NO neck, NO body, head with ears and goggles only.',
    'Each head fully separated from its neighbors by empty white background, nothing touching,',
    'nothing overlapping, nothing touching the image border. Identical head size in all four cells.',
    'ABSOLUTELY NO TEXT anywhere: no words, letters, numbers, labels or captions.',
  ].join(' ');
  const refHead = readFileSync(join(layersDir, 'head.png')).toString('base64');
  // the .png-cache copy is the decode-safe real PNG (the raw sheet is JPEG bytes named .png)
  const refChar = readFileSync(join(root, 'source-sheets', '.png-cache', 'luna-ref.png')).toString(
    'base64',
  );
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
  console.log('generating luna-head-variants sheet...');
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

// ---- cut the four grid cells ---------------------------------------------------------------------
const sheet = decodeSheet(sheetPath);
const removed = removeBackground(sheet, DEFAULT_WHITE_FLOOD);
const comps = mergeAndFilter(
  labelComponents(sheet.width, sheet.height, removed.foreground),
  24,
  900,
);
if (comps.length !== 4) {
  console.log(
    `expected 4 components, found ${comps.length}: re-roll the sheet (--force) or adjust merge params`,
  );
  for (const c of comps)
    console.log(
      `  comp n=${c.area} bbox x[${c.bbox.minX}..${c.bbox.maxX}] y[${c.bbox.minY}..${c.bbox.maxY}]`,
    );
  process.exit(1);
}
const cells = comps
  .map((c) => ({ c, cx: (c.bbox.minX + c.bbox.maxX) / 2, cy: (c.bbox.minY + c.bbox.maxY) / 2 }))
  .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
const rows = [
  cells.slice(0, 2).sort((a, b) => a.cx - b.cx),
  cells.slice(2, 4).sort((a, b) => a.cx - b.cx),
];
const names = ['head', 'head-talk', 'head-smile', 'head-oo'];
const grid = [rows[0]![0]!, rows[0]![1]!, rows[1]![0]!, rows[1]![1]!];

// ---- nose registration ----------------------------------------------------------------------------
// Registration pins the NOSE for position and the CHEEK-TO-CHEEK opaque row width at the nose row
// for scale (a wide, mouth-state-stable baseline; the raw nose bbox varies ~5% between Gemini cells,
// enough to make the skull visibly pulse on mouth swaps). Canonical anchors were measured from the
// ORIGINAL pieces with these same measurement functions BEFORE they were replaced: the pink nose
// centroid of mouth-closed.png (507x391, nose (252.9, 118.7)) through its attachment (x -29, y -33,
// targetH 62) gives head-local nose (-29.1, -45.2); the old dome head.png (691x567, attachment
// x -6, y -60, targetH 130) has a 659.9 px opaque row at that nose row = 151.3 display px.
const NOSE_LOCAL_X = -29.1;
const NOSE_LOCAL_Y = -45.2;
const CHEEK_DISPLAY_W = 151.3;
const ERODE_RAD = 3;

// Luna's nose is the only large solid PINK mass in the face's lower half (rose family: strong
// red over green, blue over green excludes the brass goggles; the erosion drops thin outline
// strokes; the lower-half gate drops the dusty-pink ear inners at the top of the piece).
interface NoseInfo {
  cx: number;
  cy: number;
  w: number;
}
function measureNose(img: DecodedImage): NoseInfo {
  const { width: W, height: H, rgba } = img;
  const pink = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    return rgba[i + 3]! > 128 && r >= 150 && r - g >= 40 && b - g >= 10;
  };
  const solid = (x: number, y: number): boolean => {
    for (let dy = -ERODE_RAD; dy <= ERODE_RAD; dy += 1) {
      for (let dx = -ERODE_RAD; dx <= ERODE_RAD; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H || !pink(px, py)) return false;
      }
    }
    return true;
  };
  const seen = new Uint8Array(W * H);
  let best: { n: number; sx: number; sy: number; x0: number; x1: number } | null = null;
  for (let ys = Math.floor(H * 0.4); ys < H; ys += 1) {
    for (let xs = 0; xs < W; xs += 1) {
      if (seen[ys * W + xs] === 1 || !solid(xs, ys)) continue;
      const queue: number[] = [ys * W + xs];
      seen[ys * W + xs] = 1;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let bx0 = xs;
      let bx1 = xs;
      while (queue.length > 0) {
        const idx = queue.pop()!;
        const x = idx % W;
        const y = (idx - x) / W;
        n += 1;
        sx += x;
        sy += y;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni] === 1 || !solid(nx, ny)) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (n < 150) continue;
      if (best === null || n > best.n) best = { n, sx, sy, x0: bx0, x1: bx1 };
    }
  }
  if (best === null) throw new Error('no nose blob found');
  // dilation compensation: the eroded bbox is ~ERODE_RAD smaller on each side
  return { cx: best.sx / best.n, cy: best.sy / best.n, w: best.x1 - best.x0 + 1 + 2 * ERODE_RAD };
}

// cheek-to-cheek opaque row width at the nose row (averaged over +-6 rows); the jaw hinges below
// the nose, so this width is stable across all four mouth states and ignores the ears and goggles
function rowWidthAt(img: DecodedImage, cy: number): number {
  const { width: W, height: H, rgba } = img;
  let sum = 0;
  let n = 0;
  for (let y = Math.max(0, Math.round(cy) - 6); y <= Math.min(H - 1, Math.round(cy) + 6); y += 2) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < W; x += 1) {
      if (rgba[(y * W + x) * 4 + 3]! > 128) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 >= 0) {
      sum += x1 - x0 + 1;
      n += 1;
    }
  }
  return sum / Math.max(1, n);
}

for (let i = 0; i < 4; i += 1) {
  const name = names[i]!;
  const piece = cropRegion(removed.image, grid[i]!.c.bbox, 4);
  const out = join(layersDir, `${name}.png`);
  writeFileSync(out, encodePng(piece));
  const nose = measureNose(piece);
  const cheekW = rowWidthAt(piece, nose.cy);
  const k = CHEEK_DISPLAY_W / cheekW;
  const targetH = piece.height * k;
  // unmirrored placement (the piece faces left like the rig): nose_local = AX + (noseCx - W/2) * k
  const ax = NOSE_LOCAL_X - (nose.cx - piece.width / 2) * k;
  const ay = NOSE_LOCAL_Y - (nose.cy - piece.height / 2) * k;
  const pctDown = (100 * nose.cy) / piece.height;
  console.log(
    `${name}: ${piece.width}x${piece.height} nose (${nose.cx.toFixed(0)}, ${nose.cy.toFixed(0)})` +
      ` ${pctDown.toFixed(0)}% down cheek w ${cheekW.toFixed(0)}` +
      ` -> targetH ${targetH.toFixed(1)}, attach x ${ax.toFixed(1)}, y ${ay.toFixed(1)}`,
  );
  if (pctDown < 50 || pctDown > 80) {
    console.log(
      `  WARNING: nose sits ${pctDown.toFixed(0)}% down (expected ~55-75%); verify the blob is the nose`,
    );
  }
}
console.log('done; update the head slot transforms in author-luna.mts and rebuild the luna atlas');
