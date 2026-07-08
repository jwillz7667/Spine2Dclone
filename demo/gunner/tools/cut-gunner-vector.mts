import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, type DecodedImage } from './cut-core.mts';

// GUNNER from VECTOR source. The user supplied layered Illustrator exports: source-sheets/Gunner.svg
// (named groups: body, four legs, head with separate eye groups) plus source-sheets/SVG/face{2,3,4}.svg
// (the same skull redrawn with grit / small-talk / closed mouths, no eyes). Every Gunner.svg layer is
// rendered IN ISOLATION via headless Chrome, so all pieces share one document coordinate space and the
// attachment transforms are EXACT arithmetic, not alpha-blob heuristics. The face files live in their
// own coordinate spaces and are registered to the master skull with the proven nose-disc + cheek-row
// method (gen-head-variants.mts v3). Eye states (half/closed/happy/worried) are synthesized as vector
// overlays on the isolated eye render, so they stay on-model with the source art.
//
// Outputs: source-layers/gunner/*.png plus a transform block to paste into author-gunner.mts.
// Usage: tsx cut-gunner-vector.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const layersDir = join(root, 'source-layers', 'gunner');
const masterPath = join(root, 'source-sheets', 'Gunner.svg');
const facesDir = join(root, 'source-sheets', 'SVG');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const work = mkdtempSync(join(tmpdir(), 'gunner-vector-'));

// rig facing-left world: torso bone pinned at (0,-175) like every prior gunner build so all torso
// translate keys survive; the whole dog maps to the same standing height the raster rig had
const TOTAL_H = 407;
const TORSO_WORLD = { x: 0, y: -175 };

interface DocBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Rendered {
  img: DecodedImage;
  box: DocBox;
  scale: number;
}

function viewBoxOf(svg: string): DocBox {
  const m = svg.match(/viewBox="([\d. -]+)"/);
  if (m === null) throw new Error('no viewBox');
  const [x, y, w, h] = m[1]!.trim().split(/\s+/).map(Number);
  return { x0: x!, y0: y!, x1: x! + w!, y1: y! + h! };
}

let shot = 0;
function renderSvg(svgText: string, css: string, box: DocBox, scale: number): DecodedImage {
  const w = Math.ceil((box.x1 - box.x0) * scale);
  const h = Math.ceil((box.y1 - box.y0) * scale);
  const body = svgText
    .replace(/<\?xml[^>]*\?>\s*/, '')
    .replace(
      /viewBox="[^"]*"/,
      `viewBox="${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}" width="${w}" height="${h}"`,
    )
    .replace('<defs>', `<style>${css}</style><defs>`);
  const page = join(work, `shot-${shot}.html`);
  const out = join(work, `shot-${shot}.png`);
  shot += 1;
  writeFileSync(page, `<!doctype html><body style="margin:0">${body}</body>`);
  execSync(
    `"${CHROME}" --headless=new --screenshot="${out}" --window-size=${w},${h} ` +
      `--default-background-color=00000000 --hide-scrollbars "file://${page}" 2>/dev/null`,
  );
  return decodePng(readFileSync(out));
}

