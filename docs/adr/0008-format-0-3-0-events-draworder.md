# ADR-0008 (ADR-A1.FORMAT): formatVersion 0.3.0, events, draw-order timelines, and skeleton metadata

Status: Accepted (2026-07-08)
Owner: Lane A (Contracts)
Gates: ALL PP-A1 (stage F1) schema, validator, and migration work in `packages/format`. MUST be Accepted
before the schema is touched (Law 3 STOP-and-ADR, pro-parity-execution-plan.md section 3).
Cross-ref: `docs/plan/pro-parity-execution-plan.md` sections 3 and 4 (Lane A, PP-A1);
`docs/plan/cross-cutting/format-contract.md` sections 4.2, 4.8, 4.10, 8.4, 10; `MARIONETTE_HANDOFF.md`
section 6; ADR-0004 (the Phase 2 additive template this ADR follows).

## Context

Stage F1 of the Pro Parity program (`pro-parity-execution-plan.md` section 3) is the first format bump
after Phase 2. The audit records three presentation capabilities that the certified authoring surface
needs and that the current 0.2.0 format cannot express:

1. Named events with payloads and an audio hint, plus a per-animation event timeline that fires them.
2. A per-animation draw-order timeline that reorders which slot draws in front of which, over time.
3. A document-level metadata block (authoring frame rate and asset directories).

The current 0.2.0 format has none of these. `SkeletonDocument` carries no `events` collection and no
`metadata` block, and `Animation` is a closed (`.strict()`) object with exactly
`{ duration, bones, slots, ik, transform, deform }`. The format architecture ANTICIPATED this stage:
`FORMAT_ERROR_CODES` already reserves `DRAWORDER_INCOMPLETE`, `EVENT_NAME_DUPLICATE`, and
`ANIM_EVENT_UNKNOWN` (unreached in Phase 0 to 2), and both ADR-0004 and the `document.ts` comment name
events and draw-order timelines as a future MINOR bump with its own ADR and migration. This ADR is that
record.

Law 4 binds this work: every shape below is designed from the published concept of skeletal animation
(named events, per-frame draw-order changes, project metadata), not from any Spine source or Spine
serialization. The encoding is ours.

## Decision

### 1. Event definitions on the document

Add `SkeletonDocument.events: EventDef[]`, a REQUIRED array (empty when a rig defines no events), where:

```ts
EventAudio { path: string(nonempty); volume: number in [0, 1]; balance: number in [-1, 1] }
EventDef   { name: string(nonempty); int?: integer; float?: number; string?: string; audio?: EventAudio }
```

- `name` is the identity an animation's event timeline references. Names are UNIQUE across the document
  (`EVENT_NAME_DUPLICATE`).
- `int`, `float`, and `string` are OPTIONAL payload defaults the event carries when it fires. An
  event-timeline key MAY override any of them (see section 2). `int` is an integer; a non-integer fails
  structurally as `SCHEMA_SHAPE`.
- `audio` is an OPTIONAL playback hint: a required asset `path`, a `volume` in [0, 1], and a stereo
  `balance` in [-1, 1] (left to right). Out-of-range `volume` or `balance` is `EVENT_AUDIO_RANGE`.

`events` is an ARRAY, not a `Record<name, def>`. This is deliberate and mirrors `bones` and `slots`: name
uniqueness is a graph invariant that must surface as a typed ERROR (`EVENT_NAME_DUPLICATE`) reachable by a
committed negative fixture. A `Record` would make duplicate names undetectable in a parsed object (JSON
parse silently keeps the last), demoting the fault to a best-effort reviver WARNING and leaving the
reserved error code permanently unreachable. An array keeps the fault a first-class validation error, in
the same family as the other name-uniqueness checks.

### 2. Per-animation event timeline

Add `Animation.events: EventKeyframe[]`, a REQUIRED array (empty when the animation fires none), where:

```ts
EventKeyframe { time: number; name: string; int?: integer; float?: number; string?: string }
```

- `name` must reference a defined `EventDef` (`ANIM_EVENT_UNKNOWN`).
- The optional `int`, `float`, `string` OVERRIDE the event's payload defaults for this firing. The MEANING
  of a firing (which payload wins, whether an event fires once or repeatedly across a loop boundary) is
  SOLVE semantics owned by `runtime-core` and locked by conformance (Lane B, PP-B4); the format carries
  the data and validates only its shape and references.
- There is no `curve`: events are discrete, not interpolated.
- Event times are NON-DECREASING: two events MAY legitimately fire at the same time, so coincident times
  are legal and only a strictly DECREASING adjacent pair is `ANIM_TIME_ORDER`. This is the one timeline
  whose ordering is non-decreasing rather than strict (format-contract section 4.8); the value timelines
  and the draw-order timeline (section 3) remain strictly ascending because interpolation or a discrete
  swap between two keys at the same time is undefined.

