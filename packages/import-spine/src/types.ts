import type { FormatErrorCode, SkeletonDocument } from '@marionette/format';

// The typed diagnostic model for the Spine importer (PP-A5). Mirrors the shape of the format package's
// FormatError/ValidationReport so a caller (the editor import flow, the MCP server) can render both the
// same way. Errors are FATAL (no document is produced); warnings are LOSSY-BUT-RECOVERABLE conversions
// (a feature the published Spine documentation does not let us convert faithfully, surfaced rather than
// silently dropped, per the LAW 4 guardrails). Codes are a stable, closed contract, never bare strings.

export const SPINE_IMPORT_ERROR_CODES = [
  // The top-level input is not a JSON object (a string, array, number, null, or undefined).
  'SPINE_ROOT_INVALID',
  // The skeleton block is absent or carries no `spine` version string, so the version cannot be gated.
  'SPINE_VERSION_MISSING',
  // The `spine` version is present but is not a supported 4.x export.
  'SPINE_VERSION_UNSUPPORTED',
  // A field has the wrong JSON shape for its documented type (e.g. `bones` is not an array, a bone
  // `name` is missing, `uvs` is not a number array). The `path` points at the offending Spine node.
  'SPINE_SCHEMA',
  // A color string is not a 6 or 8 digit hex value.
  'SPINE_COLOR_INVALID',
  // The converted document is structurally well-formed but fails @marionette/format validateDocument.
  // `detail.formatCode` carries the underlying FormatErrorCode so a caller can react precisely; one
  // SPINE_DOCUMENT_INVALID is emitted per underlying format error (fail loudly, never emit a bad doc).
  'SPINE_DOCUMENT_INVALID',
] as const;

export type SpineImportErrorCode = (typeof SPINE_IMPORT_ERROR_CODES)[number];

export type SpineDiagnosticDetail = Readonly<
  Record<string, string | number | boolean | FormatErrorCode>
>;

export interface SpineImportError {
  readonly code: SpineImportErrorCode;
  // A JSON-Pointer-style path into the SPINE input document, e.g. "/bones/2/parent". The root is "".
  readonly path: string;
  readonly message: string;
  readonly detail?: SpineDiagnosticDetail;
}

// The set of Spine features the importer cannot convert faithfully from the PUBLISHED format
// documentation alone. Each is surfaced as a warning (never a silent drop) with the reason, so a user
// sees exactly what did not survive the migration. See the README "Unsupported features" section.
export const SPINE_IMPORT_WARNING_FEATURES = [
  // Physics constraints: the physics JSON field layout is not part of the published documentation the
  // importer was built from, so physics constraints and their timelines are not converted.
  'physics-constraint',
  'physics-timeline',
  // Draw-order timelines: reconstructing Spine's offset-shift permutation is a runtime algorithm not
  // specified in the published format documentation, so it cannot be re-encoded into our offset model
  // without guessing. The timeline is dropped rather than approximated.
  'draw-order-timeline',
  // Frame-sequence attachment playback: the `sequence` attachment sub-block is not part of the
  // published documentation the importer was built from, so it is stripped from the attachment.
  'sequence-attachment',
  // Per-key event audio (volume/balance) overrides: our event timeline keys carry int/float/string
  // overrides only, so a keyed audio override is dropped (the event definition default still applies).
  'event-audio-override',
  // An attachment whose `type` is not one of the documented kinds is skipped.
  'unknown-attachment-type',
  // A two-color (dark tint) timeline exists but the slot has no setup dark color; a black setup dark
  // color is synthesized so the animation is representable.
  'two-color-synthesized-dark',
  // Spine JSON carries no atlas region geometry (that lives in the sibling .atlas file); the importer
  // synthesizes placeholder atlas regions so attachment paths resolve and the document validates.
  'atlas-synthesized',
] as const;

export type SpineImportWarningFeature = (typeof SPINE_IMPORT_WARNING_FEATURES)[number];

export interface SpineImportWarning {
  readonly feature: SpineImportWarningFeature;
  // A JSON-Pointer-style path into the SPINE input, or the root ("") for document-wide notes.
  readonly path: string;
  readonly why: string;
  readonly detail?: SpineDiagnosticDetail;
}

// The result of importSpineJson. A discriminated union on `ok`: on success `document` is a VALIDATED
// SkeletonDocument (validateDocument has already passed) plus any lossy-conversion warnings; on failure
// `errors` is the non-empty typed error list. Warnings may be present on both arms.
export type SpineImportResult =
  | {
      readonly ok: true;
      readonly document: SkeletonDocument;
      readonly warnings: readonly SpineImportWarning[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly SpineImportError[];
      readonly warnings: readonly SpineImportWarning[];
    };

// Options for importSpineJson. The Spine JSON format carries no project name, so the caller may supply
// one; it defaults to DEFAULT_SKELETON_NAME. Everything else about the conversion is deterministic.
export interface SpineImportOptions {
  readonly name?: string;
}

export const DEFAULT_SKELETON_NAME = 'imported-skeleton';
