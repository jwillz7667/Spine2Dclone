// Public barrel for @marionette/render-preview: a pure-TypeScript CPU rasterizer that renders a
// SkeletonDocument frame to PNG bytes for headless authoring feedback (ADR-0006). It is an AUTHORING
// PREVIEW, not the shipped renderer: the runtimes ship PixiJS/Unity/Godot; this package exists so
// headless tools (the MCP server first, CI visual smoke tests later) can SEE a frame without a GPU.
//
// Dependencies: @marionette/format (validate + types) and @marionette/runtime-core (the solve) only, plus
// pngjs (pure JS) for the codec. NO PixiJS, NO runtime-web (it depends on PixiJS): the geometry is the
// SAME runtime-core solve output the runtimes consume (regionWorldCorners mirrors runtime-web
// region-placement; meshes come straight from skinMeshInto/sampleMeshVertices), so this second raster
// path cannot drift on geometry; only shading is preview-quality, and its scope is pinned by the ADR.
//
// v1 scope (ADR-0006): region + mesh attachments, per-slot blend modes (normal/additive/multiply/screen),
// slot x attachment tint/alpha, bilinear sampling, straight-alpha OVER compositing. OUT OF SCOPE and
// documented (not silently missing): particles/effects frames, clipping masks, tint-black (slot darkColor),
// point/boundingbox attachments, and the slot-scene composition. Each lands as a follow-up extension.
//
// DETERMINISM CONTRACT: same document + same inputs => byte-identical PNG on a given platform/Node
// version. No wall clock, no randomness, no platform text rendering. Every loop (draw order, scanlines,
// compositing, quantization) runs in a fixed pinned order, so there is no floating-point-order dependence.
// The rasterizer uses a pinned top-left fill rule and pinned bilinear sampling; the PNG encoder pins its
// filter and deflate settings. The package reads no files and holds no state between calls.

export { renderFrame } from './render-frame';
export type { RenderFrameOptions, RenderFrameResult } from './render-frame';

export type { AtlasPixelSource, AtlasPagePixels, TextureSampler } from './atlas';

export type { Viewport, FitMode, WorldRect, WorldToImage } from './viewport';
export { CONTENT_PAD_FRACTION } from './viewport';

export type { Color } from './color';
export { TRANSPARENT } from './color';

// Placement parity primitives: the world-space region quad geometry, reproducing the runtime-web
// region-placement math against runtime-core only (see geometry.ts). Exported so tooling and parity tests
// can assert that what the rasterizer draws matches the runtimes' placement.
export type { Point } from './geometry';
export {
  regionWorldCorners,
  regionSizedLocal,
  REGION_QUAD_UVS,
  REGION_QUAD_TRIANGLES,
} from './geometry';

export {
  RenderPreviewError,
  InvalidViewportError,
  ZeroContentFitError,
  UnknownAnimationError,
  RotatedRegionUnsupportedError,
  MalformedAtlasPageError,
} from './errors';
export type { RenderPreviewErrorCode } from './errors';
