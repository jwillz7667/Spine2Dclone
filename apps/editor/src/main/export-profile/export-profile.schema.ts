// The Export Profile schema (the THIRD store, phase-5-production-hardening.md section 4.1).
//
// The canonical schema now lives in the isomorphic editor-shared module so it is the SINGLE source for
// BOTH the main process (validating the on-disk artifact, here) AND the renderer (typing and pre-validating
// the Export dialog's profile form). This barrel-facing module re-exports it unchanged, so the phase-5
// loader/persister and its tests keep the same public API. See ../../shared/export-profile-schema.ts for
// the field documentation and the `atlas` -> `atlasExport` reconciliation note.
export { exportProfileSchema } from '../../shared';
export type { ExportProfile } from '../../shared';
