import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  emitAtlas,
  importSprites,
  packAtlas,
  trimSprite,
  type DecodedImage,
  type TrimmedSprite,
} from '../../packages/atlas-pack/src/index';

// LITTLE ALIENS demo step 1: pack the source art into deterministic atlas pages + an AtlasRef via the
// SAME shared atlas-pack primitives the editor's Assets panel and the MCP atlas.pack tool run (import ->
// trim -> maxrects pack -> emit, ADR-0007). Two source dirs join ONE main atlas: source/ (the 5x3 symbols,
// wild/scatter/bonus, the reel frame, the space backdrop) and source-layers/ (the per-part character
// pieces the two rigged mascots are built from). The reel frame ships at 2831x4503, past the 4096 page
// limit, so it is area-averaged down first; a dark reel-window panel is generated procedurally so the grid
// sits on a recessed panel inside the frame's transparent window. author-game.mts consumes atlas-ref.json
// (region sizes) and the page PNGs; the FX atlas is packed separately (gen-fx-textures.mts + atlas.pack).

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = join(here, 'atlas');
mkdirSync(outputDir, { recursive: true });
const fileStore = createNodeFileStore();

// Area-average downscale (alpha-weighted RGB so transparent-edge pixels do not darken the fringe). Returns
// the image unchanged when it already fits under maxDim on both axes.
function downscaleToFit(img: DecodedImage, maxDim: number): DecodedImage {
  const scale = maxDim / Math.max(img.width, img.height);
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
          const a = img.rgba[o + 3]!;
          rSum += img.rgba[o]! * a;
          gSum += img.rgba[o + 1]! * a;
          bSum += img.rgba[o + 2]! * a;
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

// A recessed reel-window panel: a dark blue-black with a subtle top-to-bottom gradient, drawn (stretched)
// behind the grid cells inside the frame's transparent window so the symbols read against a panel, not the
// starfield. Stretched by the authored attachment, so a slim 32x256 gradient is enough.
function makePanel(): DecodedImage {
  const w = 32;
  const h = 256;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const t = y / (h - 1);
    const r = Math.round(9 + 7 * (1 - t));
    const g = Math.round(12 + 9 * (1 - t));
    const b = Math.round(30 + 14 * (1 - t));
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

// A soft white radial used as a stretched full-window overlay for the bonus-intro green energy flash
// (tinted + alpha-keyed by the authored animation). It lives in the MAIN atlas because render_frame draws
// skeleton slots from the document atlas only (the FX atlas backs particles, not slots).
function makeFlash(): DecodedImage {
  const size = 256;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const ny = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const r = Math.min(1, Math.hypot(nx, ny));
      const a = Math.round(Math.pow(1 - r, 1.7) * 255);
      const o = (y * size + x) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = a;
    }
  }
  return { width: size, height: size, rgba };
}

interface NamedImage {
  readonly name: string;
  readonly image: DecodedImage;
}

const layers = await importSprites(join(here, 'source-layers'), fileStore);
const symbols = await importSprites(join(here, 'source'), fileStore);

const named: NamedImage[] = [];
for (const s of [...symbols, ...layers]) {
  const image: DecodedImage = { width: s.width, height: s.height, rgba: s.rgba };
  // The reel frame is the only sprite past the 4096 page cap; area-average it down. Everything else packs
  // at native resolution.
  named.push({ name: s.name, image: s.name === 'reelframe' ? downscaleToFit(image, 2000) : image });
}
named.push({ name: 'panel', image: makePanel() });
named.push({ name: 'flash', image: makeFlash() });

const trimmed: TrimmedSprite[] = named.map(({ name, image }) => {
  const trim = trimSprite(image.rgba, image.width, image.height);
  return {
    name,
    trimmedW: trim.trimmedW,
    trimmedH: trim.trimmedH,
    offsetX: trim.offsetX,
    offsetY: trim.offsetY,
    originalW: trim.originalW,
    originalH: trim.originalH,
    pixels: trim.pixels,
  };
});

const { atlas, pageBitmaps } = packAtlas(trimmed, { maxPageSize: 4096 });
const ref = await emitAtlas(atlas, pageBitmaps, outputDir, fileStore);

// emit already wrote the page PNGs; write the ref the authoring step reads for region sizes.
writeFileSync(join(outputDir, 'atlas-ref.json'), JSON.stringify(ref, null, 2));

const regions = ref.pages.flatMap((page) => page.regions.map((r) => r.name));
console.log(
  `packed ${regions.length} regions onto ${ref.pages.length} page(s): ${ref.pages
    .map((p) => `${p.file} ${p.width}x${p.height}`)
    .join(', ')}`,
);
console.log(`regions: ${regions.sort().join(', ')}`);
