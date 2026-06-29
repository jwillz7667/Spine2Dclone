import type { SlotSceneDocument } from '../scene-document';
import type { SlotProjectManifest } from '../manifest';

// The typed error model for the slot scene format (format-contract section 15.4, phase-4 WP-4.4).
// Mirrors the skeletal `FormatError` and the effects `EffectsError` discipline: errors are discriminated
// by a stable `code` and located by a JSON Pointer `path`, never by bare strings. The slot codes are a
// SEPARATE namespace from the skeletal and effects codes (the three formats validate independently). The
// codes are camelCase to match the names the format-contract section 15.4 prose uses (`hashMismatch`,
// `versionMismatch`); a mixed report stays unambiguous because every code here begins with `slot`.
//
// SLOT_SCENE_ERROR_CODES is the single source of both the `SlotSceneErrorCode` type and a runtime
// membership set (used by the corpus coverage guard).
export const SLOT_SCENE_ERROR_CODES = [
  // Structural (shape) faults from the closed Zod schema.
  'slotSchemaShape',
  // Version gate.
  'versionMismatch',
  // Grid topology / dimension / gravity invariants (semantic).
  'gridDimsInconsistent',
  'gridGravityInconsistent',
  // Anticipation bounds (semantic).
  'anticipationEmptyTriggers',
  'anticipationThreshold',
  'anticipationColsOutOfRange',
  // Reference resolution (semantic).
  'skeletonRefMissing',
  'animationRefMissing',
  'vfxPresetMissing',
  'refHashMismatch',
  // Feature-flow graph integrity (semantic, WP-4.9).
  'flowMissingBase',
  'flowEntryInvalid',
  'flowTransitionDangling',
  // Hash integrity.
  'hashMismatch',
  // Slot project manifest faults.
  'projectSchemaShape',
  'projectMemberMissing',
  'projectMemberHashMismatch',
] as const;

export type SlotSceneErrorCode = (typeof SLOT_SCENE_ERROR_CODES)[number];

const SLOT_SCENE_ERROR_CODE_SET: ReadonlySet<string> = new Set(SLOT_SCENE_ERROR_CODES);

// True when `value` is one of the known slot error codes. Used by the structural mapper to read a
// refinement issue's `params.code` without an `as` cast.
export function isSlotSceneErrorCode(value: unknown): value is SlotSceneErrorCode {
  return typeof value === 'string' && SLOT_SCENE_ERROR_CODE_SET.has(value);
}

export type SlotSceneErrorDetail = Readonly<Record<string, string | number | boolean>>;

export interface SlotSceneError {
  readonly code: SlotSceneErrorCode;
  readonly path: string; // JSON Pointer to the offending node, e.g. "/scene/grid/rows"
  readonly message: string; // human readable, no em-dashes or en-dashes
  readonly detail?: SlotSceneErrorDetail;
}

export const SLOT_SCENE_WARNING_CODES = ['slotHashAbsent'] as const;

export type SlotSceneWarningCode = (typeof SLOT_SCENE_WARNING_CODES)[number];

export interface SlotSceneWarning {
  readonly code: SlotSceneWarningCode;
  readonly path: string;
  readonly message: string;
  readonly detail?: SlotSceneErrorDetail;
}

// The collect-all result of a SlotSceneDocument validation pass. `document` is non-null only when
// `ok === true`; `errors` carries ALL problems found in one pass, not just the first.
export interface SlotSceneValidationReport {
  readonly ok: boolean;
  readonly document: SlotSceneDocument | null;
  readonly errors: readonly SlotSceneError[];
  readonly warnings: readonly SlotSceneWarning[];
}

// The collect-all result of a SlotProjectManifest validation pass.
export interface SlotManifestValidationReport {
  readonly ok: boolean;
  readonly manifest: SlotProjectManifest | null;
  readonly errors: readonly SlotSceneError[];
}

// Throwing wrapper for call sites that prefer exceptions (the editor import boundary). Part of the
// public surface so consumers can type their catch.
export class SlotSceneValidationError extends Error {
  override readonly name = 'SlotSceneValidationError';
  readonly report: SlotSceneValidationReport;

  constructor(report: SlotSceneValidationReport) {
    super(`slot scene document failed validation with ${report.errors.length} error(s)`);
    this.report = report;
  }
}

// Construct a SlotSceneError, omitting `detail` entirely when there is none so reports stay deep-equal
// across runs (exactOptionalPropertyTypes forbids an explicit `detail: undefined`).
export function slotSceneError(
  code: SlotSceneErrorCode,
  path: string,
  message: string,
  detail?: SlotSceneErrorDetail,
): SlotSceneError {
  return detail === undefined ? { code, path, message } : { code, path, message, detail };
}
