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

// Thrown when an atlas region is packed rotated. Phase 1 never rotates regions (format invariant:
// AtlasRegion.rotated is always false), and an axis-aligned slice of a rotated region would render it
// turned 90 degrees, which is silently wrong. So we fail loud here instead; rotated-UV handling lands
// with the packer that can produce it (Phase 5), at which point this guard is replaced, not bypassed.
export class RotatedRegionUnsupportedError extends Error {
  constructor(readonly regionName: string) {
    super(
      `atlas region "${regionName}" is packed rotated, which runtime-web does not yet support (Phase 1 regions are never rotated)`,
    );
    this.name = 'RotatedRegionUnsupportedError';
  }
}

// Slice one region's sub-Texture out of a loaded page Texture. The sub-texture SHARES the page's
// GPU source (TextureSource) and only carries its own `frame` rect, so this allocates no pixels and
// uploads nothing: it is a UV window onto the page (PixiJS v8 `new Texture({ source, frame })`, where
// Texture.width/height read back as the frame's w/h). Lifecycle: the HOST owns the page base textures;
// these frames are lightweight views over that shared source, so the view must NOT destroy them (doing
// so would tear down the host's page). Trim (offsetX/offsetY/originalW/originalH) is not applied: Phase
// 1 regions are untrimmed (offset 0, original == packed), and applying trim would shift the quad.
export function sliceRegion(pageTexture: Texture, region: AtlasRegion): Texture {
  if (region.rotated) throw new RotatedRegionUnsupportedError(region.name);
  return new Texture({
    source: pageTexture.source,
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