function alphaBox(img: DecodedImage): { x0: number; y0: number; x1: number; y1: number } {
  const { width: W, height: H, rgba } = img;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (rgba[(y * W + x) * 4 + 3]! > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('empty render');
  return { x0, y0, x1, y1 };
}

const PAD = 4;
function trimPad(img: DecodedImage): { piece: DecodedImage; x0: number; y0: number } {
  const b = alphaBox(img);
  const W = b.x1 - b.x0 + 1 + 2 * PAD;
  const H = b.y1 - b.y0 + 1 + 2 * PAD;
  const rgba = new Uint8Array(W * H * 4);
  for (let y = b.y0; y <= b.y1; y += 1) {
    const dst = ((y - b.y0 + PAD) * W + PAD) * 4;
    rgba.set(img.rgba.subarray((y * img.width + b.x0) * 4, (y * img.width + b.x1 + 1) * 4), dst);
  }
  return { piece: { width: W, height: H, rgba }, x0: b.x0 - PAD, y0: b.y0 - PAD };
}

// two-pass isolated render: cheap whole-document pass finds the layer's doc bbox, then a viewBox
// crop re-renders just that region at the piece's own target resolution
function renderPiece(svgText: string, css: string, docBox: DocBox, targetPx: number): Rendered {
  const probeScale = 820 / Math.max(docBox.x1 - docBox.x0, docBox.y1 - docBox.y0);
  const probe = trimPad(renderSvg(svgText, css, docBox, probeScale));
  const found: DocBox = {
    x0: docBox.x0 + (probe.x0 + PAD) / probeScale,
    y0: docBox.y0 + (probe.y0 + PAD) / probeScale,
    x1: docBox.x0 + (probe.x0 + probe.piece.width - PAD) / probeScale,
    y1: docBox.y0 + (probe.y0 + probe.piece.height - PAD) / probeScale,
  };
  const margin = 30;
  const crop: DocBox = {
    x0: Math.max(docBox.x0, found.x0 - margin),
    y0: Math.max(docBox.y0, found.y0 - margin),
    x1: Math.min(docBox.x1, found.x1 + margin),
    y1: Math.min(docBox.y1, found.y1 + margin),
  };
  const scale = targetPx / Math.max(crop.x1 - crop.x0, crop.y1 - crop.y0);
  const fine = trimPad(renderSvg(svgText, css, crop, scale));
  return {
    img: fine.piece,
    box: {
      x0: crop.x0 + fine.x0 / scale,
      y0: crop.y0 + fine.y0 / scale,
      x1: crop.x0 + (fine.x0 + fine.piece.width) / scale,
      y1: crop.y0 + (fine.y0 + fine.piece.height) / scale,
    },
    scale,
  };
}

// ---- master document pieces ------------------------------------------------------------------------
const master = readFileSync(masterPath, 'utf8');
const masterBox = viewBoxOf(master);
const TOP_LEVEL = [
  'left-back-leg',
  'body',
  'right-front-leg',
  'right-back-leg',
  'left-front-leg',
  'head',
];
const hideExcept = (...keep: string[]): string =>
  TOP_LEVEL.filter((id) => !keep.includes(id))
    .map((id) => `#${id}`)
    .join(',') + '{display:none}';
const HIDE_EYES = '#right_eye,#left-eye{display:none}';
// head-2 carries one path as a DIRECT child (43 paths, subgroups hold 42), so hide non-group
// children as well as the anonymous skull subgroups or the eye isolation includes a skull shape
const ONLY_EYES = '#head-2>g:not(#right_eye):not(#left-eye),#head-2>:not(g){display:none}';

interface PieceSpec {
  name: string;
  css: string;
  targetPx: number;
  save: boolean;
}
const specs: PieceSpec[] = [
  { name: 'leg-back-far', css: hideExcept('left-back-leg'), targetPx: 560, save: true },
  { name: 'leg-front-far', css: hideExcept('left-front-leg'), targetPx: 560, save: true },
  { name: 'leg-back-near', css: hideExcept('right-back-leg'), targetPx: 560, save: true },
  { name: 'leg-front-near', css: hideExcept('right-front-leg'), targetPx: 560, save: true },
  { name: 'torso', css: hideExcept('body'), targetPx: 1100, save: true },
  { name: 'head-wide', css: hideExcept('head') + HIDE_EYES, targetPx: 950, save: true },
  { name: 'eyes-open', css: hideExcept('head') + ONLY_EYES, targetPx: 430, save: false },
  {
    name: 'eye-near',
    css: hideExcept('head') + ONLY_EYES + '#left-eye{display:none}',
    targetPx: 260,
    save: false,
  },
  {
    name: 'eye-far',
    css: hideExcept('head') + ONLY_EYES + '#right_eye{display:none}',
    targetPx: 260,
    save: false,
  },
];
const rendered = new Map<string, Rendered>();
for (const spec of specs) {
  rendered.set(spec.name, renderPiece(master, spec.css, masterBox, spec.targetPx));
  const r = rendered.get(spec.name)!;
  console.log(
    `${spec.name}: ${r.img.width}x${r.img.height}px doc [${r.box.x0.toFixed(0)},${r.box.y0.toFixed(0)}]..` +
      `[${r.box.x1.toFixed(0)},${r.box.y1.toFixed(0)}]`,
  );
}

// ---- doc -> rig-world mapping ------------------------------------------------------------------------
// The rig faces LEFT and the art faces RIGHT, so X negates (and every attachment carries scaleX -1,
// which mirrors the texture about its center; the negated center plus the mirrored texture lands every
// drawn pixel exactly at the mirrored document position). Ground = deepest paw; height = whole dog.
const legNames = ['leg-back-far', 'leg-front-far', 'leg-back-near', 'leg-front-near'];
const groundY = Math.max(...legNames.map((n) => rendered.get(n)!.box.y1));
const allBoxes = [...rendered.values()].map((r) => r.box);
const topY = Math.min(...allBoxes.map((b) => b.y0));
const K = TOTAL_H / (groundY - topY);
const body = rendered.get('torso')!;
const anchorX = (body.box.x0 + body.box.x1) / 2;
const X = (docX: number): number => -(docX - anchorX) * K;
const Y = (docY: number): number => (docY - groundY) * K;
console.log(
  `\nmapping: ground doc y ${groundY.toFixed(0)}, top ${topY.toFixed(0)}, K ${K.toFixed(5)} world/doc px`,
);

const centerOf = (r: Rendered): { x: number; y: number } => ({
  x: X((r.box.x0 + r.box.x1) / 2),
  y: Y((r.box.y0 + r.box.y1) / 2),
});

// leg bone pivots sit at the centroid of the drawn shoulder/haunch mass (top 26% of alpha rows),
// same joint definition the raster legs used, so the existing gait keys swing about the same anatomy
function topBandCentroid(r: Rendered): { x: number; y: number } {
  const { width: W, height: H, rgba } = r.img;
  const rows: number[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (rgba[(y * W + x) * 4 + 3]! > 128) {
        rows.push(y);
        break;
      }
    }
  }
  const top = rows[0]!;
  const bandEnd = top + (rows[rows.length - 1]! - top) * 0.26;
  let sx = 0,
    sy = 0,
    n = 0;
  for (let y = top; y <= bandEnd; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (rgba[(y * W + x) * 4 + 3]! > 128) {
        sx += x;
        sy += y;
        n += 1;
      }
    }
  }
  return { x: X(r.box.x0 + sx / n / r.scale), y: Y(r.box.y0 + sy / n / r.scale) };
}

