// Deterministic, dependency-light sprite-sheet cutter core for the Little Aliens asset-prep stage.
// Pure functions only (no filesystem, no process): decode -> background removal -> connected-component
// labelling -> tight crop. The PNG codec is atlas-pack's pure-JS decodePng/encodePng, so the pixel
// contract does not depend on a native library (same guarantee the atlas pipeline relies on).
//
// Two background-removal strategies:
//   whiteFlood    edge flood-fill from the border through near-white pixels -> alpha 0, with a
//                 whiteness ramp on the boundary band so anti-aliased edge pixels defringe (no white
//                 halo) and interior whites (eyes, teeth) survive because they are not border-connected.
//   interiorFlood a second flood seeded from an interior point through light, low-saturation pixels,
//                 used to punch the enclosed grey/white centre out of a frame (reelframe).

import { decodePng, encodePng, type DecodedImage } from '../../packages/atlas-pack/src/index';

export interface Bbox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number; // inclusive
  readonly maxY: number; // inclusive
}

export interface Component {
  readonly bbox: Bbox;
  readonly area: number; // opaque pixel count
  readonly centroidX: number;
  readonly centroidY: number;
}

export interface WhiteFloodParams {
  // A pixel is a background candidate when every channel >= floodWhite (near-white).
  readonly floodWhite: number;
  // Boundary-band whiteness ramp: alpha goes 0 -> 255 as the per-pixel min channel falls from
  // rampHi to rampLo. Defringes whitish AA edge pixels without eating saturated edges.
  readonly rampLo: number;
  readonly rampHi: number;
}

export const DEFAULT_WHITE_FLOOD: WhiteFloodParams = { floodWhite: 244, rampLo: 215, rampHi: 245 };

export interface DespeckleParams {
  // Source alpha below this is treated as baked-in background noise and cut. The layer sheets are
  // pre-alpha'd: the dark checkerboard lives in near-transparent pixels whose RGB the white flood cannot
  // see, so removeBackground turns it opaque. The original alpha is the signal that separates it.
  readonly alphaMin: number;
  // A component within keepPad px of the largest component's bbox is a real detached bit (an eye piece,
  // an antenna dot) and is kept.
  readonly keepPad: number;
  // A component whose area is at least keepAreaRatio of the largest's area is a real second piece (the
  // other arm/antenna) even when it sits far from the largest, so it is kept regardless of distance.
  readonly keepAreaRatio: number;
}

export const DEFAULT_DESPECKLE: DespeckleParams = {
  alphaMin: 40,
  keepPad: 32,
  keepAreaRatio: 0.02,
};

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// Whiteness-ramp defringe: alpha falls 255 -> 0 as the pixel's min channel rises from rampLo to rampHi,
// so a whitish anti-aliased edge feathers out while a saturated or dark edge (low min channel) stays
// fully opaque. Shared by the border-white removal and the despeckle pass so both feather identically.
const rampAlpha = (minChan: number, rampLo: number, rampHi: number): number =>
  clampByte(((rampHi - minChan) / (rampHi - rampLo)) * 255);

const minChannel = (rgba: Uint8Array, o: number): number =>
  Math.min(rgba[o], rgba[o + 1], rgba[o + 2]);

const saturation = (rgba: Uint8Array, o: number): number =>
  Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) - Math.min(rgba[o], rgba[o + 1], rgba[o + 2]);

