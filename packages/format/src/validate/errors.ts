import type { SkeletonDocument } from '../schema/document';

// The typed error and warning model (format-contract section 8.2). Errors are discriminated by a
// stable `code` and located by a JSON Pointer `path`, never by bare strings (house rule).
//
// FORMAT_ERROR_CODES is the single source of both the `FormatErrorCode` type and a runtime
// membership set (used to map refinement issues and to guard the corpus). The full union is the
// stable contract surface; the Phase-0 validators reach the subset listed in PHASE0_REACHABLE_CODES
// (see validate/index.ts and the corpus tests). Codes outside that subset are produced by the
// mesh/animation/constraint/migration validators that land in later phases (LAW 5).
export const FORMAT_ERROR_CODES = [
  'SCHEMA_SHAPE',
  'UNSUPPORTED_FORMAT_VERSION',
  'MIGRATION_REQUIRED',
  'BONE_NAME_DUPLICATE',
  'BONE_PARENT_MISSING',
  'BONE_ORDER_VIOLATION',
  'SLOT_NAME_DUPLICATE',
  'SLOT_BONE_MISSING',
  'SLOT_ATTACHMENT_MISSING',
  'SKIN_DEFAULT_MISSING',
  'SKIN_SLOT_UNKNOWN',
  'ATLAS_REGION_DUPLICATE',
  'ATTACHMENT_REGION_MISSING',
  'MESH_UV_LENGTH',
  'MESH_TRIANGLE_LENGTH',
  'MESH_TRIANGLE_INDEX_RANGE',
  'MESH_HULL_RANGE',
  'MESH_EDGE_INVALID',
  'MESH_VERTEX_LENGTH',
  'MESH_WEIGHT_DECODE',
  'MESH_WEIGHT_BONE_RANGE',
  'MESH_WEIGHT_BONES_MANIFEST',
  'MESH_WEIGHT_SUM',
  'MESH_WEIGHT_INFLUENCE_CAP',
  'CLIPPING_END_MISSING',
  'CLIPPING_END_ORDER',
  'POLY_VERTEX_LENGTH',
  'IK_BONES_ARITY',
  'IK_BONE_MISSING',
  'IK_TARGET_MISSING',
  'IK_CHAIN_DISCONTINUOUS',
  'IK_MIX_RANGE',
  'TC_BONE_MISSING',
  'TC_TARGET_MISSING',
  'TC_MIX_RANGE',
  'CONSTRAINT_NAME_DUPLICATE',
  'ANIM_BONE_UNKNOWN',
  'ANIM_SLOT_UNKNOWN',
  'ANIM_IK_UNKNOWN',
  'ANIM_TRANSFORM_UNKNOWN',
  'ANIM_TIME_RANGE',
  'ANIM_TIME_ORDER',
  'ANIM_DURATION',
  'CURVE_BEZIER_X_RANGE',
  'COLOR_RANGE',
  'DRAWORDER_INCOMPLETE',
  'DEFORM_SKIN_UNKNOWN',
  'DEFORM_SLOT_UNKNOWN',
  'DEFORM_ATTACHMENT_UNKNOWN',
  'DEFORM_NOT_MESH',
  'DEFORM_OFFSET_LENGTH',
  'EVENT_NAME_DUPLICATE',
  'ANIM_EVENT_UNKNOWN',
  'EVENT_AUDIO_RANGE',
  'HASH_MISMATCH',
  // Stage F2 (ADR-0009, formatVersion 0.4.0): constraint depth, linked meshes, sequences, timeline
  // granularity, and skin scoping. Families: IK_SOFTNESS_RANGE and SEQUENCE_SETUP_RANGE are SCHEMA
  // (structural refinements); CONSTRAINT_ORDER_INVALID is CONSTRAINT; the LINKED_MESH_* codes are MESH;
  // TIMELINE_COMPONENT_CONFLICT and ANIM_DARK_NO_SETUP are ANIM; SKIN_BONE/CONSTRAINT_UNKNOWN are SKIN.
  'IK_SOFTNESS_RANGE',
  'CONSTRAINT_ORDER_INVALID',
  'LINKED_MESH_PARENT_MISSING',
  'LINKED_MESH_PARENT_INVALID',
  'LINKED_MESH_CYCLE',
  'SEQUENCE_SETUP_RANGE',
  'TIMELINE_COMPONENT_CONFLICT',
  'ANIM_DARK_NO_SETUP',
  'SKIN_BONE_UNKNOWN',
  'SKIN_CONSTRAINT_UNKNOWN',
] as const;

export type FormatErrorCode = (typeof FORMAT_ERROR_CODES)[number];

const FORMAT_ERROR_CODE_SET: ReadonlySet<string> = new Set(FORMAT_ERROR_CODES);

// True when `value` is one of the known format error codes. Used by the structural mapper to read a
// refinement issue's `params.code` without an `as` cast.
export function isFormatErrorCode(value: unknown): value is FormatErrorCode {
  return typeof value === 'string' && FORMAT_ERROR_CODE_SET.has(value);
}

export type FormatErrorDetail = Readonly<Record<string, string | number | boolean>>;

export interface FormatError {
  readonly code: FormatErrorCode;
  readonly path: string; // JSON Pointer to the offending node, e.g. "/bones/3/parent"
  readonly message: string; // human readable, no em-dashes or en-dashes
  readonly detail?: FormatErrorDetail;
}

export const FORMAT_WARNING_CODES = ['HASH_ABSENT', 'DUPLICATE_RECORD_KEY'] as const;

export type FormatWarningCode = (typeof FORMAT_WARNING_CODES)[number];

export interface FormatWarning {
  readonly code: FormatWarningCode;
  readonly path: string;
  readonly message: string;
  readonly detail?: FormatErrorDetail;
}

// The collect-all result of a validation pass (format-contract section 8.1). `document` is non-null
// only when `ok === true`; `errors` carries ALL problems found in one pass, not just the first.
export interface ValidationReport {
  readonly ok: boolean;
  readonly document: SkeletonDocument | null;
  readonly errors: readonly FormatError[];
  readonly warnings: readonly FormatWarning[];
}

// Throwing wrapper error for call sites that prefer exceptions (parseDocument, the editor import
// boundary). Part of the public surface so consumers can type their catch (format-contract WP-F.9).
export class FormatValidationError extends Error {
  override readonly name = 'FormatValidationError';
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    super(`document failed format validation with ${report.errors.length} error(s)`);
    this.report = report;
  }
}

// Construct a FormatError, omitting `detail` entirely when there is none so reports stay
// deep-equal across runs (exactOptionalPropertyTypes forbids an explicit `detail: undefined`).
export function formatError(
  code: FormatErrorCode,
  path: string,
  message: string,
  detail?: FormatErrorDetail,
): FormatError {
  return detail === undefined ? { code, path, message } : { code, path, message, detail };
}