console.log('\n---- author-gunner.mts values ----');
const boneWorld = new Map<string, { x: number; y: number }>();
boneWorld.set('torso', TORSO_WORLD);
for (const n of legNames) {
  const w = topBandCentroid(rendered.get(n)!);
  boneWorld.set(n, w);
  console.log(
    `bone ${n}: torso-local (${(w.x - TORSO_WORLD.x).toFixed(1)}, ${(w.y - TORSO_WORLD.y).toFixed(1)})`,
  );
}
// head pivot at the neck joint, reproducing the raster rig's pivot geometry within the head bbox
// (41.5% from the rear edge, 62.8% down) so nod amplitudes read the same
const headR = rendered.get('head-wide')!;
const headPivot = {
  x: X(headR.box.x0 + 0.415 * (headR.box.x1 - headR.box.x0)),
  y: Y(headR.box.y0 + 0.628 * (headR.box.y1 - headR.box.y0)),
};
boneWorld.set('head', headPivot);
console.log(
  `bone head: torso-local (${(headPivot.x - TORSO_WORLD.x).toFixed(1)}, ${(headPivot.y - TORSO_WORLD.y).toFixed(1)})`,
);

function attachLine(piece: string, bone: string): { x: number; y: number; h: number } {
  const r = rendered.get(piece)!;
  const c = centerOf(r);
  const b = boneWorld.get(bone)!;
  const h = (r.box.y1 - r.box.y0) * K;
  console.log(
    `attach ${piece} on ${bone}: x ${(c.x - b.x).toFixed(1)}, y ${(c.y - b.y).toFixed(1)}, targetH ${h.toFixed(1)} (scaleX -1)`,
  );
  return { x: c.x - b.x, y: c.y - b.y, h };
}
for (const n of legNames) attachLine(n, n);
attachLine('torso', 'torso');
attachLine('head-wide', 'head');
const eyesT = attachLine('eyes-open', 'head');

