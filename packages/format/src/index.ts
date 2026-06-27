// Public value barrel for @marionette/format (format-contract WP-F.9). The format package is the
// dependency-graph leaf and the shared contract (LAW 3): it imports nothing in-repo. Phase-0 subset
// (phase-0-foundations.md WP-0.3): validators, content hashing, the version constants, and the
// type re-export. The JSON Schema artifact, mesh/animation validators, validateDocumentJson, and the
// migration framework land in later phases and extend this surface without breaking it.

export { validateDocument, parseDocument } from './validate';
export type { ValidateOptions } from './validate';
export { FormatValidationError } from './validate/errors';
export type {
  FormatError,
  FormatErrorCode,
  FormatWarning,
  FormatWarningCode,
  ValidationReport,
} from './validate/errors';
export { computeContentHash, verifyContentHash } from './hash/hash';
export { CURRENT_FORMAT_VERSION, SUPPORTED_FORMAT_MAJOR } from './version/constants';

// The type-only contract surface (zero runtime); also available directly at @marionette/format/types.
export type * from './types';
