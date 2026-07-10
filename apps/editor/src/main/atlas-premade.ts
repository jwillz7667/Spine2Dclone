import type { AtlasPage, AtlasRef, AtlasRegion } from '@marionette/format/types';

// PURE builder for the pre-made atlas import (PP-D5): turn an EXISTING packed sheet the user already has
// (image + a region descriptor, or a plain grid sprite sheet) into a validated AtlasRef, WITHOUT repacking.
// No Electron and no filesystem live here, so the region math and the typed diagnostics are unit-testable
// headless; the dialog/IO wrapper (atlas-premade-import.ts) reads the files, decodes the PNGs for their true
// pixel dimensions, and calls these functions. Coordinates follow our packer's page convention: region x/y
// is the TOP-LEFT of the region on the page, y-DOWN, and a `rotated` region carries its LOGICAL (unrotated)
// w/h while occupying an (h x w) footprint on the page (pack.ts). A region carries no trim here (offsetX =
// offsetY = 0, originalW/H = w/h): the sheet is already the artist's authored layout, not an alpha-trimmed
// repack. Every region field is range-checked here (integer, non-negative, in-bounds, unique name) and a
// violation is a typed error (LAW 3); the whole atlas is re-validated by the format validator when the
// document that carries it is exported (the same trust boundary the packed-atlas import path relies on).

export type PremadeAtlasErrorCode =
  // The descriptor JSON is neither our AtlasRef shape nor a recognized generic region list.
  | 'ATLAS_DESCRIPTOR_INVALID'
  // A recognized descriptor carried zero regions (nothing to import).
  | 'ATLAS_DESCRIPTOR_EMPTY'
  // A region field is missing, non-finite, non-integer, or a non-positive size.
  | 'ATLAS_REGION_INVALID'
  // A region rectangle falls outside its page image (its true decoded pixel bounds).
  | 'ATLAS_REGION_OUT_OF_BOUNDS'
  // Two regions resolve to the same name; the AtlasRef would be ambiguous.
  | 'ATLAS_REGION_DUPLICATE'
  // The grid-slice parameters do not yield at least one whole cell inside the image.
  | 'ATLAS_GRID_INVALID';

export interface PremadeAtlasError {
  readonly code: PremadeAtlasErrorCode;
  readonly message: string;
}

export type PremadeAtlasResult =
  | { readonly ok: true; readonly atlas: AtlasRef }
  | { readonly ok: false; readonly error: PremadeAtlasError };

// A region as it appears in a generic descriptor: a name plus a page rectangle and an optional rotation.
// `rotation` is degrees (only 0 and 90 are meaningful for a packed region); `rotated` is the boolean form.
// Either may be present; a 90-degree rotation or `rotated: true` marks the region rotated.
export interface GenericRegionInput {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rotation?: number;
  readonly rotated?: boolean;
}

// A generic descriptor: named regions over a single page image. `image`, when present, names the page file;
// otherwise the IO wrapper defaults it to the descriptor's sibling image. A bare region array is also
// accepted (image left implicit).
export interface GenericDescriptor {
  readonly image: string | null;
  readonly regions: readonly GenericRegionInput[];
}

// The classification of a parsed descriptor JSON: our own multi-page AtlasRef (validated verbatim, only
// re-checked against the true page dimensions), or a generic single-page region list.
export type ParsedDescriptor =
  | { readonly kind: 'atlasRef'; readonly atlas: AtlasRef }
  | { readonly kind: 'regions'; readonly descriptor: GenericDescriptor };

export type DescriptorParseResult =
  | { readonly ok: true; readonly parsed: ParsedDescriptor }
  | { readonly ok: false; readonly error: PremadeAtlasError };