// ---- face variant registration (nose disc + cheek row, gen-head-variants v3) -------------------------
const ERODE_RAD = 12;
function measureNose(img: DecodedImage): { cx: number; cy: number } {
  const { width: W, height: H, rgba } = img;
  const dark = (x: number, y: number): boolean => {
    const i = (y * W + x) * 4;
    return rgba[i + 3]! > 128 && rgba[i]! < 135 && rgba[i + 1]! < 105 && rgba[i + 2]! < 105;
  };
  const solid = (x: number, y: number): boolean => {
    for (let dy = -ERODE_RAD; dy <= ERODE_RAD; dy += 3) {
      for (let dx = -ERODE_RAD; dx <= ERODE_RAD; dx += 3) {
        const px = x + dx,
          py = y + dy;
        if (px < 0 || py < 0 || px >= W || py >= H || !dark(px, py)) return false;
      }
    }
    return true;
  };
  const seen = new Uint8Array(W * H);
  let best: { n: number; sx: number; sy: number; y0: number } | null = null;
  for (let ys = 0; ys < H; ys += 2) {
    for (let xs = 0; xs < W; xs += 2) {
      if (seen[ys * W + xs] === 1 || !solid(xs, ys)) continue;
      const queue = [ys * W + xs];
      seen[ys * W + xs] = 1;
      let n = 0,
        sx = 0,
        sy = 0,
        by0 = ys;
      while (queue.length > 0) {
        const idx = queue.pop()!;
        const x = idx % W,
          y = (idx - x) / W;
        n += 1;
        sx += x;
        sy += y;
        if (y < by0) by0 = y;
        for (const [dx, dy] of [
          [2, 0],
          [-2, 0],
          [0, 2],
          [0, -2],
        ] as const) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (seen[ni] === 1 || !solid(nx, ny)) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (n < 400) continue;
      if (best === null || by0 < best.y0) best = { n, sx, sy, y0: by0 };
    }
  }
  if (best === null) throw new Error('no nose blob found');
  return { cx: best.sx / best.n, cy: best.sy / best.n };
}
function rowWidthAt(img: DecodedImage, cy: number): number {
  const { width: W, height: H, rgba } = img;
  let sum = 0,
    n = 0;
  for (let y = Math.max(0, Math.round(cy) - 6); y <= Math.min(H - 1, Math.round(cy) + 6); y += 2) {
    let x0 = -1,
      x1 = -1;
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

// canonical anchors from the MASTER head, measured with the same functions used on the variants
const headBone = boneWorld.get('head')!;
const mNose = measureNose(headR.img);
const mCheekPx = rowWidthAt(headR.img, mNose.cy);
const kMaster = ((headR.box.y1 - headR.box.y0) * K) / headR.img.height;
const noseLocal = {
  x: X(headR.box.x0 + mNose.cx / headR.scale) - headBone.x,
  y: Y(headR.box.y0 + mNose.cy / headR.scale) - headBone.y,
};
const cheekWorld = mCheekPx * kMaster;
console.log(
  `\nmaster head: nose local (${noseLocal.x.toFixed(1)}, ${noseLocal.y.toFixed(1)}), cheek ${cheekWorld.toFixed(1)} world px`,
);

const faceMap: Array<{ file: string; region: string }> = [
  { file: 'face4.svg', region: 'head' }, // closed smile
  { file: 'face3.svg', region: 'head-talk' }, // small open mouth
  { file: 'face2.svg', region: 'head-grit' }, // clenched teeth
];
for (const { file, region } of faceMap) {
  const svg = readFileSync(join(facesDir, file), 'utf8');
  const r = renderPiece(svg, '', viewBoxOf(svg), 950);
  const nose = measureNose(r.img);
  const cheekPx = rowWidthAt(r.img, nose.cy);
  const k = cheekWorld / cheekPx;
  const targetH = r.img.height * k;
  const ax = noseLocal.x + (nose.cx - r.img.width / 2) * k;
  const ay = noseLocal.y - (nose.cy - r.img.height / 2) * k;
  writeFileSync(join(layersDir, `${region}.png`), encodePng(r.img));
  console.log(
    `attach ${region} (${file}) on head: x ${ax.toFixed(1)}, y ${ay.toFixed(1)}, targetH ${targetH.toFixed(1)} (scaleX -1)`,
  );
}

// ---- eye state synthesis -----------------------------------------------------------------------------
// The heads are EYELESS, so closed/happy states are pure lid strokes on transparency; half/worried
// composite tan lids over the open render. Geometry comes from the per-eye isolation renders mapped
// into the eyes-open canvas. All five variants share one canvas size, so one transform fits all.
const eyes = rendered.get('eyes-open')!;
const LID_FILL = '#d79966';
const LINE = '#58261b';
interface EyeGeom {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
const eyeGeom = (name: string): EyeGeom => {
  const r = rendered.get(name)!;
  return {
    cx: ((r.box.x0 + r.box.x1) / 2 - eyes.box.x0) * eyes.scale,
    cy: ((r.box.y0 + r.box.y1) / 2 - eyes.box.y0) * eyes.scale,
    rx: ((r.box.x1 - r.box.x0) / 2) * eyes.scale,
    ry: ((r.box.y1 - r.box.y0) / 2) * eyes.scale,
  };
};
const geoms = [eyeGeom('eye-near'), eyeGeom('eye-far')];
const W = eyes.img.width;
const H = eyes.img.height;
const sw = Math.round(geoms[0]!.ry * 0.16);

// overlays render standalone on transparency and composite over the open eyes in pixels (a data-URI
// <image> base inside the wrapper HTML fails to load under headless file://, so no SVG-side base)
function eyeOverlaySvg(kind: 'half' | 'closed' | 'happy' | 'worried'): string {
  let shapes = '';
  for (let i = 0; i < geoms.length; i += 1) {
    const g = geoms[i]!;
    const rx = g.rx * 1.06,
      ry = g.ry * 1.06;
    const clip = `<clipPath id="c${i}"><ellipse cx="${g.cx}" cy="${g.cy}" rx="${rx}" ry="${ry}"/></clipPath>`;
    if (kind === 'half') {
      const lidY = g.cy - ry + 2 * ry * 0.52;
      shapes +=
        clip +
        `<g clip-path="url(#c${i})"><rect x="${g.cx - rx}" y="${g.cy - ry}" width="${2 * rx}" height="${2 * ry * 0.52}" fill="${LID_FILL}"/></g>` +
        `<path d="M ${g.cx - rx} ${lidY} Q ${g.cx} ${lidY + ry * 0.12} ${g.cx + rx} ${lidY}" fill="none" stroke="${LINE}" stroke-width="${sw}" stroke-linecap="round"/>`;
    } else if (kind === 'worried') {
      // worried lids slant up toward the nose (inner high) and the nose sits BETWEEN the eyes,
      // so the near eye (canvas left) is high on its right edge and the far eye mirrors it
      const a = 0.34 * ry;
      const mid = g.cy - ry + 2 * ry * 0.4;
      const yL = i === 0 ? mid + a / 2 : mid - a / 2;
      const yR = i === 0 ? mid - a / 2 : mid + a / 2;
      shapes +=
        clip +
        `<g clip-path="url(#c${i})"><path d="M ${g.cx - rx} ${yL} L ${g.cx + rx} ${yR} L ${g.cx + rx} ${g.cy - ry} L ${g.cx - rx} ${g.cy - ry} Z" fill="${LID_FILL}"/></g>` +
        `<path d="M ${g.cx - rx} ${yL} L ${g.cx + rx} ${yR}" stroke="${LINE}" stroke-width="${sw}" stroke-linecap="round"/>`;
    } else if (kind === 'closed') {
      const y = g.cy + ry * 0.25;
      shapes += `<path d="M ${g.cx - rx * 0.92} ${y - ry * 0.18} Q ${g.cx} ${y + ry * 0.42} ${g.cx + rx * 0.92} ${y - ry * 0.18}" fill="none" stroke="${LINE}" stroke-width="${sw * 1.25}" stroke-linecap="round"/>`;
    } else {
      const y = g.cy + ry * 0.05;
      shapes += `<path d="M ${g.cx - rx * 0.92} ${y + ry * 0.25} Q ${g.cx} ${y - ry * 0.75} ${g.cx + rx * 0.92} ${y + ry * 0.25}" fill="none" stroke="${LINE}" stroke-width="${sw * 1.25}" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${shapes}</svg>`;
}

function compositeOver(base: DecodedImage, over: DecodedImage): DecodedImage {
  const rgba = new Uint8Array(base.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    const aO = over.rgba[i + 3]! / 255;
    if (aO === 0) continue;
    const aB = rgba[i + 3]! / 255;
    const aOut = aO + aB * (1 - aO);
    for (let c = 0; c < 3; c += 1) {
      rgba[i + c] = Math.round((over.rgba[i + c]! * aO + rgba[i + c]! * aB * (1 - aO)) / aOut);
    }
    rgba[i + 3] = Math.round(aOut * 255);
  }
  return { width: base.width, height: base.height, rgba };
}

writeFileSync(join(layersDir, 'eyes-open.png'), encodePng(eyes.img));
for (const kind of ['half', 'closed', 'happy', 'worried'] as const) {
  const page = join(work, `eyes-${kind}.html`);
  const out = join(work, `eyes-${kind}.png`);
  writeFileSync(page, `<!doctype html><body style="margin:0">${eyeOverlaySvg(kind)}</body>`);
  execSync(
    `"${CHROME}" --headless=new --screenshot="${out}" --window-size=${W},${H} ` +
      `--default-background-color=00000000 --hide-scrollbars "file://${page}" 2>/dev/null`,
  );
  const overlay = decodePng(readFileSync(out));
  const withBase = kind === 'half' || kind === 'worried';
  const result = withBase ? compositeOver(eyes.img, overlay) : overlay;
  writeFileSync(join(layersDir, `eyes-${kind}.png`), encodePng(result));
}
console.log(
  `\neyes: all five states at ${W}x${H}, one transform: x ${eyesT.x.toFixed(1)}, y ${eyesT.y.toFixed(1)}, targetH ${eyesT.h.toFixed(1)}`,
);

// ---- save the master-document pieces ------------------------------------------------------------------
mkdirSync(layersDir, { recursive: true });
for (const spec of specs) {
  if (!spec.save) continue;
  writeFileSync(join(layersDir, `${spec.name}.png`), encodePng(rendered.get(spec.name)!.img));
}
rmSync(work, { recursive: true, force: true });
console.log(
  'done; paste the printed bone/attach values into author-gunner.mts, delete stale pieces, rebuild the atlas',
);
