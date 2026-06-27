import type { SkeletonDocument } from '../schema/document';
import { isRecord } from '../internal/guards';
import { computeContentHash } from '../hash/hash';
import { CURRENT_FORMAT_VERSION } from '../version/constants';
import { runMigrations } from '../version/migrate';
import { MIGRATIONS } from '../version/migrations';
import { compareFormatVersion, migrationKeyOf, parseSemVer } from '../version/semver';
import type { SemVer } from '../version/semver';
import { formatError, FormatValidationError } from './errors';
import type { FormatError, FormatWarning, ValidationReport } from './errors';
import { makeReport } from './report';
import { validateSemantic } from './semantic';
import { validateStructure } from './structural';

export interface ValidateOptions {
  // Verify the content hash on the import boundary (default true). runtime-web passes false because
  // runtimes treat `hash` as opaque (format-contract section 9.3).
  readonly verifyHash?: boolean;
}

// Read `formatVersion` as a string without an `as` cast. Returns undefined when it is absent or not
// a string, in which case the structural layer reports it as SCHEMA_SHAPE (a missing required field)
// rather than the version gate claiming it is unsupported.
function readFormatVersion(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input['formatVersion'];
  return typeof value === 'string' ? value : undefined;
}

// Parse the shipped constant once. A null here is a genuine programming bug (a malformed shipped
// constant), not malformed input, so it throws rather than returning a typed error.
function requireCurrentSemVer(): SemVer {
  const parsed = parseSemVer(CURRENT_FORMAT_VERSION);
  if (parsed === null) {
    throw new Error(`CURRENT_FORMAT_VERSION is not a valid semver: ${CURRENT_FORMAT_VERSION}`);
  }
  return parsed;
}

const CURRENT_SEMVER: SemVer = requireCurrentSemVer();

interface VersionGateResult {
  readonly stop: boolean;
  readonly errors: readonly FormatError[];
  // The migrated input when a below-current document was forward-migrated; the rest of the pipeline
  // validates THIS, not the raw input (format-contract section 8.3 step 1, section 10.4).
  readonly migrated?: unknown;
}

// Version gate (format-contract section 8.3 step 1, section 10.4). An unparseable or strictly-newer
// version stops the pipeline with UNSUPPORTED_FORMAT_VERSION. A document below the current migration
// key is run through the migration chain: a successful migration flows the upgraded document onward; a
// missing chain link is UNSUPPORTED_FORMAT_VERSION; a step that yields a structurally invalid
// intermediate is MIGRATION_REQUIRED.
function versionGate(input: unknown): VersionGateResult {
  const formatVersion = readFormatVersion(input);
  if (formatVersion === undefined) return { stop: false, errors: [] };

  const unsupported = (reason: string): VersionGateResult => ({
    stop: true,
    errors: [
      formatError('UNSUPPORTED_FORMAT_VERSION', '/formatVersion', reason, {
        version: formatVersion,
        current: CURRENT_FORMAT_VERSION,
      }),
    ],
  });

  const parsed = parseSemVer(formatVersion);
  if (parsed === null) {
    return unsupported(`formatVersion "${formatVersion}" is not a valid semver`);
  }
  if (compareFormatVersion(parsed, CURRENT_SEMVER) > 0) {
    return unsupported(
      `formatVersion "${formatVersion}" is newer than supported ${CURRENT_FORMAT_VERSION}`,
    );
  }
  if (migrationKeyOf(parsed) < migrationKeyOf(CURRENT_SEMVER)) {
    const result = runMigrations(input, MIGRATIONS, CURRENT_FORMAT_VERSION);
    switch (result.kind) {
      case 'migrated':
        return { stop: false, errors: [], migrated: result.doc };
      case 'unsupported':
        return unsupported(
          `formatVersion "${formatVersion}" predates ${CURRENT_FORMAT_VERSION} and has no migration path`,
        );
      case 'failed':
        return {
          stop: true,
          errors: [
            formatError(
              'MIGRATION_REQUIRED',
              '/formatVersion',
              `migration step ${result.step} produced a structurally invalid document`,
              { step: result.step, version: formatVersion },
            ),
          ],
        };
      case 'unchanged':
        return { stop: false, errors: [] };
    }
  }
  return { stop: false, errors: [] };
}

interface HashLayerResult {
  readonly errors: readonly FormatError[];
  readonly warnings: readonly FormatWarning[];
}

// Hash layer (format-contract section 8.3 step 6). An empty hash is an unhashed draft (HASH_ABSENT
// warning, not an error); a non-empty hash that does not match the recomputed content hash is a
// HASH_MISMATCH error. Skipped entirely when verifyHash is false.
function hashLayer(doc: SkeletonDocument): HashLayerResult {
  if (doc.hash === '') {
    return {
      errors: [],
      warnings: [
        {
          code: 'HASH_ABSENT',
          path: '/hash',
          message:
            'document hash is empty (unhashed draft); content-addressed caches cannot key on it',
        },
      ],
    };
  }
  const expected = computeContentHash(doc);
  if (doc.hash !== expected) {
    return {
      errors: [
        formatError(
          'HASH_MISMATCH',
          '/hash',
          'stored hash does not match the recomputed content hash',
          {
            stored: doc.hash,
            expected,
          },
        ),
      ],
      warnings: [],
    };
  }
  return { errors: [], warnings: [] };
}

// Validate a parsed document, collecting ALL errors in one pass (format-contract section 8.1).
// Pure: it performs no I/O and never mutates `input`. It never throws on malformed data; malformed
// input is surfaced as errors. Layers run in order: version gate, structural, semantic, hash.
export function validateDocument(input: unknown, options?: ValidateOptions): ValidationReport {
  const verifyHash = options?.verifyHash !== false;
  const errors: FormatError[] = [];
  const warnings: FormatWarning[] = [];

  const gate = versionGate(input);
  if (gate.stop) {
    return makeReport([...gate.errors], warnings, null);
  }
  // A below-current document is forward-migrated by the gate; everything downstream validates the
  // upgraded document (its formatVersion, content, and recomputed hash are the 0.2.0 ones).
  const effective = gate.migrated ?? input;

  const structural = validateStructure(effective);
  if (!structural.ok || structural.document === null) {
    return makeReport(structural.errors, warnings, null);
  }
  const doc = structural.document;

  errors.push(...validateSemantic(doc));

  if (verifyHash) {
    const hashResult = hashLayer(doc);
    errors.push(...hashResult.errors);
    warnings.push(...hashResult.warnings);
  }

  return makeReport(errors, warnings, doc);
}

// Throwing wrapper for call sites that prefer exceptions. Throws FormatValidationError carrying the
// full report on failure; returns the validated document otherwise.
export function parseDocument(input: unknown, options?: ValidateOptions): SkeletonDocument {
  const report = validateDocument(input, options);
  if (!report.ok || report.document === null) {
    throw new FormatValidationError(report);
  }
  return report.document;
}
