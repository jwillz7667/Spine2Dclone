import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, type DecodedImage } from '../../packages/atlas-pack/src/index';

// Procedurally generate the dedicated Kraken's Hoard particle art (glow / spark / bubble / mote) into
// source-fx/, encoded through the SAME deterministic pngjs codec the atlas pipeline uses (encodePng, so
// the bytes are the pure-JS codec's, not a native library's). author-game.mts then packs these with the
// atlas.pack tool into a separate EFFECTS atlas. Every texture is white (or blue-white) with its shape
// carried entirely in the alpha channel, so the emitter's per-layer tint (colorOverLife) recolors it.

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Build a size x size RGBA image from a per-pixel shader returning straight-alpha [r,g,b,a] in [0,1].
function makeImage(
  size: number,
  shade: (nx: number, ny: number) => readonly [number, number, number, number],
): DecodedImage {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    // Pixel-center normalized device coords in [-1, 1] (0,0 at the texture center).
    const ny = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x += 1) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const [r, g, b, a] = shade(nx, ny);
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(clamp01(r) * 255);
      rgba[o + 1] = Math.round(clamp01(g) * 255);
      rgba[o + 2] = Math.round(clamp01(b) * 255);
      rgba[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return { width: size, height: size, rgba };
}

// glow.png: a 128px soft white radial gradient, alpha = (1 - r)^2.2 with a pure-white core. The steep
// falloff keeps the additive core from a hard rim while still reaching a hot center.
const glow = makeImage(128, (nx, ny) => {
  const r = Math.hypot(nx, ny);
  const alpha = Math.pow(clamp01(1 - r), 2.2);
  return [1, 1, 1, alpha];
});

// spark.png: a 96px four-point star: two thin crossed spikes (long on one axis, thin on the other) over a
// hot radial core, so it reads as a sharp glint rather than a blob.
const spark = makeImage(96, (nx, ny) => {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const armH = Math.pow(clamp01(1 - ax), 1.1) * Math.pow(clamp01(1 - ay / 0.12), 2);
  const armV = Math.pow(clamp01(1 - ay), 1.1) * Math.pow(clamp01(1 - ax / 0.12), 2);
  const core = Math.pow(clamp01(1 - Math.hypot(nx, ny) * 1.8), 3);
  const alpha = clamp01(Math.max(armH, armV) * 0.9 + core);
  return [1, 1, 1, alpha];
});

// bubble.png: a 96px soap-film bubble, not a wire ring (the v3 review found thin rings read as chain
// links). A WIDE soft gaussian rim (band at r ~= 0.74, sigma 0.16) that fades gently toward the center,
// a real interior film (radial alpha rising from 0.10 at the middle to ~0.26 near the rim), a broad
// top-left specular lobe plus a small hot core inside it, and a faint bottom-right counter-glint. RGB
// blends the white rim/highlights with the blue-white film by their alpha contributions.
const bubble = makeImage(96, (nx, ny) => {
  const r = Math.hypot(nx, ny);
  if (r > 1) return [1, 1, 1, 0];
  const rim = Math.exp(-(((r - 0.74) / 0.16) ** 2)) * 0.55;
  const film = r < 0.9 ? 0.1 + 0.16 * Math.pow(r / 0.9, 2) : 0;
  const hd = Math.hypot(nx + 0.34, ny + 0.34);
  const highlight =
    Math.pow(clamp01(1 - hd / 0.42), 2) * 0.5 + Math.pow(clamp01(1 - hd / 0.16), 2) * 0.75;
  const gd = Math.hypot(nx - 0.3, ny - 0.38);
  const glint = Math.pow(clamp01(1 - gd / 0.18), 2) * 0.22;
  const white = rim + highlight + glint;
  const blue = film;
  const total = white + blue;
  const alpha = clamp01(total);
  if (total <= 0) return [1, 1, 1, 0];
  const rC = (1 * white + 0.78 * blue) / total;
  const gC = (1 * white + 0.88 * blue) / total;
  const bC = (1 * white + 1 * blue) / total;
  return [rC, gC, bC, alpha];
});

// mote.png: a 64px tiny soft dot, softer than glow (a gentler exponent) for drifting dust.
const mote = makeImage(64, (nx, ny) => {
  const r = Math.hypot(nx, ny);
  const alpha = Math.pow(clamp01(1 - r), 2.5);
  return [1, 1, 1, alpha];
});

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'source-fx');
mkdirSync(outDir, { recursive: true });

const textures: ReadonlyArray<readonly [string, DecodedImage]> = [
  ['glow.png', glow],
  ['spark.png', spark],
  ['bubble.png', bubble],
  ['mote.png', mote],
];
for (const [name, image] of textures) {
  writeFileSync(join(outDir, name), encodePng(image));
  console.log(`wrote ${name} (${image.width}x${image.height})`);
}
console.log(`DONE: ${textures.length} FX textures generated into ${outDir}`);
