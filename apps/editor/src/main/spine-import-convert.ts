import { basename, extname } from 'node:path';
import { importSpineJson, importSpineSkel, type SpineImportResult } from '@marionette/import-spine';
import type { SpineImportError, SpineImportResponse, SpineImportWarning } from '../shared';

// The PURE conversion + response mapping for the Import Spine Project flow (no Electron, no filesystem),
// split out from the dialog/IO wrapper so the mapping is unit-testable in a headless environment. The
// clean-room importer runs HERE, OUTSIDE the renderer document path; the converted document then loads
// through the renderer's existing validated load flow. Import only, never export.

// The document name Spine files do not carry: the chosen file's basename without its extension.
export function nameFromPath(path: string): string {
  const base = basename(path);
  const ext = extname(base);
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base;
  return stem.length > 0 ? stem : 'imported-skeleton';
}

// Strip the importer's typed diagnostics to the transport shapes (dropping the free-form `detail`, which
// the human-readable message already conveys), so editor-shared never depends on the importer package.
function toWarnings(warnings: SpineImportResult['warnings']): SpineImportWarning[] {
  return warnings.map((w) => ({ feature: w.feature, path: w.path, why: w.why }));
}

function toErrors(result: Extract<SpineImportResult, { ok: false }>): SpineImportError[] {
  return result.errors.map((e) => ({ code: e.code, path: e.path, message: e.message }));
}

// The file contents to convert: a JSON export (read as text) or a .skel binary export (read as bytes).
export type SpineFileContents =
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'skel'; readonly bytes: Uint8Array };

// Convert the read file contents and map the importer result to the IPC response. A JSON parse failure and
// every importer failure become a typed `failed` response; a success carries the validated document and
// the lossy-conversion warnings. The document is emitted only when the importer validated it.
export function convertSpineProject(
  path: string,
  contents: SpineFileContents,
): SpineImportResponse {
  const name = nameFromPath(path);
  let result: SpineImportResult;
  if (contents.kind === 'skel') {
    result = importSpineSkel(contents.bytes, { name });
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents.text);
    } catch {
      return {
        status: 'failed',
        errors: [
          { code: 'SPINE_INVALID_JSON', path: '', message: `${basename(path)} is not valid JSON` },
        ],
        warnings: [],
      };
    }
    result = importSpineJson(parsed, { name });
  }

  if (!result.ok) {
    return { status: 'failed', errors: toErrors(result), warnings: toWarnings(result.warnings) };
  }
  return {
    status: 'imported',
    name,
    document: result.document,
    warnings: toWarnings(result.warnings),
  };
}
