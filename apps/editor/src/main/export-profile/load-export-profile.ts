// Export Profile loader/persister (TASK-5.0.6, phase-5-production-hardening.md section 4.1).
//
// loadExportProfile reads <projectRoot>/export-profile.json, Zod-validates it against
// exportProfileSchema, and returns a typed ExportProfile OR a typed ExportProfileError. It NEVER falls
// back to a silent default and NEVER throws on a load failure: a missing, unreadable, or invalid
// profile is returned by value as ExportProfileError so the caller branches on `kind` and fails loudly
// (LAW 3 discipline for the third store). saveExportProfile validates the in-memory profile first
// (a failure there is a programmer error, so it throws) and writes pretty-printed JSON back.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportProfileSchema, type ExportProfile } from './export-profile.schema';
import type { ExportProfileError } from './errors';

const PROFILE_FILENAME = 'export-profile.json';

function profilePath(projectRoot: string): string {
  return join(projectRoot, PROFILE_FILENAME);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

// Reads and validates <projectRoot>/export-profile.json. Returns the typed profile on success, or a
// typed ExportProfileError discriminated union on any failure (missing | invalid | unreadable).
export function loadExportProfile(projectRoot: string): ExportProfile | ExportProfileError {
  const path = profilePath(projectRoot);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    if (isErrnoException(cause) && cause.code === 'ENOENT') {
      return { kind: 'missing', path };
    }
    return { kind: 'unreadable', path, cause };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    // Malformed JSON is a read-side failure, not a schema-shape failure: report it as unreadable.
    return { kind: 'unreadable', path, cause };
  }

  const result = exportProfileSchema.safeParse(parsed);
  if (!result.success) {
    return { kind: 'invalid', path, issues: result.error.issues };
  }

  return result.data;
}

// Validates the in-memory profile (a failure here is a programmer error, so it throws) and writes
// pretty-printed JSON (2-space indent, trailing newline) to <projectRoot>/export-profile.json.
export function saveExportProfile(projectRoot: string, profile: ExportProfile): void {
  const validated = exportProfileSchema.safeParse(profile);
  if (!validated.success) {
    throw new Error(
      `saveExportProfile received an invalid ExportProfile: ${validated.error.message}`,
    );
  }

  const path = profilePath(projectRoot);
  writeFileSync(path, `${JSON.stringify(validated.data, null, 2)}\n`, 'utf8');
}
