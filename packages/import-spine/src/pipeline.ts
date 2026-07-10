import { validateDocument } from '@marionette/format';
import { convertDocument } from './convert/document';
import { Diagnostics } from './diagnostics';
import type { SpineImportOptions, SpineImportResult } from './types';

// The shared tail of every import path (JSON and .skel binary): convert the name-based intermediate value
// into an UNVALIDATED document (best-effort, collecting typed errors and lossy-conversion warnings), then
// gate it through @marionette/format validateDocument. A document is emitted ONLY when validation passes
// (never a malformed document, Law 3); an unsupported version or non-object root is a hard stop, and a
// converted-but-invalid document surfaces each underlying format error as SPINE_DOCUMENT_INVALID with the
// format code in detail.formatCode. Both entry points feed the SAME intermediate here, so equivalent JSON
// and binary content converge to identical documents.
export function finalizeSpineImport(
  value: unknown,
  options: SpineImportOptions | undefined,
): SpineImportResult {
  const diag = new Diagnostics();
  const converted = convertDocument(value, options, diag);

  if (converted === undefined || diag.hasErrors) {
    return { ok: false, errors: [...diag.errors], warnings: [...diag.warnings] };
  }

  const report = validateDocument(converted);
  if (!report.ok || report.document === null) {
    for (const error of report.errors) {
      diag.error('SPINE_DOCUMENT_INVALID', error.path, error.message, { formatCode: error.code });
    }
    return { ok: false, errors: [...diag.errors], warnings: [...diag.warnings] };
  }

  return { ok: true, document: report.document, warnings: [...diag.warnings] };
}
