# ADR-0004 (ADR-2.FORMAT): Phase 2 additive format additions, formatVersion 0.2.0, and the migration

Status: Accepted (2026-06-27)
Owner: Format Contract
Gates: ALL Phase 2 format schema work (WP-2.2 codec/validator, the constraint and timeline schemas required by
WP-2.6/2.7/2.9). MUST be Accepted before the schema is touched (Law 3 STOP-and-ADR).
Cross-ref: `docs/plan/cross-cutting/format-contract.md` sections 4, 8.4, 10; `docs/plan/phase-2-rigging.md`
sections 3 and 9; `MARIONETTE_HANDOFF.md` section 6; ADR-0002 (weighted encoding).

## Context (the discrepancy this ADR records)

The Phase 2 plan section 9 "Law 3 ledger" asserts that IK, transform constraints, skins, and deform need NO
additive code in `packages/format` because they "use existing section 6 types." Reading the ACTUAL Phase 1 format
shows that is not true. Phase 0/1 deliberately shipped a SUBSET of the handoff section 6 schema (the
`packages/format/src/schema/document.ts` comment states this explicitly): the Phase 1 format has

- NO `ikConstraints` / `transformConstraints` arrays on `SkeletonDocument`,
- NO `Animation.ik` / `Animation.transform` / `Animation.deform` timelines (the `animationSchema` is `.strict()`
  with only `{ duration, bones, slots }`),
- NO `IkConstraint` / `TransformConstraint` / `IkFrame` / `TransformFrame` / `DeformTimelines` schemas at all.

Phase 2 first AUTHORS IK constraints, transform constraints, and deform, so it MUST add these schemas. The format
architecture ANTICIPATED this: `FORMAT_ERROR_CODES` already reserves every code these validators emit
(`IK_*`, `TC_*`, `CONSTRAINT_NAME_DUPLICATE`, `ANIM_IK_UNKNOWN`, `ANIM_TRANSFORM_UNKNOWN`, `DEFORM_*`,
`MESH_WEIGHT_*`, `MIGRATION_REQUIRED`) with the comment that they "are produced by the mesh/animation/constraint/
migration validators that land in later phases," and the document.ts comment states adding the constraint/timeline
fields is "a format MINOR bump with a tested migration."

This ADR is the STOP-and-ADR record (plan section 3) for that discrepancy: it pins the additive schema changes, the
`formatVersion` bump, and the migration so no schema edit is made against an unpinned contract. It does NOT change
the MEANING of any existing field; no previously-expressible document changes shape.

## Decision

### 1. Additive schema changes (the handoff section 6 shapes, made real)

Add to `packages/format` (Zod source of truth in `src/schema/*`), matching handoff section 6 exactly:

- `SkeletonDocument` gains `ikConstraints: IkConstraint[]` and `transformConstraints: TransformConstraint[]`
  (REQUIRED arrays, may be empty), placed before `animations`.
- `IkConstraint`: `{ name: string; bones: string[]; target: string; mix: number; bendPositive: boolean }`.
- `TransformConstraint`: `{ name; bones: string[]; target; mixRotate; mixX; mixY; mixScaleX; mixScaleY; mixShearY;
  offsetRotation; offsetX; offsetY; offsetScaleX; offsetScaleY; offsetShearY }` (all numbers finite).
- `Animation` gains `ik: Record<string, Keyframe<IkFrame>[]>`, `transform: Record<string, Keyframe<TransformFrame>[]>`,
  and `deform: DeformTimelines` (REQUIRED records, may be empty). The animation schema stays `.strict()`.
- `IkFrame`: `{ mix: number; bendPositive: boolean }`. `TransformFrame`: a PARTIAL record of the six `mix*`
  channels (`mixRotate?`, `mixX?`, ... `mixShearY?`), each finite when present (a frame MAY carry a subset; the
  meaning of an absent channel is solve semantics, ADR-0003, not format).
