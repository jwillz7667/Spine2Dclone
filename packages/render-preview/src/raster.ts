import type { BlendMode } from '@marionette/format/types';
import { clamp01, to8Bit, type Color } from './color';
import type { TextureSampler } from './atlas';

// The CPU rasterizer: a premultiplied-alpha float framebuffer plus a deterministic scanline triangle
// fill with a pinned top-left rule and bilinear texture sampling. Determinism contract: fixed loop order
// over pixels and triangles, no wall clock, no randomness; compositing is IEEE-754 double math in a
// single pinned order, so the output bytes are identical on every platform (ADR-0006).
//
// The framebuffer stores PREMULTIPLIED alpha (channel = straight * alpha). This is the numerically clean
// space for the OVER operator and the four GPU-style blend equations below, and it matches how the
// shipped PixiJS/Unity/Godot runtimes blend (premultiplied on the GPU). Source texels are STRAIGHT alpha
// (atlas pixels), tinted, then premultiplied at composite time; the final read-out converts back to
// straight alpha for the PNG (which stores straight alpha).

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  // width * height * 4 premultiplied lanes (r, g, b, a).
  private readonly data: Float64Array;

  constructor(width: number, height: number, background: Color) {
    this.width = width;
    this.height = height;
    this.data = new Float64Array(width * height * 4);
    this.clear(background);
  }

  // Reset every pixel to the premultiplied background (straight * alpha). The constructor calls it, and the
  // sequence pipeline calls it once per frame so a single framebuffer (its Float64Array) is reused across a
  // whole clip with no per-frame allocation. Deterministic: fixed loop order, no clock, no randomness.
  clear(background: Color): void {
    const br = background.r * background.a;
    const bg = background.g * background.a;
    const bb = background.b * background.a;
    const ba = background.a;
    const data = this.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = br;
      data[i + 1] = bg;
      data[i + 2] = bb;
      data[i + 3] = ba;
    }
  }

  // Composite one straight-alpha source color at integer pixel (x, y) under the given blend mode.
  // `src` is already tinted; `srcAlpha` already folds the item alpha and the texel alpha. The four modes
  // are the standard GPU blend equations expressed in premultiplied space (Sr = straight * srcAlpha):
  //   normal   (OVER):  D' = S + D*(1 - Sa)                 A' = Sa + Da*(1 - Sa)
  //   additive:         D' = S + D                          A' = Sa + Da*(1 - Sa)
  //   multiply:         D' = S*D + D*(1 - Sa)               A' = Da
  //   screen:           D' = S + D*(1 - S)                  A' = Sa + Da*(1 - Sa)
  // Intermediate values are left unclamped (additive may exceed 1); the final read-out clamps once.
  blend(x: number, y: number, src: Color, srcAlpha: number, mode: BlendMode): void {
    const sa = srcAlpha;
    const sr = src.r * sa;
    const sg = src.g * sa;
    const sb = src.b * sa;

    const base = (y * this.width + x) * 4;
    const dr = this.data[base]!;
    const dg = this.data[base + 1]!;
    const db = this.data[base + 2]!;
    const da = this.data[base + 3]!;

    let nr: number;
    let ng: number;
    let nb: number;
    let na: number;
    switch (mode) {
      case 'normal': {
        const inv = 1 - sa;
        nr = sr + dr * inv;
        ng = sg + dg * inv;
        nb = sb + db * inv;
        na = sa + da * inv;
        break;
      }
      case 'additive': {
        nr = sr + dr;
        ng = sg + dg;
        nb = sb + db;
        na = sa + da * (1 - sa);
        break;
      }
      case 'multiply': {
        const inv = 1 - sa;
        nr = sr * dr + dr * inv;
        ng = sg * dg + dg * inv;
        nb = sb * db + db * inv;
        na = da;
        break;
      }
      case 'screen': {
        nr = sr + dr * (1 - sr);
        ng = sg + dg * (1 - sg);
        nb = sb + db * (1 - sb);
        na = sa + da * (1 - sa);
        break;
      }
    }

    this.data[base] = nr;
    this.data[base + 1] = ng;
    this.data[base + 2] = nb;
    this.data[base + 3] = na;
  }

  // Convert the premultiplied framebuffer to straight-alpha 8-bit RGBA for PNG encoding. Straight color =
  // premultiplied / alpha (0 where alpha is 0). Clamp then quantize once (Math.round, pinned). Allocates a
  // fresh buffer; the sequence pipeline uses toStraightRgba8Into to write into a reused scratch instead.
  toStraightRgba8(): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 4);
    this.toStraightRgba8Into(out);
    return out;
  }

  // Write the straight-alpha 8-bit RGBA read-out into a caller-owned buffer (length width * height * 4), so
  // a clip reuses one output buffer across every frame. Same pinned math as toStraightRgba8.
  toStraightRgba8Into(out: Uint8Array): void {
    const data = this.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = clamp01(data[i + 3]!);
      if (a > 0) {
        const inv = 1 / a;
        out[i] = to8Bit(data[i]! * inv);
        out[i + 1] = to8Bit(data[i + 1]! * inv);
        out[i + 2] = to8Bit(data[i + 2]! * inv);
      } else {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
      }
      out[i + 3] = to8Bit(a);
    }
  }
}

