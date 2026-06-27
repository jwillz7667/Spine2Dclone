import { parseDocument } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';

// A conformance rig IS a valid SkeletonDocument (conformance-and-ci.md A.2, Law 3). We validate via
// the format package itself, the one contract, rather than a parallel schema, so a rig the runtime
// would reject can never be committed as a fixture source. parseDocument throws FormatValidationError
// (a typed error carrying the full report) on any structural or semantic violation.
//
// verifyHash is off: rigs are committed as unhashed drafts (hash ""), which is exactly how runtime-web
// treats the hash on import (the hash is opaque to runtimes, format ValidateOptions). Keeping the rig
// hash empty avoids a second drift surface (a recomputed hash that must be regenerated on every rig
// edit) on top of the .fixtures.lock manifest, which already hashes the rig file bytes.
export function validateRig(input: unknown): SkeletonDocument {
  return parseDocument(input, { verifyHash: false });
}
