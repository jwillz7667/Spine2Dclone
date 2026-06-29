import { SLOT_SCENE_FORMAT_VERSION } from '../../version/constants';
import { isRecord } from '../../internal/guards';
import { compareFormatVersion, parseSemVer } from '../../version/semver';
import type { SemVer } from '../../version/semver';
import { computeSlotSceneHash } from '../hash/hash';
import type { SlotSceneDocument } from '../scene-document';
import { slotSceneError, SlotSceneValidationError } from './errors';
import type { SlotSceneError, SlotSceneValidationReport, SlotSceneWarning } from './errors';
import { validateSlotSceneSemantic } from './semantic';
import { validateSlotSceneStructure } from './structural';
import type { SceneResolver } from './resolver';

// The slot scene runtime validator (format-contract section 15.4, phase-4 WP-4.4 TASK-4.4.2). It mirrors
// the skeletal and effects validators: a version gate, then the structural (Zod) layer, then the
// semantic (cross-reference) layer, then the hash layer, collecting ALL errors in one pass. It is pure:
// no I/O, never mutates input, never throws on malformed data (the throwing wrapper is
// parseSlotSceneDocument). The slot version line is independent of the other two; the format is
// introduced at 0.1.0, so a non-equal version is reported as `versionMismatch` (there is no migration
// chain yet, mirroring the effects gate).

export interface ValidateSlotSceneOptions {
  // Verify the content hash on the import boundary (default true). Runtimes that treat `hash` as opaque
  // pass false (mirrors the skeletal and effects ValidateOptions).
  readonly verifyHash?: boolean;
}

// Parse the shipped constant once. A null here is a genuine programming bug (a malformed shipped
// constant), not malformed input, so it throws rather than returning a typed error.
function requireSlotSemVer(): SemVer {
  const parsed = parseSemVer(SLOT_SCENE_FORMAT_VERSION);
  if (parsed === null) {
    throw new Error(
      `SLOT_SCENE_FORMAT_VERSION is not a valid semver: ${SLOT_SCENE_FORMAT_VERSION}`,
    );
  }
  return parsed;
}

const SLOT_SEMVER: SemVer = requireSlotSemVer();

// Read `slotSceneFormatVersion` as a string without an `as` cast. Returns undefined when absent or not
// a string, in which case the structural layer reports it as slotSchemaShape (a missing required field)
// rather than the version gate claiming a mismatch.
function readSlotSceneFormatVersion(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input['slotSceneFormatVersion'];
  return typeof value === 'string' ? value : undefined;
}

interface VersionGateResult {
  readonly stop: boolean;
  readonly errors: readonly SlotSceneError[];
}

// Version gate. An unparseable or non-equal version stops the pipeline with `versionMismatch`. There is
// exactly one supported slot version in Phase 4 (0.1.0); a future bump adds a migration chain here,
// mirroring the skeletal gate. A major-version mismatch (or any non-equal version) yields the typed
// `versionMismatch`.
function versionGate(input: unknown): VersionGateResult {
  const version = readSlotSceneFormatVersion(input);
  if (version === undefined) return { stop: false, errors: [] };

  const mismatch = (reason: string): VersionGateResult => ({
    stop: true,
    errors: [
      slotSceneError('versionMismatch', '/slotSceneFormatVersion', reason, {
        version,
        current: SLOT_SCENE_FORMAT_VERSION,
      }),
    ],
  });

  const parsed = parseSemVer(version);
  if (parsed === null) {
    return mismatch(`slotSceneFormatVersion "${version}" is not a valid semver`);
  }
  if (compareFormatVersion(parsed, SLOT_SEMVER) !== 0) {
    return mismatch(
      `slotSceneFormatVersion "${version}" is not the supported ${SLOT_SCENE_FORMAT_VERSION}`,
    );
  }
  return { stop: false, errors: [] };
}

interface HashLayerResult {
  readonly errors: readonly SlotSceneError[];
  readonly warnings: readonly SlotSceneWarning[];
}

// Hash layer. An empty hash is an unhashed draft (slotHashAbsent warning, not an error); a non-empty
// hash that does not match the recomputed content hash is a hashMismatch error.
function hashLayer(doc: SlotSceneDocument): HashLayerResult {
  if (doc.hash === '') {
    return {
      errors: [],
      warnings: [
        {
          code: 'slotHashAbsent',
          path: '/hash',
          message:
            'slot scene document hash is empty (unhashed draft); content-addressed caches cannot key on it',
        },
      ],
    };
  }
  const expected = computeSlotSceneHash(doc);
  if (doc.hash !== expected) {
    return {
      errors: [
        slotSceneError(
          'hashMismatch',
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
  errors: readonly SlotSceneError[],
  warnings: readonly SlotSceneWarning[],
  document: SlotSceneDocument | null,
): SlotSceneValidationReport {
  const ok = errors.length === 0;
  return Object.freeze({
    ok,
    document: ok ? document : null,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
  });
}

// Validate a parsed SlotSceneDocument, collecting ALL errors in one pass. Layers run in order: version
// gate, structural, semantic, hash. The semantic layer needs the injected resolver to reach the
// referenced skeletons / VFX presets.
export function validateSlotScene(
  input: unknown,
  resolver: SceneResolver,
  options?: ValidateSlotSceneOptions,
): SlotSceneValidationReport {
  const verifyHash = options?.verifyHash !== false;
  const errors: SlotSceneError[] = [];
  const warnings: SlotSceneWarning[] = [];

  const gate = versionGate(input);
  if (gate.stop) {
    return makeReport([...gate.errors], warnings, null);
  }

  const structural = validateSlotSceneStructure(input);
  if (!structural.ok || structural.document === null) {
    return makeReport(structural.errors, warnings, null);
  }
  const doc = structural.document;

  errors.push(...validateSlotSceneSemantic(doc, resolver));

  if (verifyHash) {
    const hashResult = hashLayer(doc);
    errors.push(...hashResult.errors);
    warnings.push(...hashResult.warnings);
  }

  return makeReport(errors, warnings, doc);
}

// Throwing wrapper for call sites that prefer exceptions (the editor import boundary). Throws
// SlotSceneValidationError carrying the full report on failure; returns the validated document
// otherwise.
export function parseSlotSceneDocument(
  input: unknown,
  resolver: SceneResolver,
  options?: ValidateSlotSceneOptions,
): SlotSceneDocument {
  const report = validateSlotScene(input, resolver, options);
  if (!report.ok || report.document === null) {
    throw new SlotSceneValidationError(report);
  }
  return report.document;
}
