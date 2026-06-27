import type { SkeletonDocument } from '../schema/document';
import type { FormatError, FormatWarning, ValidationReport } from './errors';

// Aggregate collected errors and warnings into an immutable ValidationReport (format-contract
// section 8.1). `ok` is derived from the error list, and `document` is exposed only when ok, which
// is the single place that enforces the "document non-null only when ok === true" contract. The
// report and its arrays are frozen so a consumer cannot mutate a shared result.
export function makeReport(
  errors: readonly FormatError[],
  warnings: readonly FormatWarning[],
  document: SkeletonDocument | null,
): ValidationReport {
  const ok = errors.length === 0;
  return Object.freeze({
    ok,
    document: ok ? document : null,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
  });
}
