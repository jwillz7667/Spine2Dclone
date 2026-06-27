import type { ValidationReport } from '../src/validate/errors';
import type { FormatErrorCode } from '../src/validate/errors';
import type { SkeletonDocument } from '../src/types';
import { parseDocument } from '../src/validate';
import minimal from './fixtures/minimal.json';

// A deep, mutable, typed clone of the canonical valid document. Routing through parseDocument (the
// public throwing validator) returns a fresh SkeletonDocument with zero casts: the validated output
// is already typed as the schema output, so the suite needs no `as` to obtain a typed document.
export function cloneMinimal(): SkeletonDocument {
  return parseDocument(structuredClone(minimal));
}

// The list of error codes in a report, for concise assertions.
export function errorCodes(report: ValidationReport): FormatErrorCode[] {
  return report.errors.map((error) => error.code);
}

// Check-family membership (format-contract section 8.4). A single fault may raise more than one code
// within ONE family, but never a code from a different family. The corpus and cycle tests assert
// this. Only the Phase-0-reachable codes are mapped; later phases extend the families.
const CODE_FAMILY: Readonly<Record<string, string>> = {
  SCHEMA_SHAPE: 'SCHEMA',
  COLOR_RANGE: 'SCHEMA',
  CURVE_BEZIER_X_RANGE: 'SCHEMA',
  UNSUPPORTED_FORMAT_VERSION: 'VERSION',
  BONE_NAME_DUPLICATE: 'BONE',
  BONE_PARENT_MISSING: 'BONE',
  BONE_ORDER_VIOLATION: 'BONE',
  SLOT_NAME_DUPLICATE: 'SLOT',
  SLOT_BONE_MISSING: 'SLOT',
  SLOT_ATTACHMENT_MISSING: 'SLOT',
  SKIN_DEFAULT_MISSING: 'SKIN',
  SKIN_SLOT_UNKNOWN: 'SKIN',
  ATLAS_REGION_DUPLICATE: 'ATLAS',
  ATTACHMENT_REGION_MISSING: 'ATLAS',
  ANIM_BONE_UNKNOWN: 'ANIM',
  ANIM_SLOT_UNKNOWN: 'ANIM',
  ANIM_TIME_ORDER: 'ANIM',
  ANIM_TIME_RANGE: 'ANIM',
  ANIM_DURATION: 'ANIM',
  HASH_MISMATCH: 'HASH',
};

export function familyOf(code: string): string {
  const family = CODE_FAMILY[code];
  if (family === undefined) throw new Error(`no check family mapped for code ${code}`);
  return family;
}