// Flood 4-connected from every border pixel through near-white pixels. Returns a mask where 1 marks
// border-connected background. The original source may lack an alpha channel; only RGB is consulted.
function edgeWhiteMask(img: DecodedImage, floodWhite: number): Uint8Array {
  const { width, height, rgba } = img;
  const bg = new Uint8Array(width * height);
  const stack: number[] = [];
  const isWhite = (idx: number): boolean => minChannel(rgba, idx * 4) >= floodWhite;
  const push = (x: number, y: number): void => {
    const idx = y * width + x;
    if (bg[idx] === 0 && isWhite(idx)) {
      bg[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return bg;
}

// Flood from an interior seed through light, low-saturation pixels (the grey/white centre of a frame).
// Bounded by the saturated / dark frame. Marks 1 in `interior` (kept separate from the edge-white mask
// because interior pixels are cut HARD to alpha 0: a grey centre must not run through the whiteness ramp,
// which would read grey as near-opaque). `edge` is consulted so the interior flood also spreads through
// any centre pixels the border flood already claimed.
function floodInterior(
  img: DecodedImage,
  interior: Uint8Array,
  edge: Uint8Array,
  seedX: number,
  seedY: number,
  minLight: number,
  maxSat: number,
): void {
  const { width, height, rgba } = img;
  const stack: number[] = [];
  const ok = (idx: number): boolean => {
    const o = idx * 4;
    return minChannel(rgba, o) >= minLight && saturation(rgba, o) <= maxSat;
  };
  const push = (x: number, y: number): void => {
    const idx = y * width + x;
    if (interior[idx] === 0 && (edge[idx] === 1 || ok(idx))) {
      interior[idx] = 1;
      stack.push(idx);
    }
  };
  push(seedX, seedY);
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
}

// Produce a straight-alpha RGBA image where the flooded background is transparent. Edge-band foreground
// pixels are defringed via the whiteness ramp; interior-flood pixels are cut hard (alpha 0) so a grey
// centre leaves no halo. Returns a fresh DecodedImage (RGBA, 4 channels).
export interface RemovedImage {
  readonly image: DecodedImage;
  // 1 where the pixel is opaque enough to belong to a sprite (alpha >= OPAQUE_MIN).
  readonly foreground: Uint8Array;
}

const OPAQUE_MIN = 24;

export function removeBackground(
  img: DecodedImage,
  params: WhiteFloodParams,
  interior?: {
    readonly seedX: number;
    readonly seedY: number;
    readonly minLight: number;
    readonly maxSat: number;
  },
): RemovedImage {
  const { width, height, rgba } = img;
  const bg = edgeWhiteMask(img, params.floodWhite);
  const interiorMask = new Uint8Array(width * height);
  const { rampLo, rampHi } = params;
  if (interior) {
    floodInterior(
      img,
      interiorMask,
      bg,
      interior.seedX,
      interior.seedY,
      interior.minLight,
      interior.maxSat,
    );
  }
  const out = new Uint8Array(width * height * 4);
  const foreground = new Uint8Array(width * height);
  const isBg = (x: number, y: number): boolean => {
    const i = y * width + x;
    return bg[i] === 1 || interiorMask[i] === 1;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const o = idx * 4;
      out[o] = rgba[o];
      out[o + 1] = rgba[o + 1];
      out[o + 2] = rgba[o + 2];
      let alpha: number;
      if (interiorMask[idx] === 1) {
        // Enclosed frame centre: hard cut. The grey checkerboard must go fully transparent, so it is
        // never fed through the whiteness ramp (which would read grey as opaque).
        alpha = 0;
      } else if (bg[idx] === 1) {
        // Border-connected white: transparent, with a soft outward feather for non-pure-white edges.
        alpha = rampAlpha(minChannel(rgba, o), rampLo, rampHi);
      } else {
        // Foreground: opaque, but defringe pixels touching removed background by their whiteness. A
        // saturated/dark frame pixel bordering the interior cut has a low min channel, so the ramp keeps
        // it fully opaque; only whitish halo pixels lose alpha.
        const touchesBg =
          (x > 0 && isBg(x - 1, y)) ||
          (x < width - 1 && isBg(x + 1, y)) ||
          (y > 0 && isBg(x, y - 1)) ||
          (y < height - 1 && isBg(x, y + 1));
        alpha = touchesBg ? rampAlpha(minChannel(rgba, o), rampLo, rampHi) : 255;
      }
      out[o + 3] = alpha;
      foreground[idx] = alpha >= OPAQUE_MIN ? 1 : 0;
    }
  }
  return { image: { width, height, rgba: out }, foreground };
}

interface LabelResult {
  readonly components: Component[];
  // Pixel -> component id, -1 for background. Lets a caller map pixels back to the component that owns
  // them (the despeckle pass needs this to keep or cut whole components).
  readonly labels: Int32Array;
}

// 8-connected labelling of the foreground mask into components (bbox + area + centroid) plus the pixel
// label map. `labelComponents` is the public projection that returns only the components.
function labelConnected(width: number, height: number, foreground: Uint8Array): LabelResult {
  const labels = new Int32Array(width * height).fill(-1);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < foreground.length; start += 1) {
    if (foreground[start] === 0 || labels[start] !== -1) continue;
    const id = components.length;
    labels[start] = id;
    stack.length = 0;
    stack.push(start);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    while (stack.length > 0) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx - x) / width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nIdx = ny * width + nx;
          if (foreground[nIdx] === 1 && labels[nIdx] === -1) {
            labels[nIdx] = id;
            stack.push(nIdx);
          }
        }
      }
    }
    components.push({
      bbox: { minX, minY, maxX, maxY },
      area,
      centroidX: sumX / area,
      centroidY: sumY / area,
    });
  }
  return { components, labels };
}

export function labelComponents(
  width: number,
  height: number,
  foreground: Uint8Array,
): Component[] {
  return labelConnected(width, height, foreground).components;
}

const bboxesWithinGap = (a: Bbox, b: Bbox, gap: number): boolean =>
  a.minX - gap <= b.maxX &&
  b.minX - gap <= a.maxX &&
  a.minY - gap <= b.maxY &&
  b.minY - gap <= a.maxY;

const unionBbox = (a: Bbox, b: Bbox): Bbox => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

// Merge components whose bounding boxes overlap or sit within `gap` px (a detached antenna dot belongs
// to its body), then drop specks below `minArea`. Order-independent: iterates to a fixed point.
export function mergeAndFilter(
  components: readonly Component[],
  gap: number,
  minArea: number,
): Component[] {
  let groups = components.map((c) => ({
    bbox: c.bbox,
    area: c.area,
    cx: c.centroidX * c.area,
    cy: c.centroidY * c.area,
  }));
  let merged = true;
  while (merged) {
    merged = false;
    const next: typeof groups = [];
    for (const g of groups) {
      const hit = next.find((n) => bboxesWithinGap(n.bbox, g.bbox, gap));
      if (hit) {
        hit.bbox = unionBbox(hit.bbox, g.bbox);
        hit.area += g.area;
        hit.cx += g.cx;
        hit.cy += g.cy;
        merged = true;
      } else {
        next.push({ ...g });
      }
    }
    groups = next;
  }
  return groups
    .filter((g) => g.area >= minArea)
    .map((g) => ({
      bbox: g.bbox,
      area: g.area,
      centroidX: g.cx / g.area,
      centroidY: g.cy / g.area,
    }));
}

