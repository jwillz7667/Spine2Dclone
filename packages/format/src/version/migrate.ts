import { isRecord } from '../internal/guards';
import type { FormatError } from '../validate/errors';
import { validateStructure } from '../validate/structural';
import { CURRENT_FORMAT_VERSION } from './constants';
import { MIGRATIONS, type MigrationStep } from './migrations';
import { migrationKeyOf, parseSemVer } from './semver';

// The migration runner (format-contract section 10.4, ADR-0004). Pure: runs an INJECTED chain so tests
// can pass an example chain while production passes MIGRATIONS. Forward-only; after each step the
// intermediate is validated STRUCTURALLY against the target schema (semantic faults in the source
// surface through the normal pipeline AFTER the gate, not as a migration failure).
export type MigrationResult =
  | { readonly kind: 'unchanged'; readonly doc: unknown }
  | { readonly kind: 'migrated'; readonly doc: unknown; readonly from: string; readonly to: string }
  | { readonly kind: 'unsupported'; readonly version: string }
  | { readonly kind: 'failed'; readonly step: string; readonly errors: readonly FormatError[] };

function readFormatVersion(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input['formatVersion'];
  return typeof value === 'string' ? value : undefined;
}

// Migrate `doc` up to `currentVersion` by migration key, running the contiguous chain. Returns
// `unchanged` when already at the current key, `unsupported` when the version is unparseable, above
// current, or has a gap in the chain, and `failed` when a step produces a structurally invalid
// intermediate.
export function runMigrations(
  doc: unknown,
  chain: readonly MigrationStep[],
  currentVersion: string,
): MigrationResult {
  const docVersion = readFormatVersion(doc);
  const currentSemver = parseSemVer(currentVersion);
  if (docVersion === undefined || currentSemver === null) {
    return { kind: 'unsupported', version: docVersion ?? '(missing)' };
  }
  const docSemver = parseSemVer(docVersion);
  if (docSemver === null) return { kind: 'unsupported', version: docVersion };

  let key = migrationKeyOf(docSemver);
  const targetKey = migrationKeyOf(currentSemver);
  if (key === targetKey) return { kind: 'unchanged', doc };
  if (key > targetKey) return { kind: 'unsupported', version: docVersion };

  let current = doc;
  while (key < targetKey) {
    const step = chain.find((candidate) => candidate.fromKey === key);
    if (step === undefined) return { kind: 'unsupported', version: docVersion };
    const migrated = step.migrate(current);
    const structural = validateStructure(migrated);
    if (!structural.ok) {
      return { kind: 'failed', step: `${step.fromKey}->${step.toKey}`, errors: structural.errors };
    }
    current = migrated;
    key = step.toKey;
  }
  return { kind: 'migrated', doc: current, from: docVersion, to: currentVersion };
}

// Public convenience: migrate to the shipped current version using the production registry.
export function migrateToCurrent(doc: unknown): MigrationResult {
  return runMigrations(doc, MIGRATIONS, CURRENT_FORMAT_VERSION);
}
