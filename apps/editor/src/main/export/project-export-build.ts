import { encodeBinary, validateDocument } from '@marionette/format';
import type { ExportProjectFormat } from '../../shared';

// The PURE project-export builder (PP-D6): validate the exported document with @marionette/format at the
// boundary (verifyHash true: an exported document always carries the content hash, so a tampered payload
// is rejected), then produce the bytes for the chosen format. It holds NO Electron and NO filesystem, so
// it is unit-testable headless, exactly like spine-import-convert. The Electron dialog + disk write live in
// export-project.ts.

// The per-format filesystem shape. `ext` seeds the save dialog filter + default name; `bytes` is what is
// written (a Uint8Array for MRNT, UTF-8-encoded JSON for JSON, so the write path is uniform).
export interface ProjectExportArtifact {
  readonly bytes: Uint8Array;
  readonly defaultName: string;
  readonly ext: 'mrnt' | 'json';
}

export type BuildProjectExportResult =
  | { readonly ok: true; readonly artifact: ProjectExportArtifact }
  | { readonly ok: false; readonly message: string };

const JSON_INDENT = 2;

export function buildProjectExport(
  document: unknown,
  format: ExportProjectFormat,
): BuildProjectExportResult {
  const report = validateDocument(document, { verifyHash: true });
  if (!report.ok || report.document === null) {
    return {
      ok: false,
      message: `document failed validation: ${report.errors.map((e) => e.code).join(', ')}`,
    };
  }

  const name = report.document.name;
  if (format === 'mrnt') {
    return {
      ok: true,
      artifact: { bytes: encodeBinary(report.document), defaultName: `${name}.mrnt`, ext: 'mrnt' },
    };
  }
  const json = `${JSON.stringify(report.document, null, JSON_INDENT)}\n`;
  return {
    ok: true,
    artifact: { bytes: new TextEncoder().encode(json), defaultName: `${name}.json`, ext: 'json' },
  };
}
