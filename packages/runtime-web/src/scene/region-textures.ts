import { Rectangle, Texture } from 'pixi.js';
import type { AtlasRef, AtlasRegion } from '@marionette/format/types';

// Region attachment texture resolution (handoff 8.9). A region attachment names an atlas region by
// `path` (which equals the AtlasRegion.name); rendering it needs the Pixi Texture for that region. The
// runtime-web SkeletonView does NOT own atlas loading: a HOST injects a resolver (the editor builds it
// from IPC page bytes, the web runtime from fetched pages), so this module is the small, pure-ish seam
// the host fills. When a region has no texture yet (atlas still loading, or a page not provided), the
// resolver returns null and the view falls back to the 1x1 white placeholder, so a partially-loaded
// atlas still renders (just untextured) rather than failing.

// Given an attachment `path` (the AtlasRegion.name), return that region's Texture, or null when none is
// available. A plain function type so the host can back it any way it likes; SkeletonView only calls it.
export type RegionTextureResolver = (regionPath: string) => Texture | null;

// PixiJS groupD8 value for a 90-degree-clockwise rotation (its `S` symmetry), exactly what the spritesheet
// parser stamps on a rotated frame. atlas-pack stores a rotated sprite turned 90 degrees clockwise into an
// (h x w) page rectangle, so rotate=2 turns it back to its logical orientation on draw. See
// packages/atlas-pack/src/pack.ts blitRotated and render-preview's RegionSampler for the matching mapping.
const ROTATE_90_CW = 2;

// Slice one region's sub-Texture out of a loaded page Texture. The sub-texture SHARES the page's GPU
// source (TextureSource) and only carries its own frame/orig/rotate, so this allocates no pixels and
// uploads nothing: it is a UV window onto the page. Lifecycle: the HOST owns the page base textures; these
// frames are lightweight views over that shared source, so the view must NOT destroy them (doing so would
// tear down the host's page).
//
// Rotation (PP-C2): a region packed rotated is stored in an (h x w) page rectangle turned 90 degrees
// clockwise. We hand PixiJS the stored frame (swapped dims), the logical `orig` (w x h), and rotate=2, so
// both the sprite path and the mesh path sample it correctly and Texture.width/height read back as the
// LOGICAL size (w x h) the placement math expects.
//
// Trim (PP-C1) is NOT baked into the texture: it is applied to the region-attachment PLACEMENT matrix
// (skeleton-view.ts, attachment-sprites.ts sizeForTexture), keeping the texture a frame-only window so
// mesh UVs (normalized over the packed region) stay correct. An untrimmed region needs no placement
// adjustment; a trimmed one is offset there, never here.
export function sliceRegion(pageTexture: Texture, region: AtlasRegion): Texture {
  const source = pageTexture.source;
  if (region.rotated) {
    return new Texture({
      source,
      frame: new Rectangle(region.x, region.y, region.h, region.w),
      orig: new Rectangle(0, 0, region.w, region.h),
      rotate: ROTATE_90_CW,
    });
  }
  return new Texture({
    source,
    frame: new Rectangle(region.x, region.y, region.w, region.h),
  });
}

// Build the region-name -> Texture map for an atlas from already-loaded page base textures, keyed by
// AtlasPage.file. A page absent from `pageTextures` (not loaded yet) is skipped: its regions simply do
// not appear in the result, so the resolver returns null for them and the view shows the placeholder.
// Region names are unique across pages (format invariant ATLAS_REGION_DUPLICATE), so the flat map cannot
// collide. The returned frames are views over the host's page sources (see sliceRegion): the host owns
// disposal of the pages; this map can be dropped without destroying the shared sources.
export function buildRegionTextures(
  atlas: AtlasRef,
  pageTextures: ReadonlyMap<string, Texture>,
): Map<string, Texture> {
  const out = new Map<string, Texture>();
  for (const page of atlas.pages) {
    const pageTexture = pageTextures.get(page.file);
    if (pageTexture === undefined) continue;
    for (const region of page.regions) {
      out.set(region.name, sliceRegion(pageTexture, region));
    }
  }
  return out;
}

// Wrap a region-name -> Texture map as a resolver. A missing name resolves to null (placeholder), which
// is exactly the partially-loaded-atlas behavior SkeletonView relies on.
export function makeRegionTextureResolver(
  regionTextures: ReadonlyMap<string, Texture>,
): RegionTextureResolver {
  return (regionPath) => regionTextures.get(regionPath) ?? null;
}