// Despeckle a per-part layer: strip the dark checkerboard the pre-alpha'd source sheets bake into their
// near-transparent background. removeBackground rebuilds alpha from RGB whiteness only, so it cannot see
// the dark low-alpha noise and turns it opaque; the ORIGINAL source alpha is the signal that separates
// the painted character from that noise. This pass (1) cuts every pixel whose source alpha is below
// params.alphaMin, (2) 8-connected-labels the survivors and keeps the largest component plus any real
// detached piece (bbox within keepPad of the largest, or area >= keepAreaRatio of the largest so a
// far-apart second arm/antenna survives), cutting everything else, then (3) re-feathers kept pixels that
// now border a cut pixel with the same whiteness ramp removeBackground uses, so no hard aliased edge is
// left where the noise was removed. Returns the cleaned image and its foreground mask.
export function despeckleLayerImage(
  source: DecodedImage,
  removed: RemovedImage,
  params: DespeckleParams,
  defringe: WhiteFloodParams,
): RemovedImage {
  const { width, height, rgba } = removed.image;
  const src = source.rgba;
  const gated = new Uint8Array(width * height);
  for (let i = 0; i < gated.length; i += 1) {
    gated[i] = removed.foreground[i] === 1 && src[i * 4 + 3] >= params.alphaMin ? 1 : 0;
  }

  const { components, labels } = labelConnected(width, height, gated);
  const out = new Uint8Array(rgba); // start from the removed pixels; reject the rest to alpha 0
  const foreground = new Uint8Array(width * height);
  if (components.length === 0) {
    for (let i = 0; i < gated.length; i += 1) out[i * 4 + 3] = 0;
    return { image: { width, height, rgba: out }, foreground };
  }

  let largest = 0;
  for (let k = 1; k < components.length; k += 1) {
    if (components[k].area > components[largest].area) largest = k;
  }
  const largestBbox = components[largest].bbox;
  const largestArea = components[largest].area;
  const keep = components.map(
    (c, k) =>
      k === largest ||
      c.area >= params.keepAreaRatio * largestArea ||
      bboxesWithinGap(c.bbox, largestBbox, params.keepPad),
  );

  for (let i = 0; i < labels.length; i += 1) {
    const id = labels[i];
    const kept = id >= 0 && keep[id];
    if (kept) {
      foreground[i] = out[i * 4 + 3] >= OPAQUE_MIN ? 1 : 0;
    } else {
      out[i * 4 + 3] = 0;
    }
  }

  const { rampLo, rampHi } = defringe;
  const isCut = (x: number, y: number): boolean => out[(y * width + x) * 4 + 3] === 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const o = idx * 4;
      if (out[o + 3] === 0) continue;
      const touchesCut =
        (x > 0 && isCut(x - 1, y)) ||
        (x < width - 1 && isCut(x + 1, y)) ||
        (y > 0 && isCut(x, y - 1)) ||
        (y < height - 1 && isCut(x, y + 1));
      if (touchesCut) {
        const feathered = rampAlpha(minChannel(out, o), rampLo, rampHi);
        if (feathered < out[o + 3]) {
          out[o + 3] = feathered;
          foreground[idx] = feathered >= OPAQUE_MIN ? 1 : 0;
        }
      }
    }
  }

  return { image: { width, height, rgba: out }, foreground };
}

// Tight-crop a region out of an RGBA image with `pad` transparent px on every side.
export function cropRegion(img: DecodedImage, bbox: Bbox, pad: number): DecodedImage {
  const x0 = Math.max(0, bbox.minX - pad);
  const y0 = Math.max(0, bbox.minY - pad);
  const x1 = Math.min(img.width - 1, bbox.maxX + pad);
  const y1 = Math.min(img.height - 1, bbox.maxY + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcRow = (y0 + y) * img.width + x0;
    const dstRow = y * w;
    for (let x = 0; x < w; x += 1) {
      const s = (srcRow + x) * 4;
      const d = (dstRow + x) * 4;
      out[d] = img.rgba[s];
      out[d + 1] = img.rgba[s + 1];
      out[d + 2] = img.rgba[s + 2];
      out[d + 3] = img.rgba[s + 3];
    }
  }
  return { width: w, height: h, rgba: out };
}

// Bounding box of all opaque (alpha >= OPAQUE_MIN) pixels; null when the image is fully transparent.
export function opaqueBounds(img: DecodedImage): Bbox | null {
  const { width, height, rgba } = img;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] >= OPAQUE_MIN) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

export { decodePng, encodePng };
export type { DecodedImage };
