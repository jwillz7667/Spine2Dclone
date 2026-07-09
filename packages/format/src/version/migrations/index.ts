import { canonicalContentHash } from '../../hash/hash';
import { isRecord } from '../../internal/guards';

// The migration registry (format-contract section 10.4, ADR-0004). Each step is pure and forward-only,
// transforming a document at `fromKey` into one at `toKey` (= fromKey + 1). Pre-1.0 the key is the
// MINOR digit. Phase 0 shipped an EMPTY registry; Phase 2 added the first step (0.1.x -> 0.2.0) and
// stage F1 (ADR-0008) adds the second (0.2.x -> 0.3.0).
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

// Inject the stage F1 (ADR-0008) collections into each animation, preserving any existing content. A
// 0.2.x animation has { duration, bones, slots, ik, transform, deform }; the empties make it a valid
// 0.3.0 animation. Pure: returns a new record, never mutates the input.
function migrate02xAnimations(animations: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, anim] of Object.entries(animations)) {
    if (isRecord(anim)) {
      out[name] = {
        ...anim,
        drawOrder: Array.isArray(anim['drawOrder']) ? anim['drawOrder'] : [],
        events: Array.isArray(anim['events']) ? anim['events'] : [],
      };
    } else {
      out[name] = anim;
    }
  }
  return out;
}

// 0.2.x -> 0.3.0 (ADR-0008): add the root `events` collection and the drawOrder/events animation
// timelines, stamp formatVersion 0.3.0, and recompute the content hash when the source carried one (a
// draft with an empty hash stays a draft). The injected content changes the canonical bytes, so a
// non-empty hash MUST be recomputed or the load path's hash layer would reject the migrated document.
// The OPTIONAL `metadata` block is not injected: its absence is valid, so the migration leaves it out.
function migrate02xTo03(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const animations = isRecord(input['animations'])
    ? migrate02xAnimations(input['animations'])
    : input['animations'];
  const next: Record<string, unknown> = {
    ...input,
    events: Array.isArray(input['events']) ? input['events'] : [],
    animations,
    formatVersion: '0.3.0',
  };
  const sourceHash = input['hash'];
  if (typeof sourceHash === 'string' && sourceHash !== '') {
    next['hash'] = canonicalContentHash(next);
  }
  return next;
}

// Map the signed bend direction from the Phase-2 boolean or an already-present numeric field (ADR-0009
// section 1.4). `bendPositive: false` -> -1; true (and any non-false, including an absent field) -> +1.
// An already-present numeric `bend` is preserved so the step is idempotent on a 0.4.0-shaped record.
function bendFrom(record: Record<string, unknown>): number {
  if (typeof record['bend'] === 'number') return record['bend'];
  return record['bendPositive'] === false ? -1 : 1;
}

// 0.3.x -> 0.4.0 (ADR-0009): reshape one IK constraint. Replace `bendPositive` with the signed `bend`,
// inject the depth defaults (softness 0, stretch/compress/uniform false), and preserve `name`, `bones`,
// `target`, `mix`, and an optional `order` (carried through by the spread). Defensive: existing 0.4.0
// values win, so a mislabeled-but-already-shaped constraint migrates idempotently.
function migrate04Constraint(constraint: unknown): unknown {
  if (!isRecord(constraint)) return constraint;
  const rest = { ...constraint };
  delete rest['bendPositive'];
  return {
    ...rest,
    bend: bendFrom(constraint),
    softness: typeof constraint['softness'] === 'number' ? constraint['softness'] : 0,
    stretch: typeof constraint['stretch'] === 'boolean' ? constraint['stretch'] : false,
    compress: typeof constraint['compress'] === 'boolean' ? constraint['compress'] : false,
    uniform: typeof constraint['uniform'] === 'boolean' ? constraint['uniform'] : false,
  };
}

// 0.3.x -> 0.4.0 (ADR-0009): inject the transform-constraint variant flags (local/relative false), which
// reproduces the ADR-0003 world, absolute behavior. Preserves the mix/offset channels and optional order.
function migrate04Transform(constraint: unknown): unknown {
  if (!isRecord(constraint)) return constraint;
  return {
    ...constraint,
    local: typeof constraint['local'] === 'boolean' ? constraint['local'] : false,
    relative: typeof constraint['relative'] === 'boolean' ? constraint['relative'] : false,
  };
}

// 0.3.x -> 0.4.0 (ADR-0009): reshape one animation IK frame value, replacing `bendPositive` with the
// signed `bend` while preserving `mix` and the frame's time/curve and any optional depth channels.
function migrate04IkFrame(frame: unknown): unknown {
  if (!isRecord(frame)) return frame;
  const value = frame['value'];
  if (!isRecord(value)) return frame;
  const rest = { ...value };
  delete rest['bendPositive'];
  return { ...frame, value: { ...rest, bend: bendFrom(value) } };
}

// 0.3.x -> 0.4.0 (ADR-0009): reshape each animation's IK timeline frames (bendPositive -> bend). Every
// other timeline is unchanged; drawOrder/events are already present at 0.3.0. Pure: returns new records.
function migrate03xAnimations(animations: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, anim] of Object.entries(animations)) {
    if (isRecord(anim) && isRecord(anim['ik'])) {
      const ik: Record<string, unknown> = {};
      for (const [constraintName, frames] of Object.entries(anim['ik'])) {
        ik[constraintName] = Array.isArray(frames) ? frames.map(migrate04IkFrame) : frames;
      }
      out[name] = { ...anim, ik };
    } else {
      out[name] = anim;
    }
  }
  return out;
}

// 0.3.x -> 0.4.0 (ADR-0009): deepen the constraints (signed bend, IK depth defaults, transform variant
// flags) and remap the animation IK frames, stamp formatVersion 0.4.0, and recompute the content hash
// when the source carried one (a draft with an empty hash stays a draft). The reshaped constraints and
// injected fields change the canonical bytes, so a non-empty hash MUST be recomputed. Every OTHER F2
// addition (constraint order, linked meshes, sequences, split/component/dark timelines, skin scoping) is
// optional or new-and-unreferenced by a 0.3.0 document, so the migration injects nothing for them.
function migrate03xTo04(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const next: Record<string, unknown> = {
    ...input,
    ikConstraints: Array.isArray(input['ikConstraints'])
      ? input['ikConstraints'].map(migrate04Constraint)
      : input['ikConstraints'],
    transformConstraints: Array.isArray(input['transformConstraints'])
      ? input['transformConstraints'].map(migrate04Transform)
      : input['transformConstraints'],
    animations: isRecord(input['animations'])
      ? migrate03xAnimations(input['animations'])
      : input['animations'],
    formatVersion: '0.4.0',
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
  { fromKey: 2, toKey: 3, targetVersion: '0.3.0', migrate: migrate02xTo03 },
  { fromKey: 3, toKey: 4, targetVersion: '0.4.0', migrate: migrate03xTo04 },
];
