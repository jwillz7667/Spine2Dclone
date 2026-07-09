// Typed, loud errors for the headless render-preview boundary (CLAUDE.md error model: typed enums, never
// bare strings). Every failure a caller can provoke (bad viewport, empty content under fit:content,
// unknown animation, a malformed atlas page buffer) is a distinct `code` on a single base class so a host
// (the MCP server first) can branch on the reason and report it precisely.
//
// ROTATED_REGION_UNSUPPORTED was RETIRED in PP-C2: rotated atlas regions are sampled turned-back
// (atlas.ts RegionSampler), matching runtime-web, so the code and its class are gone.

export type RenderPreviewErrorCode =
  | 'INVALID_VIEWPORT'
  | 'ZERO_CONTENT_FIT'
  | 'UNKNOWN_ANIMATION'
  | 'MALFORMED_ATLAS_PAGE'
  | 'INVALID_EFFECT_TRIGGER'
  | 'INVALID_FPS'
  | 'INVALID_FRAME_RANGE'
  | 'EMPTY_SEQUENCE';

export class RenderPreviewError extends Error {
  readonly code: RenderPreviewErrorCode;

  constructor(code: RenderPreviewErrorCode, message: string) {
    super(message);
    this.name = 'RenderPreviewError';
    this.code = code;
  }
}

export class InvalidViewportError extends RenderPreviewError {
  constructor(message: string) {
    super('INVALID_VIEWPORT', message);
    this.name = 'InvalidViewportError';
  }
}

// fit:'content' found nothing to draw, so there is no world AABB to frame. A loud error beats emitting a
// blank frame that silently hides an authoring mistake (the ADR-0006 MCP tool surfaces this as an error).
export class ZeroContentFitError extends RenderPreviewError {
  constructor() {
    super(
      'ZERO_CONTENT_FIT',
      'fit:"content" has no drawable geometry to frame (no visible region or mesh attachments)',
    );
    this.name = 'ZeroContentFitError';
  }
}

export class UnknownAnimationError extends RenderPreviewError {
  constructor(readonly animationId: string) {
    super('UNKNOWN_ANIMATION', `animation "${animationId}" is not defined in the document`);
    this.name = 'UnknownAnimationError';
  }
}

export class MalformedAtlasPageError extends RenderPreviewError {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super('MALFORMED_ATLAS_PAGE', `atlas page "${file}": ${message}`);
    this.name = 'MalformedAtlasPageError';
  }
}

// An effect frame trigger that names neither an effect nor a bundle, or names BOTH. Exactly one of
// `effect`/`bundle` must be supplied so the render target is unambiguous. Unknown effect/bundle NAMES
// surface as runtime-core's typed EffectNotFoundError / BundleNotFoundError from the trigger call.
export class EffectTriggerError extends RenderPreviewError {
  constructor(message: string) {
    super('INVALID_EFFECT_TRIGGER', message);
    this.name = 'EffectTriggerError';
  }
}

// A sequence fps outside the supported [1, 120] range (or not an integer). fps drives both the frame
// sample times and the encoded frame delay, so an out-of-range value is rejected loudly at the boundary
// rather than silently clamped (a clamp would produce a clip at a different speed than the caller asked).
export class InvalidFpsError extends RenderPreviewError {
  constructor(readonly fps: number) {
    super('INVALID_FPS', `fps must be an integer in [1, 120], received ${fps}`);
    this.name = 'InvalidFpsError';
  }
}

// A malformed sequence frame range: a non-integer / negative frame bound, a range that cannot be inferred
// (setup pose or AnimationState with no explicit `to`), or a frame count above the safety cap. A typed
// error so the caller can report the exact reason rather than getting a blank or truncated clip.
export class InvalidFrameRangeError extends RenderPreviewError {
  constructor(message: string) {
    super('INVALID_FRAME_RANGE', message);
    this.name = 'InvalidFrameRangeError';
  }
}

// The resolved frame range contains no frames (to <= from). Rendering an empty clip is almost always a
// caller mistake, so it fails loudly instead of returning a zero-frame GIF/APNG that no viewer accepts.
export class EmptySequenceError extends RenderPreviewError {
  constructor() {
    super('EMPTY_SEQUENCE', 'the resolved frame range is empty (no frames to render)');
    this.name = 'EmptySequenceError';
  }
}
