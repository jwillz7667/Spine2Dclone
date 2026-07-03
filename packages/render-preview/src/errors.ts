// Typed, loud errors for the headless render-preview boundary (CLAUDE.md error model: typed enums, never
// bare strings). Every failure a caller can provoke (bad viewport, empty content under fit:content,
// unknown animation, a rotated atlas region, a malformed atlas page buffer) is a distinct `code` on a
// single base class so a host (the MCP server first) can branch on the reason and report it precisely.

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

// An atlas region packed rotated 90 degrees. The current format never rotates regions (AtlasRegion.rotated
// is always false; see runtime-web region-textures.ts RotatedRegionUnsupportedError) and an axis-aligned
// sample of a rotated region would render it turned, which is silently wrong. Fail loud, exactly like the
// runtime-web renderer, until the Phase 5 packer that produces rotated regions lands.
export class RotatedRegionUnsupportedError extends RenderPreviewError {
  constructor(readonly regionName: string) {
    super(
      'ROTATED_REGION_UNSUPPORTED',
      `atlas region "${regionName}" is packed rotated, which render-preview does not support`,
    );
    this.name = 'RotatedRegionUnsupportedError';
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