Time ordering reuses the existing `ANIM_TIME_ORDER` code (already live) rather than adding a new one; the
strict-versus-non-decreasing distinction is a parameter of the shared time-order check, not a new fault
class.

### 3. Per-animation draw-order timeline (the offset representation)

Add `Animation.drawOrder: DrawOrderKeyframe[]`, a REQUIRED array (empty when the animation never reorders),
where:

```ts
DrawOrderOffset  { slot: string; offset: integer }
DrawOrderKeyframe { time: number; offsets: DrawOrderOffset[] }
```

Each key describes the draw order AT `time` as a COMPACT LIST OF OFFSETS from the setup draw order (the
`slots` array order, index 0 furthest back). Each entry moves one named slot by a signed integer number of
positions. An EMPTY `offsets` list means the setup order (identity), so a key can restore the setup order
after an earlier reorder. There is no `curve`: a draw-order change is a discrete (stepped) reordering.

The offset (diff) representation is chosen over storing a full slot-name permutation per key because a
draw-order change in practice touches a handful of slots out of many, so a diff is far more compact and it
makes an unchanged setup order a zero-entry key rather than a full restated list. This supersedes the
full-permutation sketch in format-contract section 4.10 for stage F1; the divergence is recorded in the
Consequences below for the contract document to reconcile (that document is outside Lane A's code map).

The FULL per-frame order is DERIVED from the setup order plus the offsets. That derivation is SOLVE
behavior owned by `runtime-core` (Lane B, PP-B4), exactly as skinning and constraint solving are; the
format does not run it. The format validates only that a key's offsets describe a CONSISTENT reordering,
which is a pure shape-and-graph check:

- A listed slot must exist. An unknown slot name is `ANIM_SLOT_UNKNOWN` (the existing ANIM-family code for
  a timeline that references a missing slot).
- Within one key, a slot appears at most once, every derived target index (setup index + offset) is in
  [0, slotCount), and no two listed slots resolve to the same target index. Any of these makes the key an
  inconsistent (incomplete) reordering: `DRAWORDER_INCOMPLETE`.

The format does NOT simulate the fill of unlisted slots (that is the runtime derivation); it validates the
listed entries' internal consistency, which is what makes `DRAWORDER_INCOMPLETE` decidable from the data
alone without reimplementing the solve.

### 4. Skeleton metadata block

Add `SkeletonDocument.metadata?: SkeletonMeta`, OPTIONAL and closed:

```ts
SkeletonMeta { fps?: number(positive); imagesPath?: string; audioPath?: string }
```

These are authoring hints that do not affect the solve: `fps` is the authoring frame rate (positive, for
example 30); `imagesPath` and `audioPath` are project-relative source-asset directories the editor uses to
relocate assets. Every field is optional and the block is `.strict()`. The block is OPTIONAL because a
document authored before this stage, or one with no such hints, is legitimately without it; keeping it
optional means the migration does not have to invent values.

### 5. New error code

One new `FormatErrorCode` is added: `EVENT_AUDIO_RANGE` (SCHEMA family), a structural range refinement for
audio `volume` and `balance`, mirroring `COLOR_RANGE` and the mix-range refinements (a range fault carries
its own informative code rather than a generic `SCHEMA_SHAPE`). The three reserved codes
`DRAWORDER_INCOMPLETE`, `EVENT_NAME_DUPLICATE`, and `ANIM_EVENT_UNKNOWN` become LIVE validators; no new code
is needed for time ordering (it reuses `ANIM_TIME_ORDER`). Check-family assignment (format-contract section
8.4): `DRAWORDER_INCOMPLETE` is ANIM; `EVENT_NAME_DUPLICATE` and `ANIM_EVENT_UNKNOWN` are EVENT;
`EVENT_AUDIO_RANGE` is SCHEMA.

### 6. Classification and version

Making previously-absent fields REQUIRED (`events` on the document, `drawOrder` and `events` on every
animation) means a 0.2.0 document no longer satisfies the new schema. By format-contract section 10.2 that
is a BREAKING change; pre-1.0 (section 10.3) a breaking change bumps MINOR and ships a written, tested
migration. Therefore `CURRENT_FORMAT_VERSION` moves `0.2.0 -> 0.3.0`; `SUPPORTED_FORMAT_MAJOR` stays 0; the
migration key moves `2 -> 3` so the version gate routes a 0.2.x (and, through the existing 0.1.x step, a
0.1.x) document through the chain rather than rejecting it.

The required-not-optional choice follows ADR-0004: it matches the handoff (which lists the collections as
present), keeps downstream code (document-core, runtime-core, the exporter) free of `?? []` fallbacks, and a
one-step migration makes old documents loadable at zero authoring cost. `metadata` is the one exception
(optional), because unlike the collections it has no empty-but-present meaning.

### 7. Migration 0.2.x to 0.3.0 and the chained-migration validation fix

Register the step `{ fromKey: 2, toKey: 3, targetVersion: '0.3.0' }`:

```
migrate(doc): inject events: [] on the root;
              for each animation, inject drawOrder: [] and events: [];
              set formatVersion = '0.3.0';
              recompute hash over the new canonical content IFF the source hash was non-empty
              (a draft with hash '' stays a draft; hash '' is a HASH_ABSENT warning, not an error).
```

The hash MUST be recomputed because the canonical content includes `formatVersion` and the injected
collections. Recomputation is pure and deterministic.

This stage exposes a latent limitation in `runMigrations`: it validated EACH intermediate against the
CURRENT schema, which only worked while there was a single step landing on current. With a two-step chain
(0.1.x to 0.2.0 to 0.3.0), the 0.2.0 intermediate produced by the first step lacks the 0.3.0 fields and
would fail validation against the 0.3.0 schema, breaking 0.1.x backward compatibility. The fix, consistent
with format-contract section 10.4 (validate the migrated result), is to run the full contiguous chain and
validate the FINAL document once against the current schema (a failure is reported as `MIGRATION_REQUIRED`
attributed to the last step). Intermediate versions legitimately carry intermediate shapes; only the final
result must satisfy the current schema. Missing-link detection (`UNSUPPORTED_FORMAT_VERSION`) is unchanged.

### 8. Process (format-contract section 11 checklist)

This ADR covers items 1 to 2 (necessity, classification). The implementing commits complete items 3 to 14:
Zod schemas in `src/schema/*`, the `EVENT_AUDIO_RANGE` code assigned to its family with tests, the semantic
draw-order and event validators, the migration plus its tests, the golden corpus (positive fixtures that
exercise the new shapes plus one negative fixture per new code, named by the code), the `CURRENT_FORMAT_VERSION`
bump, the CHANGELOG and README updates, and the barrel-surface test kept in sync. Conformance fixtures and
the solve are Lane B (PP-B4), landed after this stage merges.

## Consequences

- `packages/format` receives an additive diff (event, draw-order, and metadata schemas, their validators,
  and the 0.2.x to 0.3.0 migration). No existing field is removed or repurposed, so Law 3 is upheld through
  the version bump plus migration mechanism. `assert-format-version-stable.mjs` sees `0.2.0 -> 0.3.0` and
  requires THIS ADR (which references `0.3.0`) to pass, which is the intended gate.
- Blast radius: every downstream package that CONSTRUCTS a `SkeletonDocument` or an `Animation` literal
  (runtime-core, conformance, document-core, mcp-server, runtime-web, editor) must add the new required
  collections. That ripple is the orchestrator's merge-time job across lanes (plan section 3); Lane A does
  not edit those packages. Documents on disk load unchanged via the migration.
- format-contract section 4.10 currently sketches the draw-order key as a full slot-name permutation
  (`order`). This ADR adopts the offset (diff) representation instead (section 3). The contract document
  (outside Lane A's code ownership) needs a follow-up edit to match; this ADR is the authority for the
  implemented shape in the interim.
- Lane B (PP-B4) owns the draw-order derivation and event-firing solve semantics, including loop-boundary
  behavior; this ADR deliberately leaves those to `runtime-core` and conformance and scopes the format to
  shape and reference validity.

## Alternatives considered

- `events` as a `Record<name, EventDef>`. Rejected: it makes name uniqueness undetectable in a parsed
  object and leaves `EVENT_NAME_DUPLICATE` unreachable, contradicting the reserved-code contract.
- Full slot-name permutation per draw-order key (format-contract section 4.10 as written). Rejected for
  stage F1: it restates the entire order on every key even when one slot moves, and it cannot represent
  "back to setup order" as a compact key. The offset diff is more compact and keeps the empty key
  meaningful. `DRAWORDER_INCOMPLETE` is defined for the offset form as an inconsistent (colliding or
  out-of-range) set of offsets.
- Generic `SCHEMA_SHAPE` for audio range instead of a dedicated `EVENT_AUDIO_RANGE`. Rejected: the format
  gives range faults their own informative codes (COLOR_RANGE, the mix ranges); audio range is the same
  kind of fault and deserves the same treatment (errors carry information).
- Making the new collections OPTIONAL to avoid the migration and blast radius. Rejected for the same
  reasons as ADR-0004: the pre-1.0 migration-key gate routes old documents through migration regardless, so
  a migration is needed anyway, and optional collections would litter downstream code with `?? []` and
  diverge from the handoff. Required collections plus a trivial migration is cleaner. `metadata` stays
  optional because it alone has no empty-but-present meaning.
