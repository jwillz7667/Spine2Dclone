import { validateDocument } from '@marionette/format';
import { convertDocument } from './convert/document';
import { Diagnostics } from './diagnostics';
import type { SpineImportOptions, SpineImportResult } from './types';

// Import a user-owned exported Spine JSON project and convert it to a VALIDATED @marionette/format 0.6.0
// SkeletonDocument (PP-A5). Pure and deterministic: no I/O, no globals, same input in => same result out.
//
// Legal posture (LAW 4 + PP-A5 guardrails): import only, never export; strict clean-room, implemented
// solely from Esoteric's PUBLISHED format documentation and inspection of user-owned files, never from
// Spine runtime or editor source. See the package README.
//
// Pipeline: convert (best-effort, collecting typed errors and lossy-conversion warnings) then validate.
// The document is emitted ONLY when validateDocument passes (never a malformed document, Law 3); an
// unsupported version or a non-object root is a hard stop, and a converted-but-invalid document surfaces
// each underlying format error as a SPINE_DOCUMENT_INVALID with the format code in `detail.formatCode`.
export function importSpineJson(input: unknown, options?: SpineImportOptions): SpineImportResult {
  const diag = new Diagnostics();
  const converted = convertDocument(input, options, diag);

  if (converted === undefined || diag.hasErrors) {
    return { ok: false, errors: [...diag.errors], warnings: [...diag.warnings] };
  }

  // The converted document already carries the correct content hash (convertDocument stamps it), so the
  // default hash verification passes; validateDocument is the loud structural + semantic gate.
  const report = validateDocument(converted);
  if (!report.ok || report.document === null) {
    for (const error of report.errors) {
      diag.error('SPINE_DOCUMENT_INVALID', error.path, error.message, { formatCode: error.code });
    }
    return { ok: false, errors: [...diag.errors], warnings: [...diag.warnings] };
  }

  return { ok: true, document: report.document, warnings: [...diag.warnings] };
}
