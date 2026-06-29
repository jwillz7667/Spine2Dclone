import { parseEffectsDocument } from '@marionette/format/effects';
import type { EffectsDocument } from '@marionette/format/effects-types';

// An effects conformance rig IS a valid EffectsDocument (phase-3-vfx-particles.md WP-3.10, Law 3). We
// validate via the format package itself (the one contract) rather than a parallel schema, so a rig the
// runtime would reject can never be committed as a fixture source. parseEffectsDocument throws
// EffectsValidationError (a typed error carrying the full report) on any structural or semantic
// violation.
//
// verifyHash is off, mirroring the skeletal validateRig: rigs are committed as unhashed drafts
// (hash ""), which is how a runtime treats the hash on import. Keeping the rig hash empty avoids a
// second drift surface (a recomputed hash regenerated on every rig edit) on top of the
// .effects-fixtures.lock manifest, which already hashes the rig file bytes.
export function validateEffectsRig(input: unknown): EffectsDocument {
  return parseEffectsDocument(input, { verifyHash: false });
}
