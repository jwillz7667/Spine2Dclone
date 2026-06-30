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

// Weighted mesh vertex codec and the pinned influence cap (ADR-0002). The single producer/consumer of
// the on-disk weighted layout; runtime-core and runtimes decode through this to feed skinning.
export {
  encodeWeightedVertices,
  decodeWeightedVertices,
  isWeightedMesh,
  MAX_BONE_INFLUENCES,
  WEIGHT_SUM_EPSILON,
} from './mesh/weighted';
export type { WeightedInfluence, PerVertexBindings } from './mesh/weighted';

// Versioning and migration framework (format-contract section 10.4, ADR-0004). The load path runs
// migrations inside validateDocument; these are exposed for tooling and the document-core load seam.
export { migrateToCurrent, runMigrations } from './version/migrate';
export type { MigrationResult } from './version/migrate';
export { MIGRATIONS } from './version/migrations';
export type { MigrationStep } from './version/migrations';

// MRNT binary codec (phase-5 WP-5.1): a compact, deterministic, lossless second serialization of the
// SkeletonDocument logical schema. It carries the SAME formatVersion as the JSON and is validated by the
// SAME validator after decode (section 6.1.2); the editor uses it to ENCODE only (its save format stays
// JSON). The pinned CRC-32/ISO-HDLC is exported for the phase-5 cross-language equivalence golden vector.
export {
  encodeBinary,
  decodeBinary,
  crc32,
  BinaryDecodeError,
  BINARY_DECODE_ERROR_CODES,
} from './binary';
export type { BinaryDecodeErrorCode } from './binary';

// The type-only contract surface (zero runtime); also available directly at @marionette/format/types.
export type * from './types';
