// Shared normalized shapes for the layered-file import (PP-D5). A PSD (ag-psd) and an ORA (zip of PNGs +
// stack.xml) parse into the SAME LayeredDocument so the layers-to-rig projection (layered-to-rig.ts) is one
// pure function of a renderer-agnostic value, independent of which format it came from. Coordinates are the
// source document's pixel space: top-left origin, y-DOWN, matching both formats' layer bounds (and, happily,
// our region/attachment world convention, so the projection needs no y-flip).

// One extracted raster layer: a name, its document-space bounds, straight-alpha RGBA pixels, and setup-pose
// visibility. Group layers are flattened away; their name is path-joined into the leaf name ("arm/hand").
export interface RasterLayer {
  readonly name: string;
  // Top-left of the layer in document pixel space (y-down).
  readonly left: number;
  readonly top: number;
  // Pixel size of `rgba` (>= 1 each). Row-major RGBA, length === width * height * 4.
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly visible: boolean;
}

// A layer feature the importer could not represent, surfaced (never dropped silently). `layer` is the
// path-joined layer name, or empty for a document-wide note (e.g. an exotic bit depth).
export type LayeredDiagnosticFeature =
  // The document is not 8-bit (16/32-bit); only the 8-bit RGBA raster subset is certified.
  | 'unsupported-bit-depth'
  // A layer carries no raster pixels the parser can extract (adjustment, text, shape, or a smart object
  // without an embedded composite): it is skipped.
  | 'non-raster-layer'
  // A layer resolved to a zero-area bitmap: it is skipped.
  | 'empty-layer'
  // An ORA stack referenced a `src` that is not present in the archive, or is not a decodable PNG.
  | 'ora-missing-src'
  // The file parsed but contained no usable raster layer at all.
  | 'no-layers';

export interface LayeredDiagnostic {
  readonly feature: LayeredDiagnosticFeature;
  readonly layer: string;
  readonly why: string;
}

// The renderer-agnostic result of parsing a layered file: the canvas size, the raster layers in FILE order
// (top-first, as both PSD and ORA store them; the projection reverses for draw order), and the diagnostics.
export interface LayeredDocument {
  readonly name: string;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly layers: readonly RasterLayer[];
  readonly diagnostics: readonly LayeredDiagnostic[];
}

// Join a group path with a child name for a flattened layer name; a blank child name falls back to a stable
// placeholder so a nameless layer still gets a usable, unique-able region name.
export function joinLayerName(prefix: string, name: string | undefined): string {
  const leaf = name !== undefined && name.trim().length > 0 ? name.trim() : 'layer';
  return prefix.length > 0 ? `${prefix}/${leaf}` : leaf;
}

// A structural failure to parse a layered file (as opposed to a per-layer diagnostic): the file is corrupt,
// not the expected container, or missing its layer stack. The orchestrator maps the stable code onto the
// failed-import response so the renderer can report it. Import only.
export type LayeredParseErrorCode =
  // ag-psd could not read the PSD (corrupt or truncated).
  | 'PSD_PARSE_FAILED'
  // The ORA file is not a readable zip archive.
  | 'ORA_NOT_A_ZIP'
  // The ORA archive has no stack.xml (not a valid OpenRaster file).
  | 'ORA_NO_STACK'
  // stack.xml could not be parsed or has no <image> root.
  | 'ORA_BAD_STACK';

export class LayeredParseError extends Error {
  readonly code: LayeredParseErrorCode;

  constructor(code: LayeredParseErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LayeredParseError';
    this.code = code;
  }
}

export function isLayeredParseError(value: unknown): value is LayeredParseError {
  return value instanceof LayeredParseError;
}
