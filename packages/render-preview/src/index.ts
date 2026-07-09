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
// slot x attachment tint/alpha, bilinear sampling, straight-alpha OVER compositing. The effects extension
// (renderEffectFrame / renderComposedFrame) adds particle/bundle frames and composed skeleton+effect
// frames through the SAME rasterizer. Stage-F2 (PP-C8) adds the two-color dark tint (two-color.ts), linked
// meshes (rendered as their resolved parent geometry), and sequence attachments (per-sample atlas frame
// selection). OUT OF SCOPE and documented (not silently missing): clipping masks (pending PP-B2),
// point/boundingbox attachments, and the slot-scene composition. Each lands as a follow-up extension.
//
// DETERMINISM CONTRACT: same document + same inputs => byte-identical PNG on a given platform/Node
// version. No wall clock, no randomness, no platform text rendering. Every loop (draw order, scanlines,
// compositing, quantization) runs in a fixed pinned order, so there is no floating-point-order dependence.
// The rasterizer uses a pinned top-left fill rule and pinned bilinear sampling; the PNG encoder pins its
// filter and deflate settings. The package reads no files and holds no state between calls.

export { renderFrame } from './render-frame';
export type { RenderFrameOptions, RenderFrameResult } from './render-frame';

// The effects extension (ADR-0006 scope extension): render a particle EFFECT or BUNDLE frame, and a
// composed skeleton+effect frame, through the same deterministic PNG pipeline. The effects SOLVE stays in
// runtime-core (stepped via its public EffectSystem API); this package only rasterizes readState().
export { renderEffectFrame, renderComposedFrame } from './render-effect-frame';
export type {
  RenderEffectFrameOptions,
  RenderComposedFrameOptions,
  EffectFrameTrigger,
  EffectAnchorInput,
} from './render-effect-frame';
// Re-exported for ergonomics: a bone-anchor input resolves through this runtime-core resolver type.
export type { BoneAnchorResolver } from '@marionette/runtime-core';

// Rendered-media export (PP-C10): a deterministic frame-sequence pipeline (an animation, setup pose, or
// AnimationState track setup sampled at a chosen fps and range) and two pure-TypeScript animated-image
// encoders (GIF89a, APNG) built on it. The sequence streams frames (one reused RGBA scratch buffer, PNG on
// demand) so a long clip never holds every frame in memory. Video (WebM/MP4) is intentionally NOT here: it
// belongs to a bundled editor-edge encoder in a later slice, never a runtime dependency.
export { renderSequence } from './render-sequence';
export type {
  RenderSequenceOptions,
  SingleAnimationSequenceOptions,
  AnimationStateSequenceOptions,
  SequenceBaseOptions,
  SequenceBound,
  SequenceEffect,
  SequenceFrame,
  RenderedSequence,
} from './render-sequence';
// Re-exported so the AnimationState clip source's factory signature is nameable from the barrel.
export type { SkeletonDocument } from '@marionette/format/types';
export type { AnimationState } from '@marionette/runtime-core';

export { encodeGif } from './encode/gif';
export type { GifEncodeOptions } from './encode/gif';
export { encodeApng } from './encode/apng';
export type { ApngEncodeOptions } from './encode/apng';

export type { AtlasPixelSource, AtlasPagePixels, TextureSampler } from './atlas';

export type { Viewport, FitMode, WorldRect, WorldToImage } from './viewport';
export { CONTENT_PAD_FRACTION } from './viewport';

export type { Color } from './color';
export { TRANSPARENT } from './color';

// The shared two-color (light + dark) tint combine (PP-C8), the single definition both this CPU rasterizer
// and the runtime-web GPU shader implement identically. Exported so parity tests can assert both renderers
// produce the same straight-alpha output for the same inputs.
export { combineTwoColor } from './two-color';

// Placement parity primitives: the world-space region quad geometry, reproducing the runtime-web
// region-placement math against runtime-core only (see geometry.ts). Exported so tooling and parity tests
// can assert that what the rasterizer draws matches the runtimes' placement.
export type { Point, RegionTrim } from './geometry';
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
  MalformedAtlasPageError,
  EffectTriggerError,
  InvalidFpsError,
  InvalidFrameRangeError,
  EmptySequenceError,
} from './errors';
export type { RenderPreviewErrorCode } from './errors';
