import { finalizeSpineImport } from './pipeline';
import type { SpineImportOptions, SpineImportResult } from './types';

// Import a user-owned exported Spine JSON project and convert it to a VALIDATED @marionette/format 0.6.0
// SkeletonDocument (PP-A5). Pure and deterministic: no I/O, no globals, same input in => same result out.
//
// Legal posture (LAW 4 + PP-A5 guardrails): import only, never export; strict clean-room, implemented
// solely from Esoteric's PUBLISHED format documentation and inspection of user-owned files, never from
// Spine runtime or editor source. See the package README.
//
// `input` is the already-parsed JSON value (the caller reads the file). It is fed to the SAME conversion
// and validation pipeline the .skel binary path uses, so equivalent JSON and binary content converge to
// identical documents.
export function importSpineJson(input: unknown, options?: SpineImportOptions): SpineImportResult {
  return finalizeSpineImport(input, options);
}
