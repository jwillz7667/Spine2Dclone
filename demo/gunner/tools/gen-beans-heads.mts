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

// BEANS head expression variants, same approved pattern as gen-head-variants.mts (Gunner) and
// gen-luna-heads.mts (Luna): pasted mouth overlays read as stickers and the separate giant ear
// pieces never sit right on the dome (user complaint, twice), so the mouth states are FULL
// REPLACEMENT HEADS with the enormous chihuahua ears baked in. Generates ONE 2x2 sheet of the
// exact same head via Gemini (chained to the current cut head piece and the full-character
// reference so the skull stays on-model), cuts it, and nose-registers every head against the
// rig's canonical nose anchor so the head slot can swap attachments without the face moving.
//
// Grid contract: top-left closed gentle smile (replaces head.png), top-right small open talking
// mouth (head-talk), bottom-left huge wide-open bark with tongue (head-bark), bottom-right
// worried wavy frown (head-worried).
//
// Usage: tsx gen-beans-heads.mts [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sheetPath = join(root, 'source-sheets', 'beans-head-variants.png');
const layersDir = join(root, 'source-layers', 'beans');
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
    'The first attached reference image is a cartoon chihuahua puppy HEAD game sprite (the bare',
    'round skull, no ears yet); the second shows the full character it belongs to: BEANS, a tiny',
    'cream/fawn chihuahua with ENORMOUS upright ears. Draw a 2x2 grid containing FOUR COPIES OF',
    'EXACTLY THAT SAME HEAD: identical cream fur, round skull shape, the darker fawn patches',
    'around both eye areas and on the muzzle, same palette, same dark chocolate outline weight,',
    'same size, matching the full-character reference exactly.',
    'ADD THE EARS: the two ENORMOUS upright chihuahua ears with soft pink inners, rooted WIDE',
    'APART at the top of the skull and flaring up and outward exactly where the full-character',
    'reference places them; they are more than half the height of the head. The ears must be',
    'IDENTICAL in shape, size and placement in all four cells.',
    'ADD THE NOSE: every cell has the same small dark-chocolate rounded nose on the muzzle patch.',
    'The ONLY thing that changes between the four copies is the MOUTH under that nose; everything',
    'else stays pixel-identical across cells.',
    'Top-left: mouth closed with a tiny gentle smile line, like the reference.',
    'Top-right: mouth slightly open mid-word, small open talking mouth with the jaw a little',
    'dropped.',
    'Bottom-left: HUGE wide-open barking mouth, jaw dropped as far as it goes, pink tongue',
    'visible inside.',
    'Bottom-right: worried wavy frown, a wobbly anxious squiggle mouth, closed.',
    'CRITICAL, match the first reference exactly on this point: NO eyes in any cell (the eye',
    'areas are blank darker-fawn fur patches, eyeballs are composited separately by the engine).',
    'NO neck, NO body, NO collar, head with ears only.',
    'Each head fully separated from its neighbors by empty white background, nothing touching,',
    'nothing overlapping, nothing touching the image border. Identical head size and position in',
    'all four cells. ABSOLUTELY NO TEXT anywhere: no words, letters, numbers, labels or captions.',
  ].join(' ');
  const refHead = readFileSync(join(layersDir, 'head.png')).toString('base64');
  // the .png-cache copy is the decode-safe real PNG (the raw sheet is JPEG bytes named .png)
  const refChar = readFileSync(join(root, 'source-sheets', '.png-cache', 'beans-ref.png')).toString(
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
  console.log('generating beans-head-variants sheet...');
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
const names = ['head', 'head-talk', 'head-bark', 'head-worried'];
const grid = [rows[0]![0]!, rows[0]![1]!, rows[1]![0]!, rows[1]![1]!];

// ---- nose registration ----------------------------------------------------------------------------
// Registration pins the NOSE for position and the CHEEK-TO-CHEEK opaque row width at the nose row
// for scale (a wide, mouth-state-stable baseline; the raw nose bbox varies ~5% between Gemini
// cells, enough to make the skull visibly pulse on mouth swaps). Canonical anchors were measured
// from the ORIGINAL earless head.png (815x812 file, 804x801 trim, attachment x -5, y -35,
// targetH 81) with these same measurement functions BEFORE it was replaced: the mouth plates
// pinned their drawn nose at head-local (-19, -17.5) (author-beans.mts), and the original head's
// opaque row width at that nose row is 767.1 piece px * (81/801) = 77.58 rig px.
const NOSE_LOCAL_X = -19;
const NOSE_LOCAL_Y = -17.5;
const CHEEK_DISPLAY_W = 77.58;
const ERODE_RAD = 9;

// The nose is the topmost large SOLID dark-chocolate mass in the LOWER 40..100% of the piece
// (outline strokes are thinner than the erosion box and drop out; the lower-half gate drops the
// ear outlines; picking the topmost surviving blob drops the bark mouth interior, which sits
// below the nose). The threshold is looser than Gunner's (r<160 vs r<135) because Beans' nose
// carries a lighter warm-brown highlight lobe that must count as nose mass, and the erosion
// radius is smaller because his nose is proportionally smaller on the piece.
interface NoseInfo {
  cx: number;
  cy: number;
  w: number;
}
function measureNose(img: DecodedImage): NoseInfo {
  const { width: W, height: H, rgba } = img;
  const dark = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    return rgba[i + 3]! > 128 && rgba[i]! < 160 && rgba[i + 1]! < 115 && rgba[i + 2]! < 115;
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
  for (let ys = Math.floor(H * 0.4); ys < H; ys += 2) {
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
        for (const [dx, dy] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < Math.floor(H * 0.4) || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni] === 1 || !solid(nx, ny)) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (n < 200) continue; // grid-sampled count (step 2), so ~800 full pixels
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

interface Reg {
  readonly nose: NoseInfo;
  readonly cheekW: number;
  readonly k: number; // rig px per piece px
  readonly ax: number;
  readonly ay: number;
}
function register(piece: DecodedImage): Reg {
  const nose = measureNose(piece);
  const cheekW = rowWidthAt(piece, nose.cy);
  const k = CHEEK_DISPLAY_W / cheekW;
  // unmirrored placement (the piece faces left like the rig): nose_local = AX + (noseCx - W/2) * k
  const ax = NOSE_LOCAL_X - (nose.cx - piece.width / 2) * k;
  const ay = NOSE_LOCAL_Y - (nose.cy - piece.height / 2) * k;
  return { nose, cheekW, k, ax, ay };
}

// ---- ear-consistency composite --------------------------------------------------------------------
// Gemini reliably keeps the SKULL identical across cells (nose+cheek registration pins it to a
// fraction of a rig px) but redraws the EARS a little on open-jaw cells (measured ~16 rig px
// shorter ear tips on the bark cell across re-rolls). Swapping such a head would read as ear
// flutter on every wide lip-sync frame, the exact artifact this pipeline exists to kill. So each
// variant keeps only its MOUTH: in registered display space, everything above a seam just over
// the nose top comes verbatim from the base head (skull, ears, eye patches pixel-identical), and
// everything below it (nose, muzzle sides, jaw) comes from the variant, with a short linear blend
// band across flat cheek fur where the two registered skulls differ by under a pixel.
const SEAM_DISPLAY_Y = -29; // head-local, ~4 px above the nose top, below the eye patch mass
const BLEND_BAND = 6; // display px
// The giant ear lobes hang past the seam at the far left/right, where the variant has nothing
// (its ears differ, that is the whole point), so the variant is also gated horizontally: full
// strength only inside the skull cheeks while ears can still overlap, unrestricted below the
// lowest ear-lobe pixel. Bounds in head-local display px, measured on the registered base head.
const EAR_CLEAR_Y = -21; // ear lobes end ~display y -24; below -21 the row is jaw-only
const FACE_X_FULL: readonly [number, number] = [-52, 14]; // inside the cheek outline (-57.8..19.7)
const FACE_X_RAMP = 8;
function composeOnBase(
  base: DecodedImage,
  baseReg: Reg,
  variant: DecodedImage,
  varReg: Reg,
): DecodedImage {
  const kB = baseReg.k;
  const kV = varReg.k;
  // extend the base canvas downward so a dropped jaw fits (display-space bottoms compared)
  const baseBottom = baseReg.ay + (base.height / 2) * kB;
  const varBottom = varReg.ay + (variant.height / 2) * kV;
  const pad = Math.max(0, Math.ceil((varBottom - baseBottom) / kB) + 4);
  const W = base.width;
  const H = base.height + pad;
  const out = new Uint8Array(W * H * 4);
  const sampleVar = (px: number, py: number, c: number): number => {
    // bilinear, straight alpha; outside the variant reads transparent
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    let acc = 0;
    for (const [dx, dy, w] of [
      [0, 0, (1 - fx) * (1 - fy)],
      [1, 0, fx * (1 - fy)],
      [0, 1, (1 - fx) * fy],
      [1, 1, fx * fy],
    ] as const) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= variant.width || y >= variant.height) continue;
      acc += variant.rgba[(y * variant.width + x) * 4 + c]! * w;
    }
    return acc;
  };
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  for (let y = 0; y < H; y += 1) {
    const dy = baseReg.ay + (y - base.height / 2) * kB; // display y of this base-frame row
    const tRow = clamp01((dy - (SEAM_DISPLAY_Y - BLEND_BAND / 2)) / BLEND_BAND);
    const vy = variant.height / 2 + (dy - varReg.ay) / kV;
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      const dx = baseReg.ax + (x - W / 2) * kB;
      const gx =
        dy > EAR_CLEAR_Y
          ? 1
          : Math.min(
              clamp01((dx - (FACE_X_FULL[0] - FACE_X_RAMP)) / FACE_X_RAMP),
              clamp01((FACE_X_FULL[1] + FACE_X_RAMP - dx) / FACE_X_RAMP),
            );
      const t = tRow * gx;
      const vx = variant.width / 2 + (dx - varReg.ax) / kV;
      for (let c = 0; c < 4; c += 1) {
        const b = y < base.height ? base.rgba[(y * W + x) * 4 + c]! : 0;
        const v = t > 0 ? sampleVar(vx, vy, c) : 0;
        out[o + c] = Math.round(b * (1 - t) + v * t);
      }
    }
  }
  return { width: W, height: H, rgba: out };
}

