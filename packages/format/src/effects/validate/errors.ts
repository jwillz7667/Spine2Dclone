import type { EffectsDocument } from '../schema/document';
import type { ProjectManifest } from '../schema/manifest';

// The typed error model for the effects sibling format (phase-3-vfx-particles.md section 8.1, WP-3.0
// TASK-3.0.3). Mirrors the skeletal `FormatError` discipline: errors are discriminated by a stable
// `code` and located by a JSON Pointer `path`, never by bare strings. The effects codes are a SEPARATE
// namespace from the skeletal `FORMAT_ERROR_CODES` (the two formats validate independently), prefixed
// `EFFECT_` / `PROJECT_` so a mixed report is unambiguous.
//
// EFFECTS_ERROR_CODES is the single source of both the `EffectsErrorCode` type and a runtime
// membership set (used to map refinement issues without an `as` cast and to guard the negative corpus).
export const EFFECTS_ERROR_CODES = [
  // Structural (shape) faults from the closed Zod schema.
  'EFFECT_SCHEMA_SHAPE',
  'EFFECT_UNSUPPORTED_FORMAT_VERSION',
  // Refinement faults that carry a precise code via `params.code`.
  'EFFECT_COLOR_RANGE',
  // Semantic (graph) faults: cross-reference and invariant checks.
  'EFFECT_NAME_KEY_MISMATCH',
  'EFFECT_NAME_DUPLICATE',
  'EFFECT_SIMULATION_DT',
  'EFFECT_RANGE_MIN_GT_MAX',
  'EFFECT_BURST_TIME_ORDER',
  'EFFECT_LIFECURVE_STOP_ORDER',
  'EFFECT_REGION_MISSING',
  'BUNDLE_NAME_KEY_MISMATCH',
  'BUNDLE_EFFECT_MISSING',
  'BUNDLE_ANCHOR_ROLE_EMPTY',
  // Hash integrity.
  'EFFECT_HASH_MISMATCH',
  // ProjectManifest faults.
  'PROJECT_SCHEMA_SHAPE',
  'PROJECT_MEMBER_MISSING',
  'PROJECT_MEMBER_HASH_MISMATCH',
] as const;

export type EffectsErrorCode = (typeof EFFECTS_ERROR_CODES)[number];

const EFFECTS_ERROR_CODE_SET: ReadonlySet<string> = new Set(EFFECTS_ERROR_CODES);

// True when `value` is one of the known effects error codes. Used by the structural mapper to read a
// refinement issue's `params.code` without an `as` cast.
export function isEffectsErrorCode(value: unknown): value is EffectsErrorCode {
  return typeof value === 'string' && EFFECTS_ERROR_CODE_SET.has(value);
}

export type EffectsErrorDetail = Readonly<Record<string, string | number | boolean>>;

export interface EffectsError {
  readonly code: EffectsErrorCode;
  readonly path: string; // JSON Pointer to the offending node, e.g. "/effects/coinShower/simulationDt"
  readonly message: string; // human readable, no em-dashes or en-dashes
  readonly detail?: EffectsErrorDetail;
}

export const EFFECTS_WARNING_CODES = ['EFFECT_HASH_ABSENT'] as const;

export type EffectsWarningCode = (typeof EFFECTS_WARNING_CODES)[number];

export interface EffectsWarning {
  readonly code: EffectsWarningCode;
  readonly path: string;
  readonly message: string;
  readonly detail?: EffectsErrorDetail;
}

// The collect-all result of an EffectsDocument validation pass. `document` is non-null only when
// `ok === true`; `errors` carries ALL problems found in one pass, not just the first.
export interface EffectsValidationReport {
  readonly ok: boolean;
  readonly document: EffectsDocument | null;
  readonly errors: readonly EffectsError[];
  readonly warnings: readonly EffectsWarning[];
}

// The collect-all result of a ProjectManifest validation pass.
export interface ManifestValidationReport {
  readonly ok: boolean;
  readonly manifest: ProjectManifest | null;
  readonly errors: readonly EffectsError[];
}

// Throwing wrapper for call sites that prefer exceptions (the editor import boundary). Part of the
// public surface so consumers can type their catch.
export class EffectsValidationError extends Error {
  override readonly name = 'EffectsValidationError';
  readonly report: EffectsValidationReport;

  constructor(report: EffectsValidationReport) {
    super(`effects document failed validation with ${report.errors.length} error(s)`);
    this.report = report;
  }
}

// Construct an EffectsError, omitting `detail` entirely when there is none so reports stay deep-equal
// across runs (exactOptionalPropertyTypes forbids an explicit `detail: undefined`).
export function effectsError(
  code: EffectsErrorCode,
  path: string,
  message: string,
  detail?: EffectsErrorDetail,
): EffectsError {
  return detail === undefined ? { code, path, message } : { code, path, message, detail };
}
