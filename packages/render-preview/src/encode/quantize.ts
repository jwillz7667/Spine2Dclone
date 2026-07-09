// A deterministic median-cut color quantizer for the GIF encoder. GIF is a paletted format (256 entries
// max), so a truecolor RGBA clip must be reduced to an indexed palette. Determinism is the whole point:
// NO randomness, NO Date.now, fixed sort order and fixed tie-breaks, so the same pixels always yield the
// same palette and the same indices, and the byte-golden GIF gate holds.
//
// The color space is reduced to 5 bits per channel (a fixed 32768-bucket histogram) before median cut, so
// the histogram is bounded regardless of clip length (a 10s 60fps clip folds into the same 32768 buckets
// as a single frame): the streaming/global-palette pass never accumulates frames, only this fixed table.

// Bits kept per channel in the histogram. 5 bits => 32768 buckets, the standard median-cut resolution.
const BUCKET_BITS = 5;
const BUCKET_SHIFT = 8 - BUCKET_BITS; // 3: 8-bit channel >> 3 => 5-bit bucket
const BUCKET_COUNT = 1 << (BUCKET_BITS * 3); // 32768

function bucketKey(r: number, g: number, b: number): number {
  return (
    ((r >> BUCKET_SHIFT) << (BUCKET_BITS * 2)) |
    ((g >> BUCKET_SHIFT) << BUCKET_BITS) |
    (b >> BUCKET_SHIFT)
  );
}

// A fixed 32768-bucket histogram of the opaque pixels in one or more frames. `addFrame` folds a frame's
// pixels in (alpha below the threshold is skipped: those pixels become the GIF transparent index and never
// contribute a color). Bounded memory: four Float64 lanes over the fixed bucket space, allocated once.
export class ColorHistogram {
  private readonly count = new Float64Array(BUCKET_COUNT);
  private readonly sumR = new Float64Array(BUCKET_COUNT);
  private readonly sumG = new Float64Array(BUCKET_COUNT);
  private readonly sumB = new Float64Array(BUCKET_COUNT);

  addFrame(rgba: Uint8Array, alphaThreshold255: number): void {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3]! < alphaThreshold255) continue;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const key = bucketKey(r, g, b);
      this.count[key]! += 1;
      this.sumR[key]! += r;
      this.sumG[key]! += g;
      this.sumB[key]! += b;
    }
  }

  // Snapshot the present buckets as parallel arrays (average 8-bit color + population), in ascending key
  // order so median cut starts from a deterministic ordering.
  snapshot(): BucketSet {
    const keys: number[] = [];
    for (let key = 0; key < BUCKET_COUNT; key += 1) {
      if (this.count[key]! > 0) keys.push(key);
    }
    const n = keys.length;
    const avgR = new Uint8Array(n);
    const avgG = new Uint8Array(n);
    const avgB = new Uint8Array(n);
    const pop = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const key = keys[i]!;
      const c = this.count[key]!;
      avgR[i] = Math.round(this.sumR[key]! / c);
      avgG[i] = Math.round(this.sumG[key]! / c);
      avgB[i] = Math.round(this.sumB[key]! / c);
      pop[i] = c;
    }
    return { keys, avgR, avgG, avgB, pop };
  }
}

interface BucketSet {
  readonly keys: number[];
  readonly avgR: Uint8Array;
  readonly avgG: Uint8Array;
  readonly avgB: Uint8Array;
  readonly pop: Float64Array;
}

interface Box {
  // Indices into the BucketSet arrays that this box owns.
  readonly members: number[];
}

// The quantized result: the RGB palette (one triple per entry) and a lookup that maps any 8-bit color to
// its palette index. `indexOf` first tries the exact 5-bit bucket (present for every pixel the palette was
// built from) and falls back to a nearest-color scan for colors outside the source set.
export interface Quantized {
  readonly palette: Uint8Array; // colorCount * 3, RGB
  readonly colorCount: number;
  indexOf(r: number, g: number, b: number): number;
}

// Median-cut the histogram into at most `maxColors` palette entries. Deterministic throughout: box
// selection picks the largest color range (tie-break lowest box index), the split axis is the widest
// channel (tie-break R, then G, then B), members sort by that channel then by bucket key, and the split
// point is the median of population. With fewer present buckets than maxColors, each bucket becomes its
// own entry.
export function quantizeMedianCut(histogram: ColorHistogram, maxColors: number): Quantized {
  const target = Math.max(1, Math.min(maxColors, 256));
  const set = histogram.snapshot();
  const bucketCountPresent = set.keys.length;

  if (bucketCountPresent === 0) {
    // No opaque pixels: a single black entry keeps the palette structurally valid.
    return makeQuantized(set, [{ members: [] }]);
  }

  const initial: Box = { members: rangeArray(bucketCountPresent) };
  const boxes: Box[] = [initial];

  while (boxes.length < target) {
    const splitIndex = pickBoxToSplit(boxes, set);
    if (splitIndex < 0) break; // nothing left to split
    const box = boxes[splitIndex]!;
    const halves = splitBox(box, set);
    if (halves === null) break;
    boxes.splice(splitIndex, 1, halves[0], halves[1]);
  }

  return makeQuantized(set, boxes);
}