// The grid-slice parameters for a plain sprite sheet with no descriptor. `cell` fixes the tile pixel size
// (columns/rows derived by flooring the image size); `grid` fixes the column/row count (tile size derived).
// Remainder pixels at the right/bottom edge that do not fill a whole cell are dropped (documented behavior).
export type GridSpec =
  | { readonly mode: 'cell'; readonly cellWidth: number; readonly cellHeight: number }
  | { readonly mode: 'grid'; readonly columns: number; readonly rows: number };

function error(
  code: PremadeAtlasErrorCode,
  message: string,
): { readonly ok: false; readonly error: PremadeAtlasError } {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// The on-page footprint of a region: a rotated region is stored turned 90 degrees, so its page rectangle is
// (h wide, w tall) even though its logical size stays (w, h). Bounds checks use the footprint.
function pageFootprint(region: Pick<AtlasRegion, 'w' | 'h' | 'rotated'>): {
  readonly fw: number;
  readonly fh: number;
} {
  return region.rotated ? { fw: region.h, fh: region.w } : { fw: region.w, fh: region.h };
}

// Structurally validate an object carrying a `pages` array as our own AtlasRef, without a deep import of the
// format schema (barrel-only rule). Every field is checked (finite numbers, integer rectangles, boolean
// `rotated`); a malformed page or region rejects the whole descriptor. Bounds and name uniqueness are
// re-checked against the true page images in validateAtlasRefPages.
function parseAtlasRefShape(json: Record<string, unknown>): AtlasRef | null {
  const rawPages = json['pages'];
  if (!Array.isArray(rawPages)) return null;
  const pages: AtlasPage[] = [];
  for (const rawPage of rawPages) {
    if (!isRecord(rawPage)) return null;
    const { file, width, height, regions } = rawPage;
    if (typeof file !== 'string' || file.length === 0) return null;
    if (!isNonNegInt(width) || !isNonNegInt(height) || !Array.isArray(regions)) return null;
    const parsedRegions: AtlasRegion[] = [];
    for (const rawRegion of regions) {
      const region = parseRegionShape(rawRegion);
      if (region === null) return null;
      parsedRegions.push(region);
    }
    pages.push({ file, width, height, regions: parsedRegions });
  }
  return { pages };
}

function parseRegionShape(raw: unknown): AtlasRegion | null {
  if (!isRecord(raw)) return null;
  const { name, x, y, w, h, rotated, offsetX, offsetY, originalW, originalH } = raw;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (!isNonNegInt(x) || !isNonNegInt(y) || !isPositiveInt(w) || !isPositiveInt(h)) return null;
  if (typeof rotated !== 'boolean') return null;
  if (!isFiniteNumber(offsetX) || !isFiniteNumber(offsetY)) return null;
  if (!isPositiveInt(originalW) || !isPositiveInt(originalH)) return null;
  return { name, x, y, w, h, rotated, offsetX, offsetY, originalW, originalH };
}

// Classify a parsed descriptor JSON. Our AtlasRef shape (an object with a `pages` array) is validated
// structurally so a malformed one fails loudly here; anything with a `regions` array (or a bare region
// array) is treated as a generic single-page list; everything else is ATLAS_DESCRIPTOR_INVALID.
export function classifyDescriptor(json: unknown): DescriptorParseResult {
  if (isRecord(json) && Array.isArray(json['pages'])) {
    const atlas = parseAtlasRefShape(json);
    if (atlas === null) {
      return error(
        'ATLAS_DESCRIPTOR_INVALID',
        'atlas descriptor has a "pages" array but is not a valid atlas (bad page or region field)',
      );
    }
    return { ok: true, parsed: { kind: 'atlasRef', atlas } };
  }

  const rawRegions = Array.isArray(json) ? json : isRecord(json) ? json['regions'] : undefined;
  if (!Array.isArray(rawRegions)) {
    return error(
      'ATLAS_DESCRIPTOR_INVALID',
      'atlas descriptor must be an atlas ({ pages: [...] }), a region list ({ regions: [...] }), or a bare region array',
    );
  }

  const image = isRecord(json) && typeof json['image'] === 'string' ? json['image'] : null;
  const regions: GenericRegionInput[] = [];
  for (let i = 0; i < rawRegions.length; i += 1) {
    const raw = rawRegions[i];
    if (!isRecord(raw)) {
      return error('ATLAS_REGION_INVALID', `region ${i} is not an object`);
    }
    const { name, x, y, w, h } = raw;
    if (typeof name !== 'string' || name.length === 0) {
      return error('ATLAS_REGION_INVALID', `region ${i} is missing a non-empty "name"`);
    }
    if (!isNonNegInt(x) || !isNonNegInt(y) || !isPositiveInt(w) || !isPositiveInt(h)) {
      return error('ATLAS_REGION_INVALID', `region "${name}" needs integer x,y >= 0 and w,h > 0`);
    }
    const rotated =
      raw['rotated'] === true ||
      (typeof raw['rotation'] === 'number' && raw['rotation'] % 360 !== 0);
    regions.push({ name, x, y, w, h, rotated });
  }
  return { ok: true, parsed: { kind: 'regions', descriptor: { image, regions } } };
}

function toRegion(input: GenericRegionInput): AtlasRegion {
  const rotated =
    input.rotated === true || (typeof input.rotation === 'number' && input.rotation % 360 !== 0);
  return {
    name: input.name,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    rotated,
    offsetX: 0,
    offsetY: 0,
    originalW: input.w,
    originalH: input.h,
  };
}

// Validate a list of regions against one page's true pixel size and assemble a single-page AtlasRef. Each
// region must be an integer rectangle that fits inside the page footprint, and names must be unique. The
// assembled AtlasRef is re-validated with the format schema before it is returned (belt-and-suspenders over
// the field checks; LAW 3).
export function buildSinglePageAtlas(
  pageFile: string,
  pageWidth: number,
  pageHeight: number,
  regions: readonly GenericRegionInput[],
): PremadeAtlasResult {
  if (regions.length === 0) {
    return error('ATLAS_DESCRIPTOR_EMPTY', 'the descriptor lists no regions');
  }
  const seen = new Set<string>();
  const built: AtlasRegion[] = [];
  for (const input of regions) {
    if (seen.has(input.name)) {
      return error('ATLAS_REGION_DUPLICATE', `region name "${input.name}" appears more than once`);
    }
    seen.add(input.name);
    const region = toRegion(input);
    const { fw, fh } = pageFootprint(region);
    if (region.x + fw > pageWidth || region.y + fh > pageHeight) {
      return error(
        'ATLAS_REGION_OUT_OF_BOUNDS',
        `region "${region.name}" (${region.x},${region.y} ${fw}x${fh}) falls outside the ${pageWidth}x${pageHeight} page "${pageFile}"`,
      );
    }
    built.push(region);
  }
  return {
    ok: true,
    atlas: { pages: [{ file: pageFile, width: pageWidth, height: pageHeight, regions: built }] },
  };
}

// The true decoded pixel size of a page image, keyed by the page `file` the descriptor references.
export interface PageDimensions {
  readonly width: number;
  readonly height: number;
}

// Re-validate an as-authored AtlasRef (our own descriptor shape) against the ACTUAL decoded page images: a
// descriptor could claim a page size that its image does not have, or place a region off the real bitmap.
// Every page must have a decoded image, and every region must fit its page's true footprint with a unique
// name across the whole atlas.
export function validateAtlasRefPages(
  atlas: AtlasRef,
  pageDimensions: ReadonlyMap<string, PageDimensions>,
): PremadeAtlasResult {
  const names = new Set<string>();
  const pages: AtlasPage[] = [];
  for (const page of atlas.pages) {
    const dims = pageDimensions.get(page.file);
    if (dims === undefined) {
      return error(
        'ATLAS_REGION_INVALID',
        `page image "${page.file}" was not found next to the descriptor`,
      );
    }
    for (const region of page.regions) {
      if (names.has(region.name)) {
        return error(
          'ATLAS_REGION_DUPLICATE',
          `region name "${region.name}" appears more than once`,
        );
      }
      names.add(region.name);
      const { fw, fh } = pageFootprint(region);
      if (
        region.x < 0 ||
        region.y < 0 ||
        region.x + fw > dims.width ||
        region.y + fh > dims.height
      ) {
        return error(
          'ATLAS_REGION_OUT_OF_BOUNDS',
          `region "${region.name}" (${region.x},${region.y} ${fw}x${fh}) falls outside the ${dims.width}x${dims.height} page "${page.file}"`,
        );
      }
    }
    // Trust the descriptor's regions but pin the page size to the true image so downstream UV math is exact.
    pages.push({ file: page.file, width: dims.width, height: dims.height, regions: page.regions });
  }
  if (names.size === 0) {
    return error('ATLAS_DESCRIPTOR_EMPTY', 'the atlas descriptor lists no regions');
  }
  return { ok: true, atlas: { pages } };
}

// Slice a plain sprite sheet into a uniform grid of regions named "<prefix>_<index>" in row-major order.
// Cell mode floors the image size by the tile size; grid mode floors the image size by the column/row count.
// Either way at least one whole cell must fit, and remainder pixels are dropped.
export function buildGridAtlas(
  pageFile: string,
  pageWidth: number,
  pageHeight: number,
  spec: GridSpec,
  namePrefix: string,
): PremadeAtlasResult {
  const layout = gridLayout(pageWidth, pageHeight, spec);
  if (!layout.ok) return layout;
  const { columns, rows, cellWidth, cellHeight } = layout;
  const regions: AtlasRegion[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      regions.push({
        name: `${namePrefix}_${index}`,
        x: column * cellWidth,
        y: row * cellHeight,
        w: cellWidth,
        h: cellHeight,
        rotated: false,
        offsetX: 0,
        offsetY: 0,
        originalW: cellWidth,
        originalH: cellHeight,
      });
      index += 1;
    }
  }
  return {
    ok: true,
    atlas: { pages: [{ file: pageFile, width: pageWidth, height: pageHeight, regions }] },
  };
}

