import { canonicalContentHash } from '../../hash/hash';
import { isRecord } from '../../internal/guards';

// The migration registry (format-contract section 10.4, ADR-0004). Each step is pure and forward-only,
// transforming a document at `fromKey` into one at `toKey` (= fromKey + 1). Pre-1.0 the key is the
// MINOR digit. Phase 0 shipped an EMPTY registry; Phase 2 adds the first real step (0.1.x -> 0.2.0).
export interface MigrationStep {
  readonly fromKey: number;
  readonly toKey: number;
  readonly targetVersion: string;
  migrate(doc: unknown): unknown;
}

// Inject the Phase 2 (ADR-0004) collections into each animation, preserving any existing content. A
// genuine 0.1.x animation has only { duration, bones, slots }; the empties make it a valid 0.2.0
// animation. Pure: returns a new record, never mutates the input.
function migrateAnimations(animations: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, anim] of Object.entries(animations)) {
    if (isRecord(anim)) {
      out[name] = {
        ...anim,
        ik: isRecord(anim['ik']) ? anim['ik'] : {},
        transform: isRecord(anim['transform']) ? anim['transform'] : {},
        deform: isRecord(anim['deform']) ? anim['deform'] : {},
      };
    } else {
      out[name] = anim;
    }
  }
  return out;
}

// 0.1.x -> 0.2.0: add the constraint arrays and the ik/transform/deform animation timelines (ADR-0004),
// stamp formatVersion 0.2.0, and recompute the content hash when the source carried one (a draft with
// an empty hash stays a draft). The injected content changes the canonical bytes (canonicalize.ts
// includes formatVersion and the new collections), so a non-empty hash MUST be recomputed or the load
// path's hash layer would reject the migrated document.
function migrate01xTo02(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const animations = isRecord(input['animations'])
    ? migrateAnimations(input['animations'])
    : input['animations'];
  const next: Record<string, unknown> = {
    ...input,
    ikConstraints: Array.isArray(input['ikConstraints']) ? input['ikConstraints'] : [],
    transformConstraints: Array.isArray(input['transformConstraints'])
      ? input['transformConstraints']
      : [],
    animations,
    formatVersion: '0.2.0',
  };
  const sourceHash = input['hash'];
  if (typeof sourceHash === 'string' && sourceHash !== '') {
    next['hash'] = canonicalContentHash(next);
  }
  return next;
}

// Production registry. Contiguous by construction: each step's toKey is the next step's fromKey.
export const MIGRATIONS: readonly MigrationStep[] = [
  { fromKey: 1, toKey: 2, targetVersion: '0.2.0', migrate: migrate01xTo02 },
];