function rangeArray(n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) out[i] = i;
  return out;
}

// Widest color range in a box across the three channels (used for both box selection and axis choice).
function channelRanges(box: Box, set: BucketSet): { r: number; g: number; b: number } {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  const members = box.members;
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i]!;
    const r = set.avgR[m]!;
    const g = set.avgG[m]!;
    const b = set.avgB[m]!;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  return { r: maxR - minR, g: maxG - minG, b: maxB - minB };
}

function pickBoxToSplit(boxes: Box[], set: BucketSet): number {
  let best = -1;
  let bestRange = -1;
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i]!;
    if (box.members.length < 2) continue;
    const ranges = channelRanges(box, set);
    const maxRange = Math.max(ranges.r, ranges.g, ranges.b);
    if (maxRange > bestRange) {
      bestRange = maxRange;
      best = i;
    }
  }
  return best;
}

function splitBox(box: Box, set: BucketSet): [Box, Box] | null {
  const ranges = channelRanges(box, set);
  // Widest channel, tie-break R > G > B.
  let axis: Uint8Array = set.avgR;
  let axisRange = ranges.r;
  if (ranges.g > axisRange) {
    axis = set.avgG;
    axisRange = ranges.g;
  }
  if (ranges.b > axisRange) {
    axis = set.avgB;
    axisRange = ranges.b;
  }

  const members = box.members.slice();
  members.sort((a, b) => {
    const av = axis[a]!;
    const bv = axis[b]!;
    if (av !== bv) return av - bv;
    return set.keys[a]! - set.keys[b]!; // deterministic tie-break by bucket key
  });

  let total = 0;
  for (let i = 0; i < members.length; i += 1) total += set.pop[members[i]!]!;
  const half = total / 2;

  let acc = 0;
  let cut = 0;
  for (let i = 0; i < members.length; i += 1) {
    acc += set.pop[members[i]!]!;
    if (acc >= half) {
      cut = i + 1;
      break;
    }
  }
  if (cut <= 0) cut = 1;
  if (cut >= members.length) cut = members.length - 1;
  if (cut <= 0) return null;

  return [{ members: members.slice(0, cut) }, { members: members.slice(cut) }];
}

function makeQuantized(set: BucketSet, boxes: Box[]): Quantized {
  const colorCount = boxes.length;
  const palette = new Uint8Array(colorCount * 3);
  // bucketToIndex maps a present 5-bit bucket key to its palette index (every source pixel hits this).
  const bucketToIndex = new Int32Array(BUCKET_COUNT).fill(-1);

  for (let bi = 0; bi < boxes.length; bi += 1) {
    const members = boxes[bi]!.members;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let pop = 0;
    for (let i = 0; i < members.length; i += 1) {
      const m = members[i]!;
      const p = set.pop[m]!;
      sumR += set.avgR[m]! * p;
      sumG += set.avgG[m]! * p;
      sumB += set.avgB[m]! * p;
      pop += p;
      bucketToIndex[set.keys[m]!] = bi;
    }
    if (pop > 0) {
      palette[bi * 3] = Math.round(sumR / pop);
      palette[bi * 3 + 1] = Math.round(sumG / pop);
      palette[bi * 3 + 2] = Math.round(sumB / pop);
    }
  }

  const indexOf = (r: number, g: number, b: number): number => {
    const viaBucket = bucketToIndex[bucketKey(r, g, b)]!;
    if (viaBucket >= 0) return viaBucket;
    return nearestIndex(palette, colorCount, r, g, b);
  };

  return { palette, colorCount, indexOf };
}

// Nearest palette entry by squared RGB distance; ties resolve to the lowest index (deterministic). Used
// only for colors not in the source set (never on the encode path for a palette built from the same
// pixels, but kept correct for arbitrary callers and unit tests).
function nearestIndex(
  palette: Uint8Array,
  colorCount: number,
  r: number,
  g: number,
  b: number,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < colorCount; i += 1) {
    const dr = palette[i * 3]! - r;
    const dg = palette[i * 3 + 1]! - g;
    const db = palette[i * 3 + 2]! - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