- `DeformTimelines`: `Record<skinName, Record<slotName, Record<attachmentName, Keyframe<{ offsets: number[] }>[]>>>`.
- `MeshAttachment` keeps its existing shape (already present from Phase 1); the WEIGHTED ENCODING is validated, not
  reshaped (ADR-0002).
- Add the constant `MAX_BONE_INFLUENCES = 4` and `WEIGHT_SUM_EPSILON = 1e-4` to `packages/format` (ADR-0002).

Phase 2 does NOT add `events` / `EventDef` (document or animation), `drawOrder` timelines, `darkColor` semantics
beyond Phase 1, or the orphaned attachment authoring. Those stay deferred (handoff subset discipline, Law 5); the
format can grow them additively in their own phase with their own ADR. The reserved codes for them
(`ANIM_EVENT_UNKNOWN`, `DRAWORDER_INCOMPLETE`, `EVENT_NAME_DUPLICATE`) stay unreached this phase.

### 2. Classification and version (format-contract section 10)

Making previously-absent fields REQUIRED means a Phase 1 document (which lacks them) no longer satisfies the new
schema. By section 10.2 that is a BREAKING change (an optional/absent field becomes required). Pre-1.0 (section
10.3) a breaking change bumps MINOR and ships a written, tested migration. Therefore:

- `CURRENT_FORMAT_VERSION` moves `0.1.0 -> 0.2.0`. `SUPPORTED_FORMAT_MAJOR` stays `0`.
- The migration key moves `1 -> 2` (pre-1.0 the key is the MINOR digit), so the existing version gate routes a
  `0.1.0` document through the migration chain instead of rejecting it.

Rationale for REQUIRED (not optional) fields: it matches handoff section 6 (which lists them as required), keeps
downstream code (document-core, runtime-core, exporter) free of `field ?? []` fallbacks, and a one-step migration
makes old documents loadable at zero authoring cost. The trade-off accepted: we must build the migration framework
now (the deferred WP-F.8), which Phase 2 needs anyway.

### 3. Migration framework (WP-F.8, built now) and the 0.1.0 -> 0.2.0 step

Implement the framework exactly as specified in format-contract section 10.4: `version/migrations/index.ts`
(`MigrationStep`, the `MIGRATIONS` registry), `version/migrate.ts` (`runMigrations`, `migrateToCurrent`,
`MigrationResult`), and wire the version gate in `validate/index.ts` to run the contiguous chain when a document is
below current by migration key, emitting `UNSUPPORTED_FORMAT_VERSION` on a missing link and `MIGRATION_REQUIRED`
when a step produces an invalid intermediate.

The single registered step:

```
{ fromKey: 1, toKey: 2, targetVersion: '0.2.0',
  migrate(doc): inject ikConstraints: [], transformConstraints: [] on the root;
                for each animation, inject ik: {}, transform: {}, deform: {};
                set formatVersion = '0.2.0';
                recompute `hash` over the new canonical content IFF the source hash was non-empty
                (a draft with hash '' stays a draft; hash '' is a HASH_ABSENT warning, not an error). }
```

The hash MUST be recomputed because the canonical content includes `formatVersion` and the injected empty
collections (`canonicalize.ts` excludes only the self-referential `hash` key), so a migrated document's stored hash
would otherwise mismatch. Recomputation is pure and deterministic.

Migration tests (format-contract section 10.5), mandatory: `migrate(before)` deep-equals the frozen `after`
fixture; `validateDocument(after).ok === true`; the oldest-version chain migrates to current and validates;
`migrateToCurrent(currentVersionDoc)` returns `{ kind: 'unchanged' }`. A frozen `0.1.0` before-fixture and its
`0.2.0` after-fixture are committed.

### 4. Validator additions (format-contract section 8.4 families), additive

