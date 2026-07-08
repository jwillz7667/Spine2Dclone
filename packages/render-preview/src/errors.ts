// Typed, loud errors for the headless render-preview boundary (CLAUDE.md error model: typed enums, never
// bare strings). Every failure a caller can provoke (bad viewport, empty content under fit:content,
// unknown animation, a malformed atlas page buffer) is a distinct `code` on a single base class so a host
// (the MCP server first) can branch on the reason and report it precisely.
//
// ROTATED_REGION_UNSUPPORTED is RETIRED (PP-C2): rotated atlas regions are now sampled turned-back
// (atlas.ts RegionSampler), matching runtime-web, so render-preview never emits this code and the
// RotatedRegionUnsupportedError class is gone. The code string is kept RESERVED in the union so the MCP
// server's exhaustive render-error mapping (mcp-server tools.ts) stays valid without a cross-lane edit;
// dropping it there and here is a small Lane D follow-up.

export type RenderPreviewErrorCode =
  | 'INVALID_VIEWPORT'
  | 'ZERO_CONTENT_FIT'
  | 'UNKNOWN_ANIMATION'
  | 'ROTATED_REGION_UNSUPPORTED'
  | 'MALFORMED_ATLAS_PAGE'
  | 'INVALID_EFFECT_TRIGGER';

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