// A triangle to rasterize: three image-space vertices with their normalized texture (u, v) coordinates.
export interface RasterTriangle {
  readonly x0: number;
  readonly y0: number;
  readonly u0: number;
  readonly v0: number;
  readonly x1: number;
  readonly y1: number;
  readonly u1: number;
  readonly v1: number;
  readonly x2: number;
  readonly y2: number;
  readonly u2: number;
  readonly v2: number;
}

// Signed area * 2 of triangle (a, b, c), y-down screen convention. Positive for our normalized winding.
function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Top-left rule for the winding we normalize to (orient2d(v0, v1, v2) > 0, y-down). A directed edge A->B
// is a fill edge when a sample lands exactly on it iff it is a LEFT edge (going up: dy < 0) or a TOP edge
// (horizontal going right: dy == 0 and dx > 0). Derived and pinned so pixels on a shared edge between two
// triangles (e.g. a region quad's diagonal) are covered by exactly one triangle: no seams, no double blend.
function isTopLeftEdge(ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  return dy < 0 || (dy === 0 && dx > 0);
}

// Rasterize one triangle into the framebuffer: for each pixel center inside the triangle (per the pinned
// top-left rule), interpolate (u, v) with barycentric weights, bilinear-sample the texture, apply the tint
// and alpha, and composite under the blend mode. Fixed loop order (rows then columns). `tint` multiplies
// the sampled rgb; `alpha` multiplies the sampled alpha.
export function rasterizeTriangle(
  fb: Framebuffer,
  tri: RasterTriangle,
  sampler: TextureSampler,
  tint: Color,
  alpha: number,
  mode: BlendMode,
): void {
  // Normalize winding so the area is positive; swap v1 and v2 (and their uvs) when it is negative.
  let x1 = tri.x1;
  let y1 = tri.y1;
  let u1 = tri.u1;
  let v1 = tri.v1;
  let x2 = tri.x2;
  let y2 = tri.y2;
  let u2 = tri.u2;
  let v2 = tri.v2;
  let area = orient2d(tri.x0, tri.y0, x1, y1, x2, y2);
  if (area === 0) return; // Degenerate (zero-area) triangle contributes nothing.
  if (area < 0) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
    [u1, u2] = [u2, u1];
    [v1, v2] = [v2, v1];
    area = -area;
  }
  const x0 = tri.x0;
  const y0 = tri.y0;
  const u0 = tri.u0;
  const v0 = tri.v0;

  // Pixel bounding box (centers), clamped to the framebuffer.
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(fb.width - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(fb.height - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (maxX < minX || maxY < minY) return;

  // Edges opposite each vertex: w0 uses edge v1->v2, w1 uses v2->v0, w2 uses v0->v1.
  const topLeft0 = isTopLeftEdge(x1, y1, x2, y2);
  const topLeft1 = isTopLeftEdge(x2, y2, x0, y0);
  const topLeft2 = isTopLeftEdge(x0, y0, x1, y1);
  const invArea = 1 / area;

  for (let py = minY; py <= maxY; py += 1) {
    const sy = py + 0.5;
    for (let px = minX; px <= maxX; px += 1) {
      const sx = px + 0.5;
      const w0 = orient2d(x1, y1, x2, y2, sx, sy);
      const w1 = orient2d(x2, y2, x0, y0, sx, sy);
      const w2 = orient2d(x0, y0, x1, y1, sx, sy);
      const in0 = w0 > 0 || (w0 === 0 && topLeft0);
      const in1 = w1 > 0 || (w1 === 0 && topLeft1);
      const in2 = w2 > 0 || (w2 === 0 && topLeft2);
      if (!(in0 && in1 && in2)) continue;

      const l0 = w0 * invArea;
      const l1 = w1 * invArea;
      const l2 = w2 * invArea;
      const u = l0 * u0 + l1 * u1 + l2 * u2;
      const v = l0 * v0 + l1 * v1 + l2 * v2;

      const texel = sampler.sample(u, v);
      const src: Color = {
        r: texel.r * tint.r,
        g: texel.g * tint.g,
        b: texel.b * tint.b,
        a: texel.a,
      };
      const srcAlpha = texel.a * alpha;
      // A fully transparent source changes no blend mode's destination (S and Sa are both 0), so skip.
      if (srcAlpha <= 0) continue;
      fb.blend(px, py, src, srcAlpha, mode);
    }
  }
}
