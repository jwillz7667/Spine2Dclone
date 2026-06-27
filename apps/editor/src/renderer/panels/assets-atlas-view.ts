import type { AtlasRef } from '@marionette/format/types';

// Pure projection of an AtlasRef into the flat, display-ready region list the Assets panel renders. All
// flattening and labeling lives here so it is unit-testable in the Node test env (the panel .tsx cannot
// render without a DOM, mirroring how animation-manager.ts and hierarchy-tree.ts hold the testable logic
// for their panels). Region order follows the deterministic pack order (page order, then region order
// within a page), and region names are unique across all pages (ATLAS_REGION_DUPLICATE), so the name is a
// stable React key. This is the surface WP-1.2's inspector reads to attach a region to a slot.

export interface AtlasRegionView {
  readonly name: string;
  // The trimmed region size as "WxH", from the region's packed (trimmed) width and height.
  readonly label: string;
}

export interface AtlasView {
  readonly pageCount: number;
  readonly regionCount: number;
  readonly regions: readonly AtlasRegionView[];
}

export function buildAtlasView(atlas: AtlasRef): AtlasView {
  const regions = atlas.pages.flatMap((page) =>
    page.regions.map((region) => ({
      name: region.name,
      label: `${region.w}x${region.h}`,
    })),
  );
  return {
    pageCount: atlas.pages.length,
    regionCount: regions.length,
    regions,
  };
}
