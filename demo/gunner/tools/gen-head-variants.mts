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
// mouth states are baked into full replacement heads instead (user direction). The EARS are baked
// in too (second user direction): they do not need independent motion, and separate ear pieces
// never sit quite right on the dome. Generates ONE 2x2 sheet of the exact same head, ears on,
// with four mouth states via Gemini (chained to the assembled character reference and the cut
// head piece so the skull stays on-model), cuts it, and nose-registers every head against the
// rig's canonical nose anchor so the head slot can swap attachments without the face moving.
//
// Grid contract: top-left closed (replaces head.png), top-right talking (head-talk),
// bottom-left wide bark (head-wide), bottom-right grit (head-grit).
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
    'The first attached reference image is a cartoon dog head game sprite; the second shows the',
    'full character it belongs to. Draw a 2x2 grid containing FOUR COPIES OF EXACTLY THAT SAME',
    'HEAD: identical breed, angle, proportions, palette, white blaze, outline weight and size.',
    'ADD THE EARS: both small cropped pointy ears standing upright, rooted WIDE APART on top of',
    'the skull directly above each eye socket, exactly where the full-character reference places',
    'them, near ear showing its pink inner, far ear showing its brown back. The ears must be',
    'IDENTICAL in shape, size and placement in all four cells.',
    'The ONLY thing that changes between the four copies is the MOUTH state; everything else',
    'stays pixel-identical across cells.',
    'Top-left: mouth closed with the same gentle smile as the reference head.',
    'Top-right: mouth slightly open mid-word, small talking mouth with the jaw a little dropped.',
    'Bottom-left: mouth wide open in a joyful shout, big open jaw, pink tongue visible.',
    'Bottom-right: determined clenched teeth grin, gritted white teeth showing.',
    'CRITICAL, match the reference head exactly on this point: NO eyes (the eye area is blank',
    'fur, eyes are composited separately by the engine). NO neck, NO body, head and ears only.',
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
const names = ['head', 'head-talk', 'head-wide', 'head-grit'];
const grid = [rows[0]![0]!, rows[0]![1]!, rows[1]![0]!, rows[1]![1]!];

// ---- nose registration ----------------------------------------------------------------------------
// With ears baked in, the dome top is ear tips (jaw- and roll-sensitive), so registration pins the
// NOSE for position and the CHEEK-TO-CHEEK row width at the nose row for scale (a ~1400px baseline,
// so measurement noise stays under 1%; the raw nose bbox varies ~5% between cells, enough to make
// the skull visibly pulse on mouth swaps). Canonical anchors come from the ORIGINAL earless head
// (gunner-body-parts piece-01, 1394x1357, slot center (-25,-20) targetH 250 scaleX -1) measured
// with these same functions: nose centroid at mirrored head-local (-72.6, -4.1), cheek row width
// 1385.1 piece px * (250/1357) = 255.2 rig px.
const NOSE_LOCAL_X = -72.6;
const NOSE_LOCAL_Y = -4.1;
const CHEEK_DISPLAY_W = 255.2;
const ERODE_RAD = 12;

// The nose is the only large SOLID dark mass (outline strokes are thin, so an eroded dark mask
// keeps the nose and drops the stroke network even where the smile line connects nose to outline).
interface NoseInfo { cx: number; cy: number; w: number }
function measureNose(img: DecodedImage): NoseInfo {
  const { width: W, height: H, rgba } = img;
  const dark = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    return rgba[i + 3]! > 128 && rgba[i]! < 135 && rgba[i + 1]! < 105 && rgba[i + 2]! < 105;
  };
  const solid = (x: number, y: number): boolean => {
    for (let dy = -ERODE_RAD; dy <= ERODE_RAD; dy += 3) {
      for (let dx = -ERODE_RAD; dx <= ERODE_RAD; dx += 3) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H || !dark(px, py)) return false;
      }
    }
    return true;
  };
  const seen = new Uint8Array(W * H);
  let best: { n: number; sx: number; sy: number; x0: number; x1: number; y0: number } | null = null;
  for (let ys = 0; ys < H; ys += 2) {
    for (let xs = 0; xs < W; xs += 2) {
      if (seen[ys * W + xs] === 1 || !solid(xs, ys)) continue;
      const queue: number[] = [ys * W + xs];
      seen[ys * W + xs] = 1;
      let n = 0;
      let sx = 0;
      let sy = 0;
      let bx0 = xs;
      let bx1 = xs;
      let by0 = ys;
      while (queue.length > 0) {
        const idx = queue.pop()!;
        const x = idx % W;
        const y = (idx - x) / W;
        n += 1;
        sx += x;
        sy += y;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni] === 1 || !solid(nx, ny)) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (n < 400) continue; // grid-sampled count (step 2), so ~1600 full pixels
      if (best === null || by0 < best.y0) best = { n, sx, sy, x0: bx0, x1: bx1, y0: by0 };
    }
  }
  if (best === null) throw new Error('no nose blob found');
  // dilation compensation: the eroded bbox is ~ERODE_RAD smaller on each side
  return { cx: best.sx / best.n, cy: best.sy / best.n, w: best.x1 - best.x0 + 1 + 2 * ERODE_RAD };
}

// cheek-to-cheek opaque row width at the nose row (averaged over +-6 rows); the jaw hinges below
// the nose, so this width is stable across all four mouth states and ignores the ears entirely
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
  // mirrored placement: nose_local = AX - (noseCx - W/2) * k  =>  AX = noseLocal + (noseCx - W/2) * k
  const ax = NOSE_LOCAL_X + (nose.cx - piece.width / 2) * k;
  const ay = NOSE_LOCAL_Y - (nose.cy - piece.height / 2) * k;
  console.log(
    `${name}: ${piece.width}x${piece.height} nose (${nose.cx.toFixed(0)}, ${nose.cy.toFixed(0)}) cheek w ${cheekW.toFixed(0)}` +
    ` -> targetH ${targetH.toFixed(1)}, attach x ${ax.toFixed(1)}, y ${ay.toFixed(1)} (scaleX -1)`,
  );
}
console.log('done; update the head slot transforms in author-gunner.mts and rebuild the gunner atlas');
