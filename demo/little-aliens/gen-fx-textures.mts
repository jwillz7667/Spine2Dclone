import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng, type DecodedImage } from '../../packages/atlas-pack/src/index';

// LITTLE ALIENS: procedurally generate the dedicated particle art (glow / star spark / goo droplet /
// energy ring) into source-fx/, encoded through the SAME deterministic pngjs codec the atlas pipeline uses
// (encodePng, so the bytes are the pure-JS codec's, not a native library's). author-game.mts packs these
// with the atlas.pack tool into a SEPARATE effects atlas. glow / spark / ring carry their shape entirely in
// the alpha channel and are white, so the emitter's per-layer tint (colorOverLife) recolors them; the goo
// droplet bakes a soft light-to-dark shade into its RGB (base 0.72, highlight -> 1.0, rim -> 0.5) so a
// multiplicative green tint reads as a rounded, three-dimensional blob rather than a flat silhouette.

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Build a size x size RGBA image from a per-pixel shader returning straight-alpha [r,g,b,a] in [0,1].
function makeImage(
  size: number,
  shade: (nx: number, ny: number) => readonly [number, number, number, number],
): DecodedImage {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    // Pixel-center normalized device coords in [-1, 1] (0,0 at the texture center, y-down).
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

// goo.png: a 96px teardrop goo droplet (point up, bulb down) for the blob-splat bursts. The silhouette is
// the union of a bottom bulb (circle at cy=0.32, radius 0.58) and a taper that narrows to a point near the
// top (half-width grows from 0 at y=-0.94 to the bulb radius at the bulb top), feathered over a thin edge
// band. RGB bakes a soft shade so a green tint reads as a rounded blob: a base of 0.72, a bright top-left
// specular lobe pushing toward 1.0, and a rim darkening toward 0.5 in the outer feather.
const goo = makeImage(96, (nx, ny) => {
  const bulbCy = 0.32;
  const bulbR = 0.58;
  const bulbD = Math.hypot(nx, ny - bulbCy);
  // Signed distance-ish membership: <=0 inside. Bulb below its center, taper above it.
  let edge: number; // 0 at the silhouette boundary, negative inside, positive outside (in ~unit scale)
  if (ny >= bulbCy) {
    edge = bulbD - bulbR;
  } else {
    const t = clamp01((ny - -0.94) / (bulbCy - -0.94)); // 0 at the top point, 1 at the bulb top
    const halfW = bulbR * Math.pow(t, 1.35);
    edge = Math.abs(nx) - halfW;
  }
  const feather = 0.07;
  const alpha = clamp01(-edge / feather); // 1 well inside, ramps to 0 across the feather band
  if (alpha <= 0) return [0, 0, 0, 0];
  // Shade: base gray, a top-left specular highlight, and a rim darken in the outer ~feather*2 band.
  const hd = Math.hypot(nx + 0.2, ny - 0.02);
  const highlight =
    Math.pow(clamp01(1 - hd / 0.5), 2) * 0.32 + Math.pow(clamp01(1 - hd / 0.16), 2) * 0.2;
  const rim = clamp01(-edge / (feather * 2.4)); // 0 at edge -> 1 just inside
  const shade = clamp01(0.5 + 0.22 * rim + highlight);
  return [shade, shade, shade, alpha];
});

// ring.png: a 96px soft energy-pulse annulus (a filmy ring, not a hard wire): a gaussian band centered at
// r=0.72 with a wide sigma, white so the emitter tints it. Expanded over life it reads as a shockwave.
const ring = makeImage(96, (nx, ny) => {
  const r = Math.hypot(nx, ny);
  const band = Math.exp(-(((r - 0.72) / 0.17) ** 2));
  const alpha = clamp01(band);
  return [1, 1, 1, alpha];
});

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'source-fx');
mkdirSync(outDir, { recursive: true });

const textures: ReadonlyArray<readonly [string, DecodedImage]> = [
  ['glow.png', glow],
  ['spark.png', spark],
  ['goo.png', goo],
  ['ring.png', ring],
];
for (const [name, image] of textures) {
  writeFileSync(join(outDir, name), encodePng(image));
  console.log(`wrote ${name} (${image.width}x${image.height})`);
}
console.log(`DONE: ${textures.length} FX textures generated into ${outDir}`);
