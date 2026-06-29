import { EFFECTS_FORMAT_VERSION } from '../../version/constants';
import { isRecord } from '../../internal/guards';
import { compareFormatVersion, parseSemVer } from '../../version/semver';
import type { SemVer } from '../../version/semver';
import { computeEffectsContentHash } from '../hash/hash';
import type { EffectsDocument } from '../schema/document';
import { effectsError, EffectsValidationError } from './errors';
import type { EffectsError, EffectsValidationReport, EffectsWarning } from './errors';
import { validateEffectsSemantic } from './semantic';
import { validateEffectsStructure } from './structural';

// The effects-format runtime validator (phase-3-vfx-particles.md section 8.1, WP-3.0 TASK-3.0.3). It
// mirrors the skeletal validate/index.ts: a version gate, then the structural (Zod) layer, then the
// semantic (cross-reference) layer, then the hash layer, collecting ALL errors in one pass. It is
// pure: no I/O, never mutates input, never throws on malformed data (the throwing wrapper is
// parseEffectsDocument). The effects version line is independent of the skeletal one; there is no
// migration chain in Phase 3 (the format is introduced at 1.0.0), so a below-current version is
// reported as EFFECT_UNSUPPORTED_FORMAT_VERSION rather than migrated.

export interface ValidateEffectsOptions {
  // Verify the content hash on the import boundary (default true). Runtimes that treat `hash` as
  // opaque pass false (mirrors the skeletal ValidateOptions).
  readonly verifyHash?: boolean;
}

// Parse the shipped constant once. A null here is a genuine programming bug (a malformed shipped
// constant), not malformed input, so it throws rather than returning a typed error.
function requireEffectsSemVer(): SemVer {
  const parsed = parseSemVer(EFFECTS_FORMAT_VERSION);
  if (parsed === null) {
    throw new Error(`EFFECTS_FORMAT_VERSION is not a valid semver: ${EFFECTS_FORMAT_VERSION}`);
  }
  return parsed;
}

const EFFECTS_SEMVER: SemVer = requireEffectsSemVer();

// Read `effectsFormatVersion` as a string without an `as` cast. Returns undefined when absent or not
// a string, in which case the structural layer reports it as EFFECT_SCHEMA_SHAPE (a missing required
// field) rather than the version gate claiming it is unsupported.
function readEffectsFormatVersion(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input['effectsFormatVersion'];
  return typeof value === 'string' ? value : undefined;
}

interface VersionGateResult {
  readonly stop: boolean;
  readonly errors: readonly EffectsError[];
}

// Version gate. An unparseable or non-equal version stops the pipeline with
// EFFECT_UNSUPPORTED_FORMAT_VERSION. There is exactly one supported effects version in Phase 3
// (1.0.0); a future bump adds a migration chain here, mirroring the skeletal gate.
function versionGate(input: unknown): VersionGateResult {
  const version = readEffectsFormatVersion(input);
  if (version === undefined) return { stop: false, errors: [] };

  const unsupported = (reason: string): VersionGateResult => ({
    stop: true,
    errors: [
      effectsError('EFFECT_UNSUPPORTED_FORMAT_VERSION', '/effectsFormatVersion', reason, {
        version,
        current: EFFECTS_FORMAT_VERSION,
      }),
    ],
  });

  const parsed = parseSemVer(version);
  if (parsed === null) {
    return unsupported(`effectsFormatVersion "${version}" is not a valid semver`);
  }
  if (compareFormatVersion(parsed, EFFECTS_SEMVER) !== 0) {
    return unsupported(
      `effectsFormatVersion "${version}" is not the supported ${EFFECTS_FORMAT_VERSION}`,
    );
  }
  return { stop: false, errors: [] };
}

interface HashLayerResult {
  readonly errors: readonly EffectsError[];
  readonly warnings: readonly EffectsWarning[];
}

// Hash layer. An empty hash is an unhashed draft (EFFECT_HASH_ABSENT warning, not an error); a
// non-empty hash that does not match the recomputed content hash is an EFFECT_HASH_MISMATCH error.
function hashLayer(doc: EffectsDocument): HashLayerResult {
  if (doc.hash === '') {
    return {
      errors: [],
      warnings: [
        {
          code: 'EFFECT_HASH_ABSENT',
          path: '/hash',
          message:
            'effects document hash is empty (unhashed draft); content-addressed caches cannot key on it',
        },
      ],
    };
  }
  const expected = computeEffectsContentHash(doc);
  if (doc.hash !== expected) {
    return {
      errors: [
        effectsError(
          'EFFECT_HASH_MISMATCH',
          '/hash',
          'stored hash does not match the recomputed content hash',
          { stored: doc.hash, expected },
        ),
      ],
      warnings: [],
    };
  }
  return { errors: [], warnings: [] };
}

// Build the immutable report. `ok` is derived from the error list; `document` is exposed only when ok.
function makeReport(
  errors: readonly EffectsError[],
  warnings: readonly EffectsWarning[],
  document: EffectsDocument | null,
): EffectsValidationReport {
  const ok = errors.length === 0;
  return Object.freeze({
    ok,
    document: ok ? document : null,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
  });
}

// Validate a parsed EffectsDocument, collecting ALL errors in one pass. Layers run in order: version
// gate, structural, semantic, hash.
export function validateEffectsDocument(
  input: unknown,
  options?: ValidateEffectsOptions,
): EffectsValidationReport {
  const verifyHash = options?.verifyHash !== false;
  const errors: EffectsError[] = [];
  const warnings: EffectsWarning[] = [];

  const gate = versionGate(input);
  if (gate.stop) {
    return makeReport([...gate.errors], warnings, null);
  }

  const structural = validateEffectsStructure(input);
  if (!structural.ok || structural.document === null) {
    return makeReport(structural.errors, warnings, null);
  }
  const doc = structural.document;

  errors.push(...validateEffectsSemantic(doc));

  if (verifyHash) {
    const hashResult = hashLayer(doc);
    errors.push(...hashResult.errors);
    warnings.push(...hashResult.warnings);
  }

  return makeReport(errors, warnings, doc);
}

// Throwing wrapper for call sites that prefer exceptions (the editor import boundary). Throws
// EffectsValidationError carrying the full report on failure; returns the validated document otherwise.
export function parseEffectsDocument(
  input: unknown,
  options?: ValidateEffectsOptions,
): EffectsDocument {
  const report = validateEffectsDocument(input, options);
  if (!report.ok || report.document === null) {
    throw new EffectsValidationError(report);
  }
  return report.document;
}
