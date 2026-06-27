// Typed error surface for the atlas pack service. Every failure path throws an AtlasError carrying a
// stable machine-readable code (never a bare string), so the IPC layer that later calls this service
// can map it onto the shared IpcResult error model without inspecting message text. The code/message
// pair is intentionally IpcResult-shaped (a code plus a human-readable message).

export type AtlasErrorCode =
  // Configuration the caller controls is invalid (page size, padding, concurrency, page count).
  | 'ATLAS_INVALID_CONFIG'
  // allowRotation was requested. Rotation is disabled in Phase 1 (the rotated-UV render path has no
  // parity test yet, phase-1 section 4.2), so the pack rejects it rather than emit untestable output.
  | 'ATLAS_ROTATION_UNSUPPORTED'
  // A trimmed sprite is larger than a single page; it can never be packed.
  | 'ATLAS_SPRITE_TOO_LARGE'
  // Two sprites resolve to the same region name; the AtlasRef would be ambiguous.
  | 'ATLAS_REGION_DUPLICATE'
  // An RGBA buffer length does not match its declared width*height*4.
  | 'ATLAS_DIMENSION_MISMATCH'
  // PNG decode failed (corrupt or non-PNG input).
  | 'ATLAS_DECODE_FAILED'
  // PNG encode failed.
  | 'ATLAS_ENCODE_FAILED'
  // Background removal was requested but MARIONETTE_REMBG_BIN is not set.
  | 'ATLAS_REMBG_NOT_CONFIGURED'
  // MARIONETTE_REMBG_BIN is set but does not point at an accessible file.
  | 'ATLAS_REMBG_INVALID_BIN'
  // The rembg child process failed (non-zero exit, spawn error, or timeout).
  | 'ATLAS_REMBG_FAILED';

export class AtlasError extends Error {
  readonly code: AtlasErrorCode;

  constructor(code: AtlasErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AtlasError';
    this.code = code;
  }
}

export function isAtlasError(value: unknown): value is AtlasError {
  return value instanceof AtlasError;
}
