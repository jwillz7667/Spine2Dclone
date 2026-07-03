import type { AtlasRef, AtlasRegion } from '@marionette/format/types';
import { type Color } from './color';
import { MalformedAtlasPageError, RotatedRegionUnsupportedError } from './errors';

// The decoded pixels of one atlas page: straight-alpha RGBA, row-major top-to-bottom, length
// width * height * 4. This is what a host (the MCP server, decoding page PNGs) hands the renderer; the
// package does not read files itself (it stays a pure function of its inputs, ADR-0006 determinism).
export interface AtlasPagePixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

// The atlas pixel source: page pixels keyed by AtlasPage.file. A page absent from the map is treated
// exactly as runtime-web treats an unresolved region texture (region-textures.ts): the region renders as
// the 1x1 white placeholder rather than failing, so a partially-provided atlas still previews.
export interface AtlasPixelSource {
  readonly pages: ReadonlyMap<string, AtlasPagePixels>;
}

// Samples a straight-alpha color for a normalized (u, v) in [0, 1] over an attachment's texture window.
// Region and mesh attachments share this: mesh uvs are normalized over the same region window, so both
// map (u, v) through the same window into the page.
export interface TextureSampler {
  sample(u: number, v: number): Color;
}

// The placeholder sampler: solid opaque white, so a region/mesh with no resolved page renders as a
// tintable white quad (the runtime-web Texture.WHITE fallback behavior).
const WHITE_SAMPLER: TextureSampler = {
  sample(): Color {
    return { r: 1, g: 1, b: 1, a: 1 };
  },
};

// Bilinear sampler over one region window of a page. Texel centers sit at integer + 0.5; the four taps
// are clamped to the region's own pixel window (never bleeding into a neighboring packed region) and to
// the page bounds. Sampling is done in STRAIGHT alpha (atlas pixels are straight), matching the decoded
// source; premultiply happens later at composite time.
class RegionSampler implements TextureSampler {
  private readonly page: AtlasPagePixels;
  private readonly minX: number;
  private readonly minY: number;
  private readonly maxX: number;
  private readonly maxY: number;
  private readonly x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly h: number;

  constructor(page: AtlasPagePixels, region: AtlasRegion) {
    this.page = page;
    this.x = region.x;
    this.y = region.y;
    this.w = region.w;
    this.h = region.h;
    // Clamp window (inclusive pixel range). Regions are integer pixel rects in practice; the clamp keeps
    // the bilinear taps inside this region and the page, so a fractional edge tap never reads a neighbor.
    this.minX = Math.max(0, Math.min(region.x, page.width - 1));
    this.minY = Math.max(0, Math.min(region.y, page.height - 1));
    this.maxX = Math.max(this.minX, Math.min(region.x + region.w - 1, page.width - 1));
    this.maxY = Math.max(this.minY, Math.min(region.y + region.h - 1, page.height - 1));
  }

  sample(u: number, v: number): Color {
    // Continuous atlas pixel coordinate of the sample, then shift to texel-center space (-0.5).
    const px = this.x + u * this.w - 0.5;
    const py = this.y + v * this.h - 0.5;

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;

    const cx0 = this.clampX(x0);
    const cx1 = this.clampX(x0 + 1);
    const cy0 = this.clampY(y0);
    const cy1 = this.clampY(y0 + 1);

    const t00 = this.texel(cx0, cy0);
    const t10 = this.texel(cx1, cy0);
    const t01 = this.texel(cx0, cy1);
    const t11 = this.texel(cx1, cy1);

    // Fixed lerp order (x then y) per channel; deterministic IEEE-754.
    return {
      r: lerp(lerp(t00.r, t10.r, fx), lerp(t01.r, t11.r, fx), fy),
      g: lerp(lerp(t00.g, t10.g, fx), lerp(t01.g, t11.g, fx), fy),
      b: lerp(lerp(t00.b, t10.b, fx), lerp(t01.b, t11.b, fx), fy),
      a: lerp(lerp(t00.a, t10.a, fx), lerp(t01.a, t11.a, fx), fy),
    };
  }

  private clampX(value: number): number {
    if (value < this.minX) return this.minX;
    if (value > this.maxX) return this.maxX;
    return value;
  }

  private clampY(value: number): number {
    if (value < this.minY) return this.minY;
    if (value > this.maxY) return this.maxY;
    return value;
  }

  private texel(x: number, y: number): Color {
    const base = (y * this.page.width + x) * 4;
    const rgba = this.page.rgba;
    return {
      r: rgba[base]! / 255,
      g: rgba[base + 1]! / 255,
      b: rgba[base + 2]! / 255,
      a: rgba[base + 3]! / 255,
    };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Resolves an attachment `path` (== AtlasRegion.name) to a texture sampler. Built once per frame from the
// document atlas and the provided page pixels. Mirrors runtime-web resolution: a region packed rotated is
// a loud error (never rendered turned); a region whose page pixels are absent falls back to the white
// placeholder (partial atlas still previews).
export class AtlasIndex {
  private readonly regions = new Map<string, { region: AtlasRegion; file: string }>();
  private readonly pages: ReadonlyMap<string, AtlasPagePixels>;

  constructor(atlas: AtlasRef, source: AtlasPixelSource) {
    this.pages = source.pages;
    for (const page of atlas.pages) {
      for (const region of page.regions) {
        // Region names are unique across pages (format invariant ATLAS_REGION_DUPLICATE); last write on
        // a malformed duplicate is harmless because validation rejects duplicates before we get here.
        this.regions.set(region.name, { region, file: page.file });
      }
    }
    for (const [file, page] of this.pages) {
      const expected = page.width * page.height * 4;
      if (page.rgba.length !== expected) {
        throw new MalformedAtlasPageError(
          file,
          `rgba length ${page.rgba.length} does not match width*height*4 (${expected})`,
        );
      }
    }
  }

  resolve(path: string): TextureSampler {
    const entry = this.regions.get(path);
    if (entry === undefined) return WHITE_SAMPLER;
    if (entry.region.rotated) throw new RotatedRegionUnsupportedError(entry.region.name);
    const page = this.pages.get(entry.file);
    if (page === undefined) return WHITE_SAMPLER;
    return new RegionSampler(page, entry.region);
  }
}