- MESH (ADR-0002): weighted decode, bone range, manifest, influence cap, weight sum; unweighted length.
- CONSTRAINT: `IK_BONES_ARITY`, `IK_BONE_MISSING`, `IK_TARGET_MISSING`, `IK_CHAIN_DISCONTINUOUS`, `IK_MIX_RANGE`,
  `TC_BONE_MISSING`, `TC_TARGET_MISSING`, `TC_MIX_RANGE`, `CONSTRAINT_NAME_DUPLICATE`, plus the no-cycle
  (target-not-an-ancestor-of-its-bone) rule (ADR-0003 section 5) surfaced as a constraint code.
- ANIMATION: `ANIM_IK_UNKNOWN`, `ANIM_TRANSFORM_UNKNOWN` (ik/transform timeline keys reference an existing
  constraint), `IK_MIX_RANGE`/`TC_MIX_RANGE` on frame mix channels, plus the existing time range/order/duration
  applied to the new timelines (ik/transform are strict-ascending value timelines; deform likewise).
- DEFORM: `DEFORM_SKIN_UNKNOWN`, `DEFORM_SLOT_UNKNOWN`, `DEFORM_ATTACHMENT_UNKNOWN`, `DEFORM_NOT_MESH`,
  `DEFORM_OFFSET_LENGTH` (`offsets.length === 2 * V`).
- The degenerate-shear rejection near +/- 90 degrees (ADR-0003 section 6) is applied to setup-pose/keyed shears.

Backward compatibility (acceptance step 2): every committed Phase 1 golden document still validates and round-trips
deep-equal AFTER migration to 0.2.0. A property test asserts this.

### 5. Process (format-contract section 11 checklist)

This ADR covers items 1-2 (necessity, classification). The implementing PR(s) complete items 3-14: update Zod
schemas, regenerate JSON Schema (if the gen:schema artifact exists), add the codes to families with tests, write
the migration + before/after fixtures + section 10.5 tests, bump `CURRENT_FORMAT_VERSION`, add a CHANGELOG entry,
update format-contract.md section 4 tables to mark the constraint/timeline shapes as REALIZED (not deferred), and
keep CI green (lint no-any/no-as, schema drift, structural/semantic/mesh/animation/hash/migration tests,
conformance). Conformance fixtures are added by WP-2.10 as each runtime-core solve path goes green.

## Consequences

- `packages/format` receives a substantial additive diff in Phase 2 (constraint + timeline schemas, weighted codec
  + validator, migration framework). This is expected and correct; it does NOT violate Law 3 because no existing
  field is removed or repurposed and the version bump + migration are the sanctioned mechanism. Acceptance step 6
  (`assert-format-version-stable.mjs`) will see a version change `0.1.0 -> 0.2.0`; it must find THIS ADR (which
  references `0.2.0`) to pass, which is exactly the intended gate.
- `document-core` `newDocState` / save-load and the exporter emit 0.2.0 documents with the new (possibly empty)
  collections. `runtime-core`/`runtime-web` read them (the constraint/skin/deform solve is the rest of Phase 2).
- The Phase 2 plan section 9 ledger is corrected by this ADR: it should read "IK / transform / deform add
  backward-compatible SCHEMA code in `packages/format` (this ADR), not just the weighted codec." The plan is the
  bug where it disagrees; this ADR is the resolution.

## Alternatives considered

- Make the new fields OPTIONAL and keep `formatVersion` at 0.1.0. Rejected: even an additive MINOR trips the
  pre-1.0 migration-key gate for old documents (the gate keys on the moving MINOR digit), so a version bump +
  migration is needed regardless; and optional fields would litter downstream code with `?? []` and diverge from
  handoff section 6. Required fields + a trivial migration is cleaner and matches the spec.
- Defer constraints/deform to a later phase to avoid the format change. Rejected: they ARE Phase 2 (the exit
  milestone requires IK + transform + deform); deferring them is deferring Phase 2.
- Fold this into ADR-0002. Rejected: ADR-0002 is narrowly the weighted-vertex encoding semantics; the version bump
  and the constraint/timeline schema additions are broader and deserve their own record.
