// Typed Export Profile load failures (TASK-5.0.6, phase-5-production-hardening.md section 4.1).
//
// loadExportProfile returns this discriminated union BY VALUE on failure, never throwing and never a
// silent default: an invalid or missing profile fails loudly so callers branch on `kind`. This mirrors
// the format package's "validate on import, fail loudly" discipline (LAW 3) for the third store.
import type { z } from 'zod';

export type ExportProfileError =
  // The file does not exist (fs ENOENT). The export flow must refuse to run rather than default.
  | { readonly kind: 'missing'; readonly path: string }
  // The file exists and parsed as JSON but failed exportProfileSchema validation. `issues` are the
  // Zod issues so the caller (the future Export Settings panel) can surface precise field errors.
  | { readonly kind: 'invalid'; readonly path: string; readonly issues: z.ZodIssue[] }
  // The file could not be read (a non-ENOENT fs error) or its contents were not valid JSON.
  | { readonly kind: 'unreadable'; readonly path: string; readonly cause: unknown };

// Narrowing guard so callers can branch the load result on success vs typed error without exposing the
// internal union shape.
export function isExportProfileError(value: unknown): value is ExportProfileError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'missing' || kind === 'invalid' || kind === 'unreadable';
}