type GridLayout =
  | {
      readonly ok: true;
      readonly columns: number;
      readonly rows: number;
      readonly cellWidth: number;
      readonly cellHeight: number;
    }
  | { readonly ok: false; readonly error: PremadeAtlasError };

function gridLayout(pageWidth: number, pageHeight: number, spec: GridSpec): GridLayout {
  if (spec.mode === 'cell') {
    if (!isPositiveInt(spec.cellWidth) || !isPositiveInt(spec.cellHeight)) {
      return error('ATLAS_GRID_INVALID', 'cell width and height must be positive integers');
    }
    const columns = Math.floor(pageWidth / spec.cellWidth);
    const rows = Math.floor(pageHeight / spec.cellHeight);
    if (columns < 1 || rows < 1) {
      return error(
        'ATLAS_GRID_INVALID',
        `a ${spec.cellWidth}x${spec.cellHeight} cell does not fit inside the ${pageWidth}x${pageHeight} image`,
      );
    }
    return { ok: true, columns, rows, cellWidth: spec.cellWidth, cellHeight: spec.cellHeight };
  }
  if (!isPositiveInt(spec.columns) || !isPositiveInt(spec.rows)) {
    return error('ATLAS_GRID_INVALID', 'column and row counts must be positive integers');
  }
  const cellWidth = Math.floor(pageWidth / spec.columns);
  const cellHeight = Math.floor(pageHeight / spec.rows);
  if (cellWidth < 1 || cellHeight < 1) {
    return error(
      'ATLAS_GRID_INVALID',
      `${spec.columns}x${spec.rows} cells do not fit inside the ${pageWidth}x${pageHeight} image`,
    );
  }
  return { ok: true, columns: spec.columns, rows: spec.rows, cellWidth, cellHeight };
}