const cut = grid.map((g) => cropRegion(removed.image, g.c.bbox, 4));
const baseReg = register(cut[0]!);
const finals: DecodedImage[] = [cut[0]!];
for (let i = 1; i < 4; i += 1) {
  const composed = composeOnBase(cut[0]!, baseReg, cut[i]!, register(cut[i]!));
  // re-crop so the extended canvas trims to the composed art
  const fg = new Uint8Array(composed.width * composed.height);
  for (let p = 0; p < fg.length; p += 1) fg[p] = composed.rgba[p * 4 + 3]! >= 24 ? 1 : 0;
  const compComps = mergeAndFilter(labelComponents(composed.width, composed.height, fg), 24, 900);
  const bbox = compComps.reduce(
    (acc, c) => ({
      minX: Math.min(acc.minX, c.bbox.minX),
      minY: Math.min(acc.minY, c.bbox.minY),
      maxX: Math.max(acc.maxX, c.bbox.maxX),
      maxY: Math.max(acc.maxY, c.bbox.maxY),
    }),
    compComps[0]!.bbox,
  );
  finals.push(cropRegion(composed, bbox, 4));
}

for (let i = 0; i < 4; i += 1) {
  const name = names[i]!;
  const piece = finals[i]!;
  writeFileSync(join(layersDir, `${name}.png`), encodePng(piece));
  const reg = register(piece);
  const targetH = piece.height * reg.k;
  const pctDown = (100 * reg.nose.cy) / piece.height;
  console.log(
    `${name}: ${piece.width}x${piece.height} nose (${reg.nose.cx.toFixed(0)}, ${reg.nose.cy.toFixed(0)})` +
      ` ${pctDown.toFixed(0)}% down cheek w ${reg.cheekW.toFixed(0)}` +
      ` -> targetH ${targetH.toFixed(1)}, attach x ${reg.ax.toFixed(1)}, y ${reg.ay.toFixed(1)}`,
  );
  if (pctDown < 50 || pctDown > 85) {
    console.log(
      `  WARNING: nose sits ${pctDown.toFixed(0)}% down (expected ~55-80%); verify the blob is the nose`,
    );
  }
}
console.log(
  'done; update the head slot transforms in author-beans.mts and rebuild the beans atlas',
);
