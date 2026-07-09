# Cross-cutting: The data format contract (`packages/format`)

| Field | Value |
|---|---|
| Doc ID | `XC-FORMAT` |
| Status | Plan of record (requires senior reviewer sign-off before WP-F.1 starts) |
| Owner | Format / runtime-core lead |
| Source of truth | `MARIONETTE_HANDOFF.md` section 6 (types), 7 (math boundary), 8.1 (commands), 8.5 (mesh/deform), 8.11 (conformance), 12 (Phase 0) |
| Laws upheld | LAW 3 (the data format is THE contract), LAW 4 (no Spine source/format compatibility), LAW 1 (math/presentation boundary), invariant: TS strict, no `any`, no unjustified `as` in `packages/format` |
| Consumers | `apps/editor` (import/export, validate-on-load, hash verify), `packages/runtime-web` (load path, `verifyHash: false`), `packages/runtime-core` (types only), `packages/conformance` (fixtures + validation), `runtimes/unity`, `runtimes/godot` (reimplement readers, validated by conformance) |

This document is the plan of record for `packages/format`. The format is the single expensive-to-change artifact in the system (LAW 3). Everything that reads or writes a `SkeletonDocument` depends on the decisions frozen here. A reviewer signs off on this document before any schema code is written.

This document validates SHAPE and GRAPH. It does NOT decide SOLVE behavior. Wherever a question is about how a runtime computes a frame (the per-frame solve order, how deform offsets combine with skinning, what an absent timeline channel means), the authority is `runtime-core` plus the committed conformance fixtures, never this document. That separation is an engineering invariant (solving lives in core; fixtures are generated from runtime-core, the behavioral source of truth) and this revision honors it strictly.

---

## 1. Scope and non-scope

### 1.1 What `packages/format` IS

`packages/format` is a pure, platform-agnostic, dependency-leaf package that owns:

1. The type model of `SkeletonDocument` and every nested type (section 6 of the handoff, clarified in section 4 below). One source of truth.
2. A runtime validator that validates a document on import, fails loudly, and returns structured typed errors (section 8).
3. A generated JSON Schema artifact derived from the same source as the types (section 7).
4. Content hashing for runtime cache-busting (section 9).
5. The version gate and the migration framework (section 10).
6. The Phase 4 slot scene contract (section 15): the `SlotSceneDocument` envelope and its OWN, independently versioned `slotSceneFormatVersion`, the `SlotScene` aggregate and its sub-schemas (`GridConfig` plus `AnticipationConfig`, `SymbolAnimSet`, `WinSequenceConfig`, `FeatureFlowGraph`, `TumbleChoreography`), `SceneRefs`, the relocation of `SymbolId` and the authoring-config types into this package (CD-1, recorded in command-history section 14), the slot validator, and the slot content hash (which REUSES the section 9.2 canonical algorithm, not a second one). This is a SECOND, separately semver'd format owned here; it never changes the skeleton `formatVersion`.

### 1.2 What `packages/format` is NOT

- It contains NO solve logic. World transforms, IK, skinning, timeline sampling, deform application, and the per-frame solve order all live in `runtime-core`. The format defines the data those algorithms consume and is agnostic to how they run.
- It contains NO rendering and NO PixiJS import. It is a leaf with zero internal-monorepo dependencies.
- It does NOT mutate documents. The validator and hash functions are pure (deterministic, side-effect free). Document mutation is the editor's `Command`/`History` concern (LAW 2), not the format's.
- It is NOT Spine-compatible by design (LAW 4). It does not read or write Spine `.json`/`.skel`, does not vendor Spine code, and does not claim binary compatibility. The structure is the well-understood general structure of skeletal formats; the encoding is ours.

### 1.3 Dependency direction (enforced)

```
format  (leaf, zero internal deps)
  ^  ^  ^
  |  |  └── conformance        (imports validators + types)
  |  └───── runtime-web        (imports validators + types on load path; verifyHash: false)
  └──────── editor             (imports validators + types on import/export; verifyHash: true)

runtime-core ── import type only ──> format/types   (zero runtime dependency)
```

`runtime-core` must stay dependency-light (engineering invariant). It therefore imports from `format` using `import type` exclusively, through the `@marionette/format/types` subpath. With `verbatimModuleSyntax: true`, those imports erase at compile time and add zero runtime weight, so the Zod runtime dependency that backs the validators never reaches `runtime-core`. This boundary is lint-enforced (WP-F.9).

`runtime-web` and the editor both import the value barrel (`@marionette/format`) and therefore both link the validator. They differ in one option only: the editor import boundary verifies the content hash (`verifyHash: true`, the default), while `runtime-web` passes `verifyHash: false` on its load path because runtimes treat `hash` as opaque (section 9.3). The dependency cost of the hash backend is discussed in section 14.

---

## 2. Architectural laws this document touches (call-outs)

| Law / invariant | How this document honors it |
|---|---|
| LAW 1 (math/presentation boundary) | `SkeletonDocument` contains presentation only. It carries no RNG, no outcome, no `SpinResult` fields. `SpinResult` lives in `packages/math-bridge`, never in `format`. The validator rejects any attempt to smuggle outcome data by keeping the schema closed (no free-form passthrough objects in the skeleton document). |
| LAW 3 (format is THE contract) | `formatVersion` is semver of the FORMAT. Every consumer validates on import. Changes follow the section 11 checklist and bump the version. |
| LAW 4 (Spine legal boundary) | No Spine import/export, no vendored runtime, no binary compatibility claim. The mesh and timeline encodings here are specified from first principles in this document. |
| Invariant: strict TS, no `any`, no unjustified `as` | Zod schemas are the source; types are derived by `z.infer`. `schema.safeParse(input)` returns a result whose `.data` is ALREADY typed as the schema output (`SkeletonDocument`), so the validator carries `result.data` straight through with ZERO `as` casts and zero `any`. There is no hand-written `.d.ts` to drift and no narrowing cast anywhere in the package. |
| Invariant: solving lives in core; fixtures generated from `runtime-core` | The format owns the DATA contract; `runtime-core` owns the ALGORITHM contract. This document never adjudicates solve semantics. Where solve behavior is referenced (solve order, deform application, absent-channel meaning) it points to handoff section 6 plus `runtime-core` plus conformance, and explicitly flags any open ambiguity for the `runtime-core` plan owner to resolve. |
| No em-dashes or en-dashes | Enforced in this doc and in all generated error messages and schema descriptions. |

---

## 3. Package layout

```
packages/format/
  package.json                 # exports map: "." (validators) and "./types" (type-only)
  schema.json                  # GENERATED JSON Schema artifact (committed, drift-checked)
  src/
    schema/                    # Zod schemas: the single source of truth
      color.ts                 # rgbaSchema
      bone.ts                  # boneSchema, transformModeSchema
      slot.ts                  # slotSchema, blendModeSchema
      attachment.ts            # 5 attachment schemas + discriminated union
      constraint.ts            # ikConstraintSchema, transformConstraintSchema
      animation.ts             # animationSchema + all timeline schemas, curveSchema
      atlas.ts                 # atlasRefSchema, pageSchema, regionSchema
      document.ts              # skeletonDocumentSchema (root)
      index.ts                 # internal barrel for schemas
    types.ts                   # z.infer<...> derived types (re-exported, type-only surface)
    validate/
      errors.ts                # FormatError / FormatWarning unions + codes + FormatValidationError
      structural.ts            # Zod parse -> typed errors (shape layer), records failed paths
      semantic.ts              # referential integrity + invariants (graph layer)
      mesh.ts                  # vertex encoding decode + weight checks
      animation.ts             # timeline checks (order, range, draw-order completeness)
      isolation.ts             # shape-failure isolation (read-set vs failed-paths overlap)
      report.ts                # ValidationReport aggregation
      reviver.ts               # JSON.parse duplicate-key-detecting reviver (string path)
      index.ts                 # validateDocument, validateDocumentJson, parseDocument
    hash/
      canonicalize.ts          # deterministic canonical JSON
      hash.ts                  # computeContentHash, verifyContentHash
    version/
      constants.ts             # CURRENT_FORMAT_VERSION, SUPPORTED_FORMAT_MAJOR
      semver.ts                # parseSemVer, compareFormatVersion, migrationKeyOf
      migrate.ts               # migrateToCurrent + runMigrations (injectable chain)
      migrations/
        index.ts               # production registry (EMPTY for Phase 0)
    slot/                      # Phase 4 SECOND contract (section 15); lands when Phase 4 starts (LAW 5)
      symbol-id.ts             # SymbolId brand + shared slot scalars (CD-1)
      scene-document.ts        # SlotSceneDocument envelope + SlotScene aggregate + SceneRefs
      grid-config.ts           # GridConfig + AnticipationConfig + GravityRule (owned by phase-4 WP-4.5)
      symbol-anim-set.ts       # SymbolAnimSet (owned by phase-4 WP-4.6)
      win-sequence-config.ts   # WinSequenceConfig (owned by phase-4 WP-4.8)
      feature-flow-graph.ts    # FeatureFlowGraph (owned by phase-4 WP-4.9)
      tumble-choreography.ts   # TumbleChoreography (owned by phase-4 WP-4.10, conditional track)
      validate-slot.ts         # validateSlotScene + semantic checks (section 15.4)
      hash-slot.ts             # computeSlotSceneHash = computeContentHash over the envelope projection (15.5)
      index.ts                 # internal slot barrel
    jsonschema.ts              # getJsonSchema(): returns the committed schema.json
    index.ts                   # PUBLIC BARREL (validators, hash, version, schema, types re-export)
  scripts/
    gen-schema.ts              # zod-to-json-schema -> schema.json
  test/
    fixtures/                  # golden corpus (WP-F.10)
      migrations/              # test-only example migration chain (NOT in production registry)
    *.test.ts
```

`package.json` exports map:

```jsonc
{
  "exports": {
    ".":       { "types": "./dist/index.d.ts",  "import": "./dist/index.js" },
    "./types": { "types": "./dist/types.d.ts",   "import": "./dist/types.js" }
  }
}
```

`./types` resolves to a module that contains only `export type` re-exports (zero runtime code). `runtime-core` imports exclusively from `@marionette/format/types`.

---

## 4. The type model (normative for shape and graph)

The canonical TypeScript shapes are handoff section 6 and are NOT restated field-by-field here to avoid two sources of truth. This section pins the SHAPE and GRAPH invariants the handoff leaves implicit. It does not define solve behavior; sentences that touch solve behavior defer to `runtime-core` plus conformance.

### 4.1 Universal value constraints

These apply to every numeric and color field unless overridden:

| Constraint | Rule | Error code |
|---|---|---|
| Finiteness | Every `number` field is finite. `NaN`, `Infinity`, `-Infinity` are invalid. Enforced by `z.number().finite()`. | `SCHEMA_SHAPE` |
| RGBA range | `RGBA.r/g/b/a` each in `[0, 1]` inclusive. | `COLOR_RANGE` |
| Mix range | IK `mix`, all transform-constraint `mix*` factors, AND the same fields when they appear in timeline frames (`IkFrame.mix`, `TransformFrame.mix*`) in `[0, 1]` inclusive (section 4.8). | `IK_MIX_RANGE`, `TC_MIX_RANGE` |
| Bone `length` | `>= 0`. | `SCHEMA_SHAPE` |
| `scaleX/scaleY` | Any finite value (negative permitted; encodes reflection). | n/a |
| `rotation`, `shearX/Y` | Any finite value, in degrees. Not pre-normalized in storage; runtimes normalize as needed. | n/a |
| Closed objects | Every object schema uses `.strict()`. Unknown keys are rejected (this is the LAW 1 guard against smuggling outcome data and the LAW 3 guard against silent field drift). | `SCHEMA_SHAPE` |

The range refinements (`COLOR_RANGE`, `CURVE_BEZIER_X_RANGE`, `IK_MIX_RANGE`, `TC_MIX_RANGE`) are expressed as Zod refinements and therefore belong to the STRUCTURAL layer (section 8.3 step 2), not the semantic graph layer.

### 4.2 Root: `SkeletonDocument`

| Field | Invariant clarified |
|---|---|
| `formatVersion` | Valid semver string (`x.y.z`). The version gate (section 8.3 step 1, section 10) accepts it as-is, routes it to migration, or rejects it; the rule keys on the MIGRATION KEY (MINOR while MAJOR is 0, MAJOR from 1.0 on), not on MAJOR alone. |
| `name` | Non-empty string. |
| `hash` | Lowercase hex SHA-256 (64 chars) OR empty string. Empty means "unhashed draft". On the editor import path (`verifyHash: true`) a non-empty hash is verified against the recomputed canonical hash; an empty hash emits the `HASH_ABSENT` warning (section 9). |
| `bones` | Non-empty: enforced STRUCTURALLY by `z.array(boneSchema).min(1)`, so an empty `bones` array fails as `SCHEMA_SHAPE`, not as a semantic error. Topologically ordered: every bone's parent appears at a strictly lower index (section 5). A rootless or cyclic set is a semantic `BONE_ORDER_VIOLATION` (section 5.3). |
| `slots` | May be empty. Array order IS the setup-pose draw order (index 0 drawn first / furthest back). Slot names unique. |
| `skins` | Must contain a skin named `default`. The `default` skin may be empty but must exist, because setup-pose attachment resolution uses it (`SKIN_DEFAULT_MISSING`). |
| `ikConstraints`, `transformConstraints` | May be empty. Constraint names unique across BOTH arrays combined (a single constraint namespace). |
| `events` | `EventDef` names unique. May be empty. |
| `animations` | `Record<string, Animation>`. Keys are animation names, non-empty. Duplicate keys cannot be detected from a parsed object (section 8.6); the string import path detects them and warns. May be empty (a rig that is setup-pose only is valid). |
| `atlas` | Always present. `atlas.pages` may be empty only if no attachment references a region. |

### 4.3 `Bone`

- `parent: string | null`. `null` is a root. Non-null must name an existing bone that appears earlier in the array.
- `transformMode` is one of the five enum members in handoff section 6. It governs how the bone inherits parent rotation/scale/reflection in the world-transform pass. The format stores it; `runtime-core` implements it; conformance locks it.
- Bone `name` is the identity used by slots, constraints, weighted-mesh bone references (by index into `bones`), and animation timelines.

### 4.4 `Slot`

- `bone`: names an existing bone the slot rides on.
- `attachment: string | null`: the setup-pose active attachment NAME (the key under this slot in the `default` skin). `null` means the slot shows nothing in setup pose. If non-null it must resolve in the `default` skin under this slot (`SLOT_ATTACHMENT_MISSING`).
- `color`: per-slot tint multiplied into attachment color at render.
- `darkColor` (optional): second tint channel for two-color (light/dark) tinting. Absent means single-color tint only. Absence and presence are both valid; absence is not equivalent to black.
- `blendMode`: one of `normal | additive | multiply | screen`.

Clarification of the attachment name model: an attachment has no `name` field. Its NAME is the key it sits under in a skin's `attachments[slotName]` map. Its `path` (region/mesh attachments) is the ATLAS REGION name and may differ from the attachment name. Example: slot `head` may carry attachment named `head` whose `path` is `characters/hero/head_01`.

### 4.5 `Skin`

- `attachments: Record<slotName, Record<attachmentName, Attachment>>`.
- Top-level keys must be existing slot names (`SKIN_SLOT_UNKNOWN`).
- Runtime skin switching looks an attachment up in the active skin first and falls back to `default`. Setup pose always resolves against `default`.

### 4.6 The five attachment kinds

`Attachment` is a discriminated union on `type` (`region | mesh | clipping | point | boundingbox`). Zod uses `z.discriminatedUnion('type', [...])`.

| Type | Clarified invariants |
|---|---|
| `region` | `path` must name an existing atlas region (`ATTACHMENT_REGION_MISSING`). `width/height` are the source region size; `scaleX/scaleY`, `rotation`, `x/y` place it relative to the slot bone. |
| `mesh` | `path` must name an existing atlas region. Vertex encoding rules in section 6 (weighted and unweighted). `uvs.length` even; vertex count `V = uvs.length / 2`. `triangles.length % 3 == 0`; every index in `[0, V)`. `hullLength` is a count of HULL VERTICES (not coordinates) in `[0, V]` (`MESH_HULL_RANGE`). `edges` (optional) is editor-only wireframe data, ignored by runtimes but validated for integrity when present (see below). |
| `clipping` | `end` names an existing slot (`CLIPPING_END_MISSING`) that is at or after this clipping slot in SETUP draw order (the `slots` array order) (`CLIPPING_END_ORDER`). `vertices.length` even and `>= 6` (a clip polygon needs at least 3 points) (`POLY_VERTEX_LENGTH`). |
| `point` | An anchor (muzzle/origin). No atlas reference. `x/y/rotation` only. |
| `boundingbox` | `vertices.length` even and `>= 6` (`POLY_VERTEX_LENGTH`). No atlas reference. Used for hit/region polygons. |

Two clarifications the reviewer flagged:

- `hullLength` is a COUNT range check only. The "first `hullLength` logical vertices are the perimeter hull" rule is a PRODUCER-SIDE convention enforced by the editor's mesh tooling. The validator cannot confirm geometry, so it checks only `0 <= hullLength <= V` and does not claim those vertices actually form a hull. Treat it as a convention, not a validated guarantee.
- `edges` is OPTIONAL (matching handoff `edges?: number[]`). It carries the editor's wireframe topology so that a saved mesh round-trips its edit state on reload; it stays in the exported contract for that reason and is not stripped. Runtimes ignore it. When present it is validated: length even, every index in `[0, V)` (`MESH_EDGE_INVALID`). A corrupt `edges` array fails loudly rather than silently shipping a broken editor save.
- `clipping.end` ordering is checked against SETUP draw order only. Draw order is animatable via `DrawOrderKeyframe`, so the runtime behavior of a clip range under reordering is a `runtime-core` concern; this document scopes the format check to setup order and defers runtime clip-range semantics to the runtime-core plan.

### 4.7 Constraints

- `IkConstraint`: `bones` length is 1 or 2 (`IK_BONES_ARITY`). All `bones` and `target` name existing bones. For a 2-bone chain, `bones[1]` must be a direct child of `bones[0]` (`IK_CHAIN_DISCONTINUOUS`). `mix` in `[0, 1]` (`IK_MIX_RANGE`). `bendPositive` sets elbow/knee direction.
- `TransformConstraint`: `bones` non-empty, all exist. `target` exists. All `mix*` in `[0, 1]` (`TC_MIX_RANGE`). Offsets are unbounded finite numbers.
- Constraints are solved IK then transform, before world transforms. The canonical per-frame solve order is handoff section 6; its behavior is owned by `runtime-core` and locked by conformance, NOT by this document. Constraint parameters are animatable via the `ik` and `transform` timelines.

### 4.8 Animation and timelines

- `Animation.duration` is in seconds, `> 0` when any timeline has keyframes, and `>= max keyframe time` across ALL timelines in that animation (`ANIM_DURATION`).
- `BoneTimelines` has optional `rotate/translate/scale/shear` arrays. `SlotTimelines` has optional `attachment` and `color` arrays.
- Time ordering is per timeline kind:
  - INTERPOLATED VALUE timelines (`bone` rotate/translate/scale/shear, `slot` color, `ik`, `transform`, `deform`) and the `drawOrder` timeline are sorted STRICTLY ascending by `time`: no two keyframes share a time (`ANIM_TIME_ORDER`). Strictness matters because interpolation between two keys at the same time is undefined.
  - The `events` timeline is sorted NON-DECREASING: two events MAY legitimately fire at the same time, so equal adjacent times are allowed; only a strictly decreasing pair is `ANIM_TIME_ORDER`.
  - All times in every timeline are in `[0, duration]` (`ANIM_TIME_RANGE`).
- `Keyframe<T>.curve` is `'linear' | 'stepped' | bezier`. The curve on the LAST keyframe of a timeline is ignored (nothing follows it) and is not required to be any particular value.
- `attachment` timeline frames carry `{ time, name: string | null }`; they are stepped by nature (discrete swaps) and have no curve field. A non-null `name` must resolve in the `default` skin under that slot.
- `color` timeline frames carry an `RGBA`, each channel in `[0, 1]` (`COLOR_RANGE`).
- Bezier curve control points: `cx1, cx2` in `[0, 1]` inclusive so the easing is a function of time (`CURVE_BEZIER_X_RANGE`); `cy1, cy2` are unbounded finite (overshoot/anticipation allowed).
- `ik` and `transform` timelines key constraint parameters by constraint name; the name must reference an existing constraint (`ANIM_IK_UNKNOWN`, `ANIM_TRANSFORM_UNKNOWN`). `IkFrame.mix` and every `TransformFrame.mix*` channel PRESENT in a frame is range-checked to `[0, 1]` (`IK_MIX_RANGE`, `TC_MIX_RANGE`), the same refinement applied to the constraint definitions in section 4.7. A `TransformFrame` MAY carry a subset of mix channels (the frame type is partial). The MEANING of an absent channel during a frame (hold, zero, or inherit) is a SOLVE-SEMANTICS decision owned by `runtime-core` and locked by conformance; the format assigns it no value and does not adjudicate it.

### 4.9 `DeformTimelines`

`Record<skinName, Record<slotName, Record<attachmentName, Keyframe<{ offsets: number[] }>[]>>>`.

Shape invariants the format validates:

- `skinName` must exist; `slotName` must exist; `attachmentName` must exist under that slot in that skin AND must be a `mesh` attachment (`DEFORM_NOT_MESH`). Deform is only valid on meshes.
- `offsets.length === 2 * V`, where `V` is the target mesh's `uvs.length / 2` (`DEFORM_OFFSET_LENGTH`). Layout is `[dx0, dy0, dx1, dy1, ...]`, one `(dx, dy)` per LOGICAL vertex.

Open solve-semantics question (NOT decided here, flagged for the `runtime-core` plan owner): handoff section 6 describes these as "per-vertex (dx, dy) offsets from setup mesh"; handoff section 8.5 says the runtime "adds them after skinning". For a WEIGHTED mesh those two readings differ observably. If the offset is applied in bind-local space BEFORE skinning, the bone matrices transform the offset; if it is added in world space AFTER skinning, they do not. That is SOLVE SEMANTICS, owned by `runtime-core` and locked by a committed conformance fixture (engineering invariant: solving lives in core, fixtures are generated from runtime-core). This document does NOT resolve it. It flags the local-vs-world ambiguity for the `runtime-core` solve-plan owner to decide; once decided, the decision is recorded there and the conformance fixture pins it, and this section references that decision rather than pre-empting it. The format validates only the shape and length of `offsets` and is agnostic to the application space.

### 4.10 Draw order and events

- `DrawOrderKeyframe.offsets` is a COMPACT LIST OF SIGNED OFFSETS from the setup draw order (the `slots` array order, index 0 furthest back), not a full permutation (ADR-0008, which supersedes an earlier full-permutation sketch here). Each `{ slot, offset }` moves one named slot by a signed integer number of positions; an EMPTY `offsets` list is the identity (setup order), so a key can restore the setup order after an earlier reorder. Each listed slot must exist (`ANIM_SLOT_UNKNOWN`); within one key a slot appears at most once, every derived target index (setup index + offset) is in `[0, slotCount)`, and no two listed slots resolve to the same target index, or the key is an inconsistent (incomplete) reordering (`DRAWORDER_INCOMPLETE`). The FULL per-frame order is DERIVED from the setup order plus the offsets, a solve concern owned by `runtime-core`; the format validates only the listed entries' internal consistency. Draw-order keys are strictly ascending in time (section 4.8).
- `EventKeyframe.name` must reference an existing `EventDef` (`ANIM_EVENT_UNKNOWN`). The optional `int`/`float`/`string` override the event's payload defaults for that firing. Coincident event keyframes are permitted (event times are NON-decreasing; only a strictly decreasing adjacent pair is `ANIM_TIME_ORDER`, section 4.8). Event firing during a frame is solve behavior owned by `runtime-core`.
- `EventDef` names unique (`EVENT_NAME_DUPLICATE`). Optional `audio` carries a nonempty `path`, a `volume` in `[0, 1]`, and a stereo `balance` in `[-1, 1]`; an out-of-range volume or balance is `EVENT_AUDIO_RANGE`.

### 4.11 Atlas

- `AtlasRegion.name` is unique across ALL pages (`ATLAS_REGION_DUPLICATE`).
- `rotated` means the region is packed rotated 90 degrees; runtimes account for this when sampling UVs.
- `offsetX/offsetY` and `originalW/originalH` describe trim (transparent border stripping). A region with no trim has `offsetX=offsetY=0`, `originalW=w`, `originalH=h`.

---

## 5. The bone-ordering invariant

> Bones are stored so that every parent precedes its children. The world-transform pass is then a single forward iteration.

This invariant exists to make solve step 4 (world transforms) a single O(n) forward pass with no per-bone parent lookup beyond an already-computed parent matrix. It is load-bearing for the 60fps budget and for the C#/Godot ports.

### 5.1 Statement

For every bone `b` at index `i` with `b.parent != null`, the bone named `b.parent` appears at index `j < i`. Equivalently, a stable topological order of the parent forest. A corollary used below: any non-empty bone set that satisfies this invariant has at least one root, because the bone at index 0 cannot have a parent at an index below 0, so `bones[0].parent` must be `null`.

### 5.2 Where it is produced (enforced)

| Site | Responsibility |
|---|---|
| `DocumentModel` (editor) | Maintains the invariant continuously. `CreateBone` inserts a child immediately after its parent's subtree; `ReparentBone` re-sorts the moved subtree so it follows its new parent. There is no code path that leaves bones unsorted between commands. |
| Exporter (`apps/editor/.../export`) | Performs a final stable topological sort before serialization and asserts the result. Export of an out-of-order document is a hard error, never a silent reorder that desyncs animation timeline references. |

`CreateBone`, `ReparentBone`, and the reparent subtree re-sort are document mutations and therefore commands (LAW 2). Each carries the mandatory do/undo round-trip test (do then undo deep-equals the prior document), including the explicit assertion that `ReparentBone`'s re-sort is fully reversed on undo (the bone array returns to its exact prior order, not merely a re-topologically-equivalent one). Those tests live with the commands in `apps/editor` (cross-ref: editor command plan). This document records the obligation because the bone-ordering invariant depends on those commands maintaining it; a command that re-sorts on `do` but does not restore the exact prior order on `undo` would silently break round-trip determinism.

### 5.3 Where it is checked (validated)

| Site | Behavior |
|---|---|
| `packages/format` validator (authoritative gate) | On import, `semantic.ts` runs the bone-graph checks in a FIXED, short-circuiting order (5.4) and yields exactly one bone-graph code per fault: `BONE_NAME_DUPLICATE`, `BONE_PARENT_MISSING`, or `BONE_ORDER_VIOLATION`. A bone set with no root (every bone has a non-null parent) cannot satisfy the ordering invariant (by the 5.1 corollary), so it surfaces as `BONE_ORDER_VIOLATION`; there is no separate no-root code. A resolvable cycle (parents all exist but cannot be topologically ordered, for example `A.parent=B`, `B.parent=A`) is likewise `BONE_ORDER_VIOLATION`. |
| `runtime-core` world pass | RELIES on the invariant in release builds (single forward pass, parent matrix already computed). In debug builds it MAY assert `parentIndex < i`. It does not sort; it trusts the validated input. This is the "internal code trusts typed inputs" rule: the boundary (the format validator) checks, the core trusts. |

### 5.4 Bone-graph check ordering (eliminates entangled codes)

The bones subtree is checked as a unit, short-circuiting at the first fault so a single broken document yields a single bone-graph code:

1. Names unique, else `BONE_NAME_DUPLICATE` (stop the bone-graph checks; parent-by-name resolution is unreliable once names collide).
2. Every non-null `parent` names an existing bone, else `BONE_PARENT_MISSING` (stop).
3. Every non-null parent appears at a strictly lower index than its child, else `BONE_ORDER_VIOLATION` (stop). This single check subsumes both out-of-order parents and unorderable graphs: a cycle or a rootless set fails step 3 because some bone necessarily references a parent at an index not below its own.

Because step 3 subsumes the rootless and cyclic cases, the bones family emits exactly one of three codes for any single fault, which is what makes the WP-F.10 corpus rule (one fault per fixture, expected code present, no UNRELATED-family code present, section 8.4 and WP-F.10) satisfiable for bones without an isolated-fixture caveat.

---

## 6. Mesh vertex encoding (weighted vs unweighted)

The handoff defines one `vertices: number[]` field plus an optional `bones?: number[]`. The PRESENCE of `bones` selects the encoding.

### 6.1 Unweighted

- `bones` is omitted.
- `vertices` is a flat `[x0, y0, x1, y1, ...]` in slot-bone local space.
- Invariant: `vertices.length === 2 * V` where `V = uvs.length / 2` (`MESH_VERTEX_LENGTH`).
- Final position: `slotBoneWorldMatrix * (x, y)`.

### 6.2 Weighted (skinned)

- `bones` is present.
- `vertices` uses the variable-length, per-vertex, concatenated encoding:

```
[ boneCount,
  boneIndex, vx, vy, weight,    // influence 1
  boneIndex, vx, vy, weight,    // influence 2
  ... ]                          // repeated boneCount times
```

Final position of a logical vertex = `sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy))`, where `(vx, vy)` is the vertex expressed in that bone's local (bind) frame. The math itself lives in `runtime-core`; the format only checks that the stream decodes exactly.

### 6.3 Normative clarification of `boneIndex` and the `bones` array

The handoff lists both an inline `boneIndex` and a top-level `bones?: number[]` without stating their relationship. This is fixed here:

- `boneIndex` in the inline stream is a GLOBAL index into `SkeletonDocument.bones` (0-based). It is NOT a local index into the attachment `bones` array.
- The `bones` array, when present, is the de-duplicated, ascending list of all global bone indices referenced by this mesh's vertex stream. Its PRESENCE is the canonical "this mesh is weighted" signal. Its CONTENT is a binding manifest that lets a runtime gather exactly the world matrices it needs before skinning (a pooling/allocation optimization).
- Validator checks (`mesh.ts`), stated non-circularly:
  - The PRESENCE of `bones` is the signal that drives the decode. If `bones` is present, the weighted decode (6.2) must consume EXACTLY `vertices.length` numbers and yield EXACTLY `V` logical vertices; if `bones` is absent, `vertices.length === 2 * V`. A stream that does not consume exactly to its end, or yields a vertex count other than `V`, is `MESH_WEIGHT_DECODE`.
  - Every inline `boneIndex` is in `[0, document.bones.length)` (`MESH_WEIGHT_BONE_RANGE`).
  - The set of inline `boneIndex` values equals `new Set(bones)` exactly: no unused entry in `bones`, no referenced index missing from `bones` (`MESH_WEIGHT_BONES_MANIFEST`).
  - `1 <= boneCount <= MAX_BONE_INFLUENCES` (= 4) per logical vertex (`MESH_WEIGHT_INFLUENCE_CAP`). Runtimes may assume at most 4 influences and size fixed buffers accordingly.
  - Per-logical-vertex weight sum is within `WEIGHT_SUM_EPSILON` (= 1e-4) of 1.0 (`MESH_WEIGHT_SUM`). The validator does not normalize; the editor's weight-paint pipeline normalizes (handoff 8.5) and the exporter writes normalized weights.

### 6.4 Worked example

A quad (4 logical vertices, 2 triangles). UVs and topology are encoding-independent:

```jsonc
"uvs":       [0,1, 1,1, 1,0, 0,0],
"triangles": [0,1,2, 0,2,3],
"hullLength": 4
```

Unweighted form (vertices in slot-bone local space):

```jsonc
"vertices": [-10,-10, 10,-10, 10,10, -10,10]
// length 8 === 2 * V (V = 4). No "bones" field.
```

Weighted form. Vertices v0 and v3 are fully driven by global bone 2; v1 by global bone 3; v2 split 50/50 between bones 2 and 3:

```jsonc
"bones": [2, 3],
"vertices": [
  1, 2, -10,-10, 1.0,             // v0: 1 influence, bone 2, weight 1.0
  1, 3,  10,-10, 1.0,             // v1: 1 influence, bone 3, weight 1.0
  2, 2,  10, 10, 0.5, 3, 10,10, 0.5, // v2: 2 influences, bones 2 and 3, 0.5 each
  1, 2, -10, 10, 1.0              // v3: 1 influence, bone 2, weight 1.0
]
```

Decode cursor walk (proves exact consumption):

| Logical vertex | Read at cursor | Numbers consumed | Cursor after |
|---|---|---|---|
| v0 | `boneCount=1`, then `(2,-10,-10,1.0)` | 1 + 4 = 5 | 5 |
| v1 | `boneCount=1`, then `(3,10,-10,1.0)` | 5 | 10 |
| v2 | `boneCount=2`, then `(2,10,10,0.5)`,`(3,10,10,0.5)` | 1 + 8 = 9 | 19 |
| v3 | `boneCount=1`, then `(2,-10,10,1.0)` | 5 | 24 |

`vertices.length === 24`, cursor ends at 24, and 4 logical vertices were produced. Referenced bone set `{2,3}` equals `new Set([2,3])`. v2 weights `0.5 + 0.5 = 1.0` within epsilon. All checks pass.

---

## 7. JSON Schema generation strategy (decision)

### 7.1 Decision

Zod schemas are the SINGLE SOURCE OF TRUTH. TypeScript types are derived from them via `z.infer`. The JSON Schema artifact (`schema.json`) is GENERATED from the same Zod schemas via `zod-to-json-schema`. We do NOT hand-write `.d.ts` and we do NOT hand-write JSON Schema validated with raw ajv.

```
Zod schemas (src/schema/*.ts)
   ├── z.infer  -> TypeScript types (src/types.ts)        [compile-time contract]
   ├── .safeParse -> runtime validator (validate-on-import) [runtime contract]
   └── zod-to-json-schema -> schema.json                  [portable artifact for Unity/Godot/tooling]
```

`getJsonSchema()` (public barrel) returns the committed `schema.json` (imported as a module), which is the exact artifact the drift gate checks (section 7.4). It is not regenerated at runtime; consumers get the byte-stable committed file.

### 7.2 Justification

| Criterion | Zod-as-source (chosen) | Hand-written `.d.ts` + ajv (rejected) |
|---|---|---|
| Sources of truth | One. Types, runtime validation, and JSON Schema all derive from the Zod definition. | Two or three: the `.d.ts`, the JSON Schema, and the validator can drift. |
| Validate-on-import (LAW 3) | Native. `.safeParse` gives issue paths for free, and `result.data` is already typed as the schema output (no cast). | Requires separately authoring/compiling ajv validators and keeping them in step with the types. |
| Discriminated unions (5 attachments, curve union, weighted/unweighted mesh) | Expressed naturally with `z.discriminatedUnion` and `.superRefine`. | Verbose and error-prone in raw JSON Schema; conditional `if/then` is hard to maintain. |
| Co-location with semantic checks | The semantic layer (`superRefine` and the graph validators) lives in the same language next to the schemas. | Semantic checks are needed regardless and live separately from the schema. |
| Matches house standard | The global standard mandates Zod at boundaries and "Zod-to-OpenAPI, generated, not hand-written". | Contradicts the house standard. |
| Portable artifact for non-TS runtimes | Still produced: `schema.json` is emitted for Unity/Godot tooling, editor tooling, and external validation. | The artifact is the source, so you get it, but at the cost of drift above. |

### 7.3 Trade-offs accepted and mitigated

- Zod adds a runtime dependency to `format` and `.safeParse` is slower than a compiled ajv validator. Mitigations: (1) validation runs once at load, not per frame, so it sits well inside the load-time budget; (2) `runtime-core` imports types only and pays zero (section 1.3); (3) the generated `schema.json` is available for any consumer that wants ajv-speed validation outside the TS path.
- `zod-to-json-schema` cannot express the graph-level semantic checks (referential integrity, ordering, draw-order completeness). That is expected. JSON Schema covers SHAPE; the semantic validator (section 8) covers GRAPH. The contract is shape-plus-graph, never shape alone.

### 7.4 Drift control

`scripts/gen-schema.ts` regenerates `schema.json`. CI runs it and fails if the committed file differs (`git diff --exit-code schema.json`). A schema change that is not regenerated and committed is a red build (WP-F.2). Because the drift gate depends on byte-stable generator output, `zod-to-json-schema` and `@noble/hashes` (and `zod` itself) are pinned to EXACT versions in the lockfile (section 14, item 7); a generator minor bump that reorders keys would otherwise spuriously redden CI.

---

## 8. The runtime validator

### 8.1 Contract

```ts
// Pure, deterministic, no I/O, no mutation. Accepts an already-parsed object.
export function validateDocument(
  input: unknown,
  options?: { verifyHash?: boolean }  // default true
): ValidationReport;

// String entry point for the editor import boundary, which holds the raw file
// bytes. Parses with a duplicate-key-detecting reviver (section 8.6), then runs
// validateDocument. Reviver findings appear as DUPLICATE_RECORD_KEY warnings.
export function validateDocumentJson(
  json: string,
  options?: { verifyHash?: boolean }  // default true
): ValidationReport;

export interface ValidationReport {
  readonly ok: boolean;
  readonly document: SkeletonDocument | null; // non-null only when ok === true
  readonly errors: readonly FormatError[];    // ALL errors, not just the first
  readonly warnings: readonly FormatWarning[];
}

// Throwing wrapper for call sites that prefer it. Throws FormatValidationError
// (carrying the full report) on failure; returns the validated document otherwise.
export function parseDocument(
  input: unknown,
  options?: { verifyHash?: boolean }
): SkeletonDocument;
```

`validateDocument` collects ALL errors (fail loudly with the full picture, not first-error-only) so an artist or tool sees every problem in one pass. It NEVER throws on malformed input; malformed input is data, surfaced as errors. It throws only on a genuine programming bug.

How consumers call it:

- The editor import boundary calls `validateDocumentJson(fileText, { verifyHash: true })`, surfaces `report.warnings` (including `DUPLICATE_RECORD_KEY` and `HASH_ABSENT`) to the user, and on `!report.ok` raises a `FormatValidationError` (or handles the report directly). This is the ONLY path that recomputes and verifies the content hash.
- `runtime-web` calls `validateDocument(parsedObject, { verifyHash: false })` on its load path: it treats `hash` as opaque (section 9.3) and never recomputes SHA-256 on load.

### 8.2 Typed error and warning model

```ts
export type FormatErrorCode =
  | 'SCHEMA_SHAPE'
  | 'UNSUPPORTED_FORMAT_VERSION' | 'MIGRATION_REQUIRED'
  | 'BONE_NAME_DUPLICATE' | 'BONE_PARENT_MISSING' | 'BONE_ORDER_VIOLATION'
  | 'SLOT_NAME_DUPLICATE' | 'SLOT_BONE_MISSING' | 'SLOT_ATTACHMENT_MISSING'
  | 'SKIN_DEFAULT_MISSING' | 'SKIN_SLOT_UNKNOWN'
  | 'ATLAS_REGION_DUPLICATE' | 'ATTACHMENT_REGION_MISSING'
  | 'MESH_UV_LENGTH' | 'MESH_TRIANGLE_LENGTH' | 'MESH_TRIANGLE_INDEX_RANGE' | 'MESH_HULL_RANGE'
  | 'MESH_EDGE_INVALID'
  | 'MESH_VERTEX_LENGTH' | 'MESH_WEIGHT_DECODE' | 'MESH_WEIGHT_BONE_RANGE'
  | 'MESH_WEIGHT_BONES_MANIFEST' | 'MESH_WEIGHT_SUM' | 'MESH_WEIGHT_INFLUENCE_CAP'
  | 'CLIPPING_END_MISSING' | 'CLIPPING_END_ORDER' | 'POLY_VERTEX_LENGTH'
  | 'IK_BONES_ARITY' | 'IK_BONE_MISSING' | 'IK_TARGET_MISSING' | 'IK_CHAIN_DISCONTINUOUS' | 'IK_MIX_RANGE'
  | 'TC_BONE_MISSING' | 'TC_TARGET_MISSING' | 'TC_MIX_RANGE' | 'CONSTRAINT_NAME_DUPLICATE'
  | 'ANIM_BONE_UNKNOWN' | 'ANIM_SLOT_UNKNOWN' | 'ANIM_IK_UNKNOWN' | 'ANIM_TRANSFORM_UNKNOWN'
  | 'ANIM_TIME_RANGE' | 'ANIM_TIME_ORDER' | 'ANIM_DURATION'
  | 'CURVE_BEZIER_X_RANGE' | 'COLOR_RANGE'
  | 'DRAWORDER_INCOMPLETE'
  | 'DEFORM_SKIN_UNKNOWN' | 'DEFORM_SLOT_UNKNOWN' | 'DEFORM_ATTACHMENT_UNKNOWN'
  | 'DEFORM_NOT_MESH' | 'DEFORM_OFFSET_LENGTH'
  | 'EVENT_NAME_DUPLICATE' | 'ANIM_EVENT_UNKNOWN'
  | 'HASH_MISMATCH';

export interface FormatError {
  readonly code: FormatErrorCode;
  readonly path: string;     // JSON Pointer to the offending node, e.g. "/bones/3/parent"
  readonly message: string;  // human readable, no em-dashes or en-dashes
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export type FormatWarningCode =
  | 'HASH_ABSENT'          // hash === "" on a verifyHash:true path (unhashed draft)
  | 'DUPLICATE_RECORD_KEY'; // a Record key was duplicated in the raw JSON text

export interface FormatWarning {
  readonly code: FormatWarningCode;
  readonly path: string;     // JSON Pointer to the relevant node
  readonly message: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export class FormatValidationError extends Error {
  override readonly name = 'FormatValidationError';
  readonly report: ValidationReport; // report.ok === false
  constructor(report: ValidationReport) {
    super(`document failed format validation with ${report.errors.length} error(s)`);
    this.report = report;
  }
}
```

Errors and warnings are typed (discriminated by `code`, never bare strings; house standard). `path` is a JSON Pointer for precise editor surfacing. The validator logs nothing; logging happens once at the boundary that handles the error (the editor import handler). `parseDocument` and the editor import boundary throw `FormatValidationError`, which is part of the public surface (WP-F.9) so the editor can type its `catch`.

Warning producers (each warning has exactly one):

- `HASH_ABSENT`: emitted by the hash layer when `verifyHash` is not `false` and `document.hash === ""`. It is advisory (the document is an unhashed draft; content-addressed caches cannot key on it) and does NOT make the report fail. It cannot fire on `runtime-web` (which passes `verifyHash: false`, skipping the hash layer) and does not fire for production exports (which carry a hash).
- `DUPLICATE_RECORD_KEY`: emitted ONLY on the `validateDocumentJson` path, by the duplicate-key reviver (section 8.6), when the raw JSON text contained the same key twice inside a `Record`-typed collection (`animations`, a skin's `attachments`, or a `deform` map). `JSON.parse` silently keeps the last occurrence, so this is a data-loss advisory; `detail` carries the colliding key. The object-input `validateDocument` cannot detect it (the duplicate is already collapsed before it is called).

### 8.3 Validation layers (run in order, all errors collected)

1. Version gate (`version/migrate.ts` + `version/semver.ts`): read `formatVersion`.
   - Parse it with `parseSemVer`. If it is not a valid `x.y.z`, emit `UNSUPPORTED_FORMAT_VERSION` and stop (cannot trust the rest).
   - If it is strictly NEWER than `CURRENT_FORMAT_VERSION` by full semver comparison (`compareFormatVersion(v, current) > 0`), emit `UNSUPPORTED_FORMAT_VERSION` and stop (this code cannot read a newer document safely).
   - If its MIGRATION KEY is below the current migration key (`migrationKeyOf(v) < migrationKeyOf(current)`; the migration key is MINOR while MAJOR is 0, MAJOR from 1.0 on), route to migration (section 10). If no contiguous chain reaches current, emit `UNSUPPORTED_FORMAT_VERSION` and stop. If a step produces an intermediate that fails its target-version validation, emit `MIGRATION_REQUIRED` (with the failing step in `detail`) and stop. On success, continue the pipeline with the migrated document.
   - Otherwise (same migration key, not newer; for example a PATCH or, post-1.0, a backward-compatible older MINOR within the same MAJOR), continue without migration.
2. Structural layer (`structural.ts`): Zod `.safeParse` against `skeletonDocumentSchema`. Maps every Zod issue to `SCHEMA_SHAPE` (or the specific refinement codes `COLOR_RANGE`, `CURVE_BEZIER_X_RANGE`, `IK_MIX_RANGE`, `TC_MIX_RANGE`). It records the JSON Pointer of every failing node into a `failed` set used by the isolation rule in 8.3.1. On a successful parse it carries `result.data` (already typed as `SkeletonDocument`, zero casts) into the later layers.
3. Semantic graph layer (`semantic.ts`): referential integrity and invariants that Zod cannot express. Full list in 8.4.
4. Mesh layer (`mesh.ts`): the section 6 decode and weight checks, plus uv/triangle/hull/edge integrity, for every mesh attachment in every skin.
5. Animation layer (`animation.ts`): timeline order/range, duration, draw-order completeness, deform offset lengths, event refs, color-frame and frame-mix ranges.
6. Hash layer (`hash/hash.ts`): if `options.verifyHash !== false`, then if `document.hash` is non-empty, recompute and compare (`HASH_MISMATCH`); if `document.hash === ""`, emit the `HASH_ABSENT` warning. If `verifyHash === false`, skip this layer entirely.

#### 8.3.1 Shape-failure isolation (precise, mechanically testable)

Layers 3 to 5 must not crash on data that failed layer 2, but they MUST still run on the parts of the document that parsed cleanly. The rule is mechanical:

- The structural layer records `failed`, the set of JSON Pointers at which a Zod issue occurred.
- Each semantic, mesh, and animation check declares its READ SET: the JSON Pointers of the nodes it dereferences.
- A check is EXECUTED if and only if no member of its read set OVERLAPS `failed`. Two pointers `a` and `b` overlap when `a === b`, or `a` is a strict path-prefix of `b` (`b` starts with `a + "/"`), or `b` is a strict path-prefix of `a`. When a check is skipped under this rule it emits NO error, because the underlying `SCHEMA_SHAPE` already explains the problem at that node.
- Named subtree boundaries: the top-level collections (`/bones`, `/slots`, `/skins`, `/ikConstraints`, `/transformConstraints`, `/events`, `/animations`, `/atlas`) are the coarse independent subtrees. A check whose entire read set lies under one of them is, by the overlap rule, unaffected by a shape failure under a different one. This is what "independent subtrees where safe" means concretely: independence is read-set disjointness, and "safe" is the no-overlap condition.

Worked consequence (this is the WP-F.3 `validate.shape-isolation.test.ts` case): a document with (a) a `SCHEMA_SHAPE` fault at `/atlas/pages/0/regions/0/name` (a number where a string is required) and (b) a semantic-only fault at `/slots/0/bone` (names a missing bone) reports BOTH `SCHEMA_SHAPE` at the atlas path AND `SLOT_BONE_MISSING` at the slot path (the slot check's read set, `/slots/0/bone` plus `/bones`, does not overlap the failed atlas name, so it runs), while the atlas semantic checks that read region names (`ATLAS_REGION_DUPLICATE`, `ATTACHMENT_REGION_MISSING`) are SKIPPED because their read set overlaps the failed `/atlas/pages/0/regions/0/name`. This proves the shape-fails-here / semantic-still-runs-there path that the old prose left untested.

### 8.4 Semantic, mesh, and animation checks (authoritative list)

Each row names a CHECK FAMILY (used by the WP-F.10 corpus rule, section 8.4.1). A single fault may legitimately surface more than one code WITHIN one family; it must not surface a code from another family.

| Family | Check | Code |
|---|---|---|
| BONE | names unique; parent resolves and precedes child; rootless/cyclic sets (section 5.4) | `BONE_NAME_DUPLICATE`, `BONE_PARENT_MISSING`, `BONE_ORDER_VIOLATION` |
| SLOT | names unique; `bone` resolves; setup `attachment` (if non-null) resolves in `default` skin | `SLOT_NAME_DUPLICATE`, `SLOT_BONE_MISSING`, `SLOT_ATTACHMENT_MISSING` |
| SKIN | `default` skin exists; top-level keys are valid slot names | `SKIN_DEFAULT_MISSING`, `SKIN_SLOT_UNKNOWN` |
| ATLAS | region names unique across pages; region/mesh `path` resolves | `ATLAS_REGION_DUPLICATE`, `ATTACHMENT_REGION_MISSING` |
| MESH | uv/triangle/hull/edge integrity; vertex encoding (section 6); clipping/boundingbox polygon length; clipping `end` resolution and setup-order | `MESH_UV_LENGTH`, `MESH_TRIANGLE_LENGTH`, `MESH_TRIANGLE_INDEX_RANGE`, `MESH_HULL_RANGE`, `MESH_EDGE_INVALID`, `MESH_VERTEX_LENGTH`, `MESH_WEIGHT_DECODE`, `MESH_WEIGHT_BONE_RANGE`, `MESH_WEIGHT_BONES_MANIFEST`, `MESH_WEIGHT_SUM`, `MESH_WEIGHT_INFLUENCE_CAP`, `CLIPPING_END_MISSING`, `CLIPPING_END_ORDER`, `POLY_VERTEX_LENGTH` |
| CONSTRAINT | IK arity, bone/target resolution, 2-bone contiguity; transform bone/target resolution; constraint-name uniqueness across both arrays | `IK_BONES_ARITY`, `IK_BONE_MISSING`, `IK_TARGET_MISSING`, `IK_CHAIN_DISCONTINUOUS`, `TC_BONE_MISSING`, `TC_TARGET_MISSING`, `CONSTRAINT_NAME_DUPLICATE` |
| ANIM | bone/slot/ik/transform timeline key resolution; time order and range; duration; draw-order completeness | `ANIM_BONE_UNKNOWN`, `ANIM_SLOT_UNKNOWN`, `ANIM_IK_UNKNOWN`, `ANIM_TRANSFORM_UNKNOWN`, `ANIM_TIME_ORDER`, `ANIM_TIME_RANGE`, `ANIM_DURATION`, `DRAWORDER_INCOMPLETE` |
| DEFORM | skin/slot/attachment resolve; attachment is a mesh; `offsets.length === 2 * V` | `DEFORM_SKIN_UNKNOWN`, `DEFORM_SLOT_UNKNOWN`, `DEFORM_ATTACHMENT_UNKNOWN`, `DEFORM_NOT_MESH`, `DEFORM_OFFSET_LENGTH` |
| EVENT | def names unique; timeline event names resolve | `EVENT_NAME_DUPLICATE`, `ANIM_EVENT_UNKNOWN` |
| HASH | content hash matches (when verified) | `HASH_MISMATCH` |
| SCHEMA | structural shape and range refinements (layer 2) | `SCHEMA_SHAPE`, `COLOR_RANGE`, `CURVE_BEZIER_X_RANGE`, `IK_MIX_RANGE`, `TC_MIX_RANGE` |
| VERSION | version gate and migration | `UNSUPPORTED_FORMAT_VERSION`, `MIGRATION_REQUIRED` |

`IK_MIX_RANGE` and `TC_MIX_RANGE` live in the SCHEMA family because they are Zod refinements (section 4.1) applied both to constraint definitions and to timeline frame values (section 4.8).

#### 8.4.1 Corpus rule the families serve

The golden corpus (WP-F.10) holds one `invalid/<code>.json` fixture per reachable code, each crafted to be invalid by exactly ONE fault. Because some faults legitimately raise more than one code in the SAME family (and only the same family, given the bone-graph short-circuit in 5.4 and the isolation rule in 8.3.1), the corpus test asserts: the expected code is PRESENT, and NO code from a DIFFERENT family is present. It does not demand "exactly one code". This is the relaxed, mechanically checkable contract that replaces the old "produces that code and no other", which a resolvable bone cycle would have violated.

### 8.5 Named constants and version helpers (exported)

```ts
// version/constants.ts
export const MAX_BONE_INFLUENCES = 4;
export const WEIGHT_SUM_EPSILON = 1e-4;
export const CURRENT_FORMAT_VERSION = '0.1.0';
export const SUPPORTED_FORMAT_MAJOR = 0; // MAJOR component of CURRENT_FORMAT_VERSION

// version/semver.ts  (internal; drives the gate in 8.3 step 1)
interface SemVer { readonly major: number; readonly minor: number; readonly patch: number }
function parseSemVer(v: string): SemVer | null;        // null if not a valid x.y.z
function compareFormatVersion(a: SemVer, b: SemVer): -1 | 0 | 1; // full semver order
// The migration key is the digit that increments on a breaking change:
// MINOR while MAJOR is 0 (pre-1.0), MAJOR from 1.0 on.
function migrationKeyOf(v: SemVer): number { return v.major === 0 ? v.minor : v.major; }
```

`SUPPORTED_FORMAT_MAJOR` remains exported for tooling that wants the accepted MAJOR, but the gate logic keys on `migrationKeyOf`, not on MAJOR alone (this is the fix for the pre-1.0 dead-code bug; see section 10).

---

## 9. Content hashing (cache-busting)

### 9.1 Purpose

`SkeletonDocument.hash` lets a runtime key its parsed-rig and decoded-atlas caches by content. Two documents with identical content produce the identical hash; any content change changes the hash, busting the cache.

### 9.2 Algorithm (normative for the TS exporter)

1. Canonicalize (`canonicalize.ts`): produce a deterministic JSON string of the document with the `hash` field removed (it cannot hash itself). Rules:
   - OBJECT keys sorted ascending (including `Record` maps: `animations`, skin `attachments`, `deform`). Deterministic key order is the only source of JSON nondeterminism here.
   - ARRAY order is PRESERVED. Array order is semantic in this format (bones, slots, triangles, vertices, draw order) and must never be reordered.
   - Numbers serialized with standard JS `JSON.stringify` number formatting. `-0` serializes as `0`. `NaN`/`Infinity` cannot occur (rejected by validation before hashing).
2. Hash the canonical UTF-8 bytes with SHA-256 (via `@noble/hashes/sha256`, a tiny dependency-free implementation that runs identically in Node and the browser).
3. Encode as lowercase hex (64 chars). Store in `hash`.

```ts
export function computeContentHash(doc: SkeletonDocument): string;   // ignores existing doc.hash
export function verifyContentHash(doc: SkeletonDocument): boolean;   // doc.hash === computeContentHash(doc)
```

### 9.3 Rules (reconciled with the load path)

- Runtimes (web, Unity, Godot) treat `hash` as OPAQUE. They do not recompute it; they use it as a cache key. Concretely, `runtime-web` calls `validateDocument(doc, { verifyHash: false })`, which skips the hash layer (section 8.3 step 6) entirely, so the runtime load path never runs SHA-256 over canonical JSON. Only the EDITOR import boundary recomputes and verifies (`verifyHash: true`, the default). This keeps cross-runtime parity from depending on byte-identical canonicalization in three languages, and it is consistent with "runtimes do not recompute the hash".
- `formatVersion` IS included in the canonical input (a version bump changes semantics, so it must bust caches).
- The exporter sets `hash` last, after the document is otherwise final. Hand-edited drafts may carry `hash: ""` to skip verification legitimately; on a `verifyHash: true` path an empty hash yields the `HASH_ABSENT` warning rather than an error.

### 9.4 The same canonicalizer serves the slot scene (Phase 4)

The Phase 4 `SlotSceneDocument` hash (section 15.5) does NOT introduce a second canonicalizer. It REUSES the section 9.2 algorithm, parameterized only by WHICH self-referential field is removed before hashing: for the skeleton document that field is `hash`; for the slot document it is the slot document's own `hash`. Everything else is identical (object keys sorted ascending including `Record` maps, array order preserved, standard JS number formatting with `-0` normalized to `0`, SHA-256 over the canonical UTF-8 bytes via `@noble/hashes`, lowercase hex). `computeSlotSceneHash(doc)` is defined as `computeContentHash` applied to the `{ slotSceneFormatVersion, name, scene, refs }` projection. The `snapshot()` canonical projection (command-history section 7.3) and the conformance timeline canonicalization (conformance A.6) both DEFER to this one algorithm. There is exactly one canonicalizer in the system, referenced by all consumers, not four that must agree by assertion.

---

## 10. Versioning and migration policy

### 10.1 What `formatVersion` versions

`formatVersion` is the semver of THE FORMAT, independent of the app version. It changes only when the schema or the meaning of the data changes.

### 10.2 Change classification

| Bump | Definition | Examples |
|---|---|---|
| MAJOR (post-1.0) | Breaking: a previously valid document becomes invalid, a field is removed/renamed, an existing field changes meaning, a constraint tightens, or the same document renders differently. | Renaming `darkColor`; changing weight encoding; making an optional field required; changing solve order. |
| MINOR | Additive and backward compatible: a NEW optional field with a default that reproduces prior behavior, a new enum member old data never used, a new attachment type old documents never reference. | Adding optional `point` attachment metadata; adding a `multiply` blend variant. |
| PATCH | Non-semantic: schema comment fixes, error-message wording, a validator bug fix that does not change which documents are valid. | Reword a `message`; fix a false-positive in a check. |

### 10.3 Pre-1.0 rule (Phases 0 to 4)

While `formatVersion` is `0.x.y`, the format is explicitly unstable. Breaking changes bump MINOR (per the semver 0.x convention) but STILL require a written, tested migration. At first production ship (Phase 5) we cut `1.0.0` and MAJOR governs breaking changes from then on. The discipline (migration plus fixtures plus tests) is identical pre- and post-1.0; only the digit that moves differs, which is exactly why the gate keys on the MIGRATION KEY (the moving digit) rather than on MAJOR.

### 10.4 Migration framework

```ts
// version/migrations/index.ts
export interface MigrationStep {
  readonly fromKey: number;       // source migration key (MINOR pre-1.0, MAJOR post-1.0)
  readonly toKey: number;         // target migration key, always fromKey + 1
  readonly targetVersion: string; // exact formatVersion this step produces
  migrate(doc: unknown): unknown; // pure, forward-only
}
// Production registry. EMPTY for Phase 0: there is no pre-0.1.0 version to migrate from.
export const MIGRATIONS: readonly MigrationStep[] = [];

// version/migrate.ts
export type MigrationResult =
  | { readonly kind: 'unchanged'; readonly doc: unknown }
  | { readonly kind: 'migrated'; readonly doc: unknown; readonly from: string; readonly to: string }
  | { readonly kind: 'unsupported'; readonly version: string }                          // -> UNSUPPORTED_FORMAT_VERSION
  | { readonly kind: 'failed'; readonly step: string; readonly errors: readonly FormatError[] }; // -> MIGRATION_REQUIRED

// Pure core: runs an INJECTED chain. Tests pass an example chain; production passes MIGRATIONS.
export function runMigrations(
  doc: unknown,
  chain: readonly MigrationStep[],
  currentVersion: string
): MigrationResult;

// Public convenience: runMigrations(doc, MIGRATIONS, CURRENT_FORMAT_VERSION).
export function migrateToCurrent(doc: unknown): MigrationResult;
```

- Migrations are forward-only and pure. On import, when the gate (section 8.3 step 1) decides a document is below current by migration key, it runs the contiguous chain from the document's migration key up to current. The chain must be contiguous (`step[i].toKey === step[i+1].fromKey`) with no gaps; a missing link yields `{ kind: 'unsupported' }` and the gate emits `UNSUPPORTED_FORMAT_VERSION`. After EACH step the intermediate is validated against that step's `targetVersion` schema; a step that produces an invalid intermediate yields `{ kind: 'failed', step }` and the gate emits `MIGRATION_REQUIRED` (with the step in `detail`), never a silent best-effort.
- The chain is INJECTED (explicit dependency injection, no service locator): `runMigrations` takes it as a parameter. This lets WP-F.8 prove the framework with a TEST-ONLY example chain that lives in `test/fixtures/migrations/`, while the production `MIGRATIONS` registry ships EMPTY for Phase 0. There is no seeded no-op step: a `from === to` entry would not be a migration, so none exists.
- A version above current, or one with no migration path, yields `UNSUPPORTED_FORMAT_VERSION`.
- Each real migration (when one is added in a later phase) ships with: (a) the transform, (b) a frozen `before` fixture at the source version, (c) the expected `after` fixture at the target version, (d) the tests in 10.5.

### 10.5 Migration tests (mandatory per step, run against the injected chain)

- `migrate(before)` deep-equals `after` for the frozen fixtures.
- `validateDocument(after).ok === true`.
- Chain test: a document at the OLDEST supported version migrates through every step to current and validates. In Phase 0 this exercises the TEST example chain (production `MIGRATIONS` is empty), proving the runner end to end without polluting production.
- Idempotency at the boundary: `migrateToCurrent(currentVersionDoc)` returns `{ kind: 'unchanged' }` with an equal document.

---

## 11. Format change checklist (PR author follows, reviewer verifies)

A PR that touches `packages/format` MUST complete every item. Reviewer rejects on any miss.

1. Necessity. State why the change is needed NOW. Speculative or "might need it" additions are rejected (risk register: resist ad-hoc field additions).
2. Classify the change as MAJOR / MINOR / PATCH (section 10.2) and state the target `formatVersion`.
3. Update the Zod schema in `src/schema/*` (the single source of truth). Do NOT hand-edit types or `schema.json`.
4. Confirm `pnpm -F @marionette/format typecheck` passes; types are re-derived automatically by `z.infer`. Confirm no `any` and no `as` were introduced (the lint rules in item 14 enforce this).
5. Regenerate the JSON Schema: `pnpm -F @marionette/format gen:schema`, commit `schema.json`. CI drift check must pass.
6. Update or add semantic/mesh/animation checks and `FormatErrorCode` (or `FormatWarningCode`) members for any new invariant; assign the new code to a check family (section 8.4); cover with tests.
7. If breaking: write the `MigrationStep`, add `before`/`after` fixtures, register it in `MIGRATIONS`, and add the section 10.5 tests.
8. Update or add unit tests: schema accept and reject cases, semantic accept and reject cases, isolation behavior if a new subtree is involved, and (if applicable) migration round-trip.
9. If the change affects SOLVE behavior (mesh, deform, timeline semantics), regenerate conformance fixtures from `runtime-core` as a deliberate, reviewed act and note it in the PR. Cross-ref: conformance plan. (Engineering invariant: fixtures change only on purpose.)
10. Update content-hash expectations in any committed fixtures whose canonical content changed.
11. Bump `CURRENT_FORMAT_VERSION` (and `SUPPORTED_FORMAT_MAJOR` if MAJOR) and add a `CHANGELOG` entry naming the break and the migration.
12. Update this document's type tables (section 4), code list (section 8.2), and check families (section 8.4) so the contract doc matches the schema.
13. Notify the Unity and Godot runtime owners so they port the reader change. Conformance catches drift, but a heads-up avoids a red cross-runtime build.
14. Confirm CI green across: lint (no `any`, no `as`, boundary rule), schema drift, structural tests, semantic tests, mesh tests, animation tests, hash tests, migration tests, conformance.

---

## 12. Work packages

Each WP is independently verifiable. "Tests that must exist" are Vitest unit tests unless noted. Coverage target on `packages/format`: 90%+ (it is a load-bearing package; the global 80% floor is raised here).

### WP-F.1 Zod schema source of truth and derived types

- Scope: implement every schema in `src/schema/*` matching handoff section 6 exactly, plus the section 4 universal constraints (`.strict()`, `.finite()`, `bones` `.min(1)`, range refinements). Derive `src/types.ts` via `z.infer`. Wire the `.` and `./types` exports.
- Laws: LAW 3 (contract), LAW 4 (our encoding, not Spine), no-`any` and no-`as` invariant.
- Acceptance criteria:
  - Every type in handoff section 6 has a corresponding exported Zod schema and a `z.infer` type with the identical field set and field types.
  - All object schemas are `.strict()`; an unknown key fails parse. `bones` rejects an empty array as `SCHEMA_SHAPE`.
  - `@marionette/format/types` is importable with `import type` and a project-wide check confirms it pulls zero runtime code (the compiled `types.js` is empty or side-effect-free).
  - `tsc --noEmit` is clean. Zero `as` casts exist in the package: validated input flows through `safeParse(...).data`, which is already typed as the schema output, so no narrowing cast is needed anywhere.
  - The hand-authored minimal document uses `hash: ""` (or a committed correct hash) so it does not trip `HASH_MISMATCH` under the default `verifyHash: true`.
- Tests that must exist:
  - `schema.accept.test.ts`: the minimal valid document (1 root bone, 1 slot, 1 region attachment, 1 one-second animation with two rotate keyframes, `hash: ""`) parses.
  - `schema.reject.test.ts`: unknown key rejected; `NaN`/`Infinity` rejected; out-of-range RGBA rejected; bezier `cx` outside `[0,1]` rejected; empty `bones` rejected as `SCHEMA_SHAPE`.
  - `types-erasure.test.ts`: importing from `./types` produces no runtime export (asserts the compiled module surface).
  - `no-casts.test.ts` (or a lint assertion in CI): the package source contains zero `as` casts and zero `any`.

### WP-F.2 JSON Schema generation and drift check

- Scope: `scripts/gen-schema.ts` using `zod-to-json-schema`; commit `schema.json`; add `gen:schema` script; add CI drift gate; implement `getJsonSchema()` returning the committed artifact.
- Laws: LAW 3.
- Acceptance criteria:
  - Running `gen:schema` writes a deterministic `schema.json` (stable across runs on the same input). `zod-to-json-schema` and `zod` are pinned to exact versions so output is byte-stable.
  - CI fails when `schema.json` is stale relative to the schemas (`git diff --exit-code`).
  - The minimal valid document validates against `schema.json` using a standalone ajv check (proves the artifact is usable outside Zod).
  - `getJsonSchema()` returns the exact committed `schema.json` (the same bytes the drift gate checks).
- Tests that must exist:
  - `gen-schema.determinism.test.ts`: two generations are byte-identical.
  - `json-schema.ajv.test.ts`: ajv validates the minimal document against `schema.json` and rejects a shape-broken document.
  - `getjsonschema.test.ts`: `getJsonSchema()` deep-equals the committed `schema.json`.

### WP-F.3 Structural validator, isolation, and typed error model

- Scope: `validate/errors.ts` (the error and warning unions, codes, `FormatValidationError`), `validate/structural.ts` (Zod `safeParse` to `FormatError[]` with JSON Pointer paths, recording `failed`), `validate/isolation.ts` (read-set vs `failed` overlap), `validate/reviver.ts` (duplicate-key reviver), `validate/report.ts`, `validate/index.ts` (`validateDocument`, `validateDocumentJson`, `parseDocument`).
- Laws: LAW 3 (validate on import, fail loudly), house rule (typed errors, no bare strings, log once at boundary).
- Acceptance criteria:
  - `validateDocument` is pure: same input yields a deep-equal report; it performs no I/O and does not mutate input.
  - It returns ALL structural errors in one pass, each with a correct JSON Pointer `path`.
  - `parseDocument` throws `FormatValidationError` carrying the full report; `validateDocument` and `validateDocumentJson` never throw on malformed data.
  - `document` in the report is non-null only when `ok === true`.
  - The isolation rule (8.3.1) holds: a shape failure in one subtree does not suppress a semantic check whose read set is disjoint from it.
- Tests that must exist:
  - `validate.purity.test.ts`: input object is referentially unchanged after validation; two calls deep-equal.
  - `validate.multi-error.test.ts`: a document with three independent shape faults reports three errors with correct paths.
  - `validate.shape-isolation.test.ts`: the section 8.3.1 worked case (shape fault at `/atlas/pages/0/regions/0/name` plus semantic fault at `/slots/0/bone`) reports `SCHEMA_SHAPE` and `SLOT_BONE_MISSING`, and does NOT report `ATLAS_REGION_DUPLICATE` or `ATTACHMENT_REGION_MISSING` (those checks were correctly suppressed).
  - `parse.throws.test.ts`: `parseDocument` throws `FormatValidationError` on malformed input and the thrown error exposes the report.
  - `validatejson.dupkey.test.ts`: `validateDocumentJson` over text with a duplicated `animations` key emits a `DUPLICATE_RECORD_KEY` warning naming the key; `validateDocument` over the already-parsed object does not (and cannot).

### WP-F.4 Semantic graph validator

- Scope: `validate/semantic.ts` implementing the BONE, SLOT, SKIN, ATLAS, and CONSTRAINT families from section 8.4 (mesh and animation are WP-F.5 and WP-F.6): bone-graph checks in the section 5.4 order, slot/skin/atlas references, region/clipping/boundingbox references and setup-order, constraint resolution and name uniqueness.
- Laws: LAW 3, bone-ordering invariant (section 5).
- Acceptance criteria:
  - Each error code in scope is produced by at least one crafted invalid fixture and NOT produced by the valid corpus.
  - Ordering invariant: a child placed before its parent yields `BONE_ORDER_VIOLATION`; a parent that names a nonexistent bone yields `BONE_PARENT_MISSING`; a rootless or cyclic set yields `BONE_ORDER_VIOLATION` (per section 5.4, no separate no-root code).
  - Clipping `end` that precedes the clipping slot in setup order yields `CLIPPING_END_ORDER`.
- Tests that must exist:
  - `semantic.bones.test.ts`: duplicate name, missing parent, child-before-parent, rootless-cycle (`A.parent=B`, `B.parent=A`) each map to the right code, and the cycle case yields exactly the BONE-family code with no cross-family code.
  - `semantic.refs.test.ts`: slot bone missing, setup attachment missing, region path missing, duplicate atlas region, clipping end missing/out-of-order, constraint target missing, duplicate constraint name.
  - `semantic.valid-corpus.test.ts`: the full valid corpus passes with zero semantic errors.

### WP-F.5 Mesh vertex encoding validator

- Scope: `validate/mesh.ts` implementing the MESH family from section 6 and section 4.6: unweighted length, weighted decode with exact consumption, global `boneIndex` range, `bones` manifest equality, influence cap, weight-sum epsilon, uv/triangle/hull integrity, optional `edges` integrity, clipping/boundingbox polygon length and clipping setup-order.
- Laws: LAW 4 (our encoding), 60fps invariant (cap at 4 influences so runtimes size fixed buffers).
- Acceptance criteria:
  - The section 6.4 weighted and unweighted worked examples both validate.
  - A weighted stream that under- or over-consumes `vertices` yields `MESH_WEIGHT_DECODE`.
  - A `bones` manifest with an extra or missing index yields `MESH_WEIGHT_BONES_MANIFEST`.
  - A vertex with 5 influences yields `MESH_WEIGHT_INFLUENCE_CAP`.
  - A vertex whose weights sum to `1.01` yields `MESH_WEIGHT_SUM`; one summing to `1 + 5e-5` passes (within epsilon).
  - A present `edges` array of odd length or with an out-of-range index yields `MESH_EDGE_INVALID`; an absent `edges` is accepted.
- Tests that must exist:
  - `mesh.unweighted.test.ts`: correct length passes; wrong length yields `MESH_VERTEX_LENGTH`.
  - `mesh.weighted.test.ts`: the worked example passes; decode-overflow, decode-underflow, out-of-range bone index, manifest mismatch, influence-cap, and weight-sum cases each map to the right code.
  - `mesh.topology.test.ts`: odd `uvs`, non-multiple-of-3 `triangles`, out-of-range triangle index, `hullLength > V`, and bad `edges` each map to the right code.

### WP-F.6 Animation and timeline validator

- Scope: `validate/animation.ts`: the ANIM, DEFORM, and EVENT families: timeline key resolution (bone/slot/ik/transform), time order (strict for value and draw-order timelines, non-decreasing for events), time-in-duration, duration vs max key, bezier `cx` range and frame mix ranges (if not already caught structurally), draw-order completeness, deform shape (skin/slot/attachment resolve, is-mesh, offset length), event refs and def uniqueness, color-frame range.
- Laws: LAW 3.
- Acceptance criteria:
  - A draw-order key that omits a slot or duplicates one yields `DRAWORDER_INCOMPLETE`.
  - A deform offsets array whose length is not `2 * V` yields `DEFORM_OFFSET_LENGTH`; deform on a non-mesh attachment yields `DEFORM_NOT_MESH`.
  - Two keyframes at the same time on a VALUE timeline yield `ANIM_TIME_ORDER`; two EVENT keyframes at the same time are ACCEPTED; a strictly decreasing event pair yields `ANIM_TIME_ORDER`; a key time beyond `duration` yields `ANIM_TIME_RANGE`; `duration` below the max key time yields `ANIM_DURATION`.
  - An `IkFrame.mix` or `TransformFrame.mix*` outside `[0,1]` yields `IK_MIX_RANGE` / `TC_MIX_RANGE`.
  - An event keyframe naming an undefined event yields `ANIM_EVENT_UNKNOWN`.
- Tests that must exist:
  - `anim.times.test.ts`: value-timeline ascending violation, coincident-events accepted, decreasing-events rejected, out-of-range, duration mismatch.
  - `anim.draworder.test.ts`: incomplete and duplicated permutations rejected; a full permutation accepted.
  - `anim.deform.test.ts`: wrong offset length, non-mesh target, unknown skin/slot/attachment.
  - `anim.framemix.test.ts`: out-of-range `IkFrame.mix` and `TransformFrame.mix*` rejected with the right code.
  - `anim.events.test.ts`: unknown event ref and duplicate event def.

### WP-F.7 Content hashing

- Scope: `hash/canonicalize.ts` and `hash/hash.ts`: canonical JSON (sorted object keys, preserved array order, `hash` excluded), SHA-256 hex via `@noble/hashes`, `computeContentHash`, `verifyContentHash`, validator integration (section 8.3 step 6) including `HASH_ABSENT` warning and the `verifyHash: false` skip.
- Laws: LAW 3.
- Acceptance criteria:
  - `computeContentHash` is stable across runs and independent of input object key insertion order.
  - Reordering object keys does NOT change the hash; reordering the `bones` array DOES change it (array order is semantic).
  - `validateDocument` with a deliberately wrong `hash` yields `HASH_MISMATCH`; with `verifyHash: false` it does not run the hash layer at all (no `HASH_MISMATCH`, no `HASH_ABSENT`).
  - A document with `hash: ""` on a `verifyHash: true` path skips verification, emits `HASH_ABSENT`, and otherwise validates.
- Tests that must exist:
  - `hash.stability.test.ts`: same content (keys shuffled) yields the same hash; bones reordered yields a different hash.
  - `hash.verify.test.ts`: tampered hash yields `HASH_MISMATCH`; `verifyHash:false` runs no hash layer; empty hash emits `HASH_ABSENT`.
  - `hash.roundtrip.test.ts`: `verifyContentHash(doc)` is true after `doc.hash = computeContentHash(doc)`.

### WP-F.8 Versioning and migration framework

- Scope: `version/constants.ts`, `version/semver.ts`, `version/migrate.ts`, `version/migrations/index.ts`. Production `MIGRATIONS` ships EMPTY. `runMigrations` takes the chain as an injected parameter; a TEST-ONLY example chain lives in `test/fixtures/migrations/` and is used to prove the runner. Implement the version gate (section 8.3 step 1) keyed on the MIGRATION KEY.
- Laws: LAW 3, explicit dependency injection (no service locator).
- Acceptance criteria:
  - A document at `CURRENT_FORMAT_VERSION` passes the gate unchanged (`{ kind: 'unchanged' }`).
  - A document strictly newer than current (by full semver) yields `UNSUPPORTED_FORMAT_VERSION`; an unparseable version yields the same.
  - A pre-1.0 document whose MINOR is below current (for example `0.0.x` against a current of `0.1.0`) is routed to migration, NOT silently accepted (this is the explicit guard for the pre-1.0 dead-code bug).
  - With the test example chain injected, the `before` fixture migrates to deep-equal its `after` fixture, and the result validates. Production `MIGRATIONS` stays empty.
- Tests that must exist:
  - `migrate.gate.test.ts`: too-new and unparseable versions rejected; current version is `unchanged`; a `0.0.x` document against current `0.1.0` routes to migration rather than passing untouched.
  - `migrate.chain.test.ts`: the injected example chain migrates the oldest-supported fixture through every step to current and validates.
  - `migrate.idempotent.test.ts`: `migrateToCurrent` of a current document returns `{ kind: 'unchanged' }` with an equal document.
  - `migrate.keying.test.ts`: `migrationKeyOf` returns MINOR while MAJOR is 0 and MAJOR from 1.0 on; `compareFormatVersion` orders versions correctly.

### WP-F.9 Public barrel and package boundaries

- Scope: `src/index.ts` public barrel; `package.json` exports map; lint boundary rule that forbids `runtime-core` from importing the value barrel (`@marionette/format`) and forbids deep imports across the package boundary (consumers import only the barrel or `./types`); README per package (purpose, run, test, env, the dependency-direction rule).
- Laws: house rules (one public barrel, no deep cross-feature imports, explicit boundaries), `runtime-core` dependency-light invariant.
- Acceptance criteria:
  - Public surface is exactly: types (type-only), `validateDocument`, `validateDocumentJson`, `parseDocument`, `FormatValidationError`, `FormatError`, `FormatErrorCode`, `FormatWarning`, `FormatWarningCode`, `ValidationReport`, `computeContentHash`, `verifyContentHash`, `migrateToCurrent`, `MigrationResult`, `CURRENT_FORMAT_VERSION`, `SUPPORTED_FORMAT_MAJOR`, `MAX_BONE_INFLUENCES`, `WEIGHT_SUM_EPSILON`, `getJsonSchema()`.
  - The `no-explicit-any` rule (`@typescript-eslint/no-explicit-any`, error level) and an `as`-cast ban (`@typescript-eslint/consistent-type-assertions` set to disallow assertions, with the sole legitimate exceptions, of which there are none in this package, called out) are configured for `packages/format` and run in CI; "no `any`, no `as`" is a lint gate, not prose.
  - A lint rule (`eslint-plugin-boundaries` or `no-restricted-imports`) fails a build that imports `@marionette/format` (value barrel) from `runtime-core`, and fails any deep import such as `@marionette/format/src/validate/mesh`.
  - README documents the `import type ... from '@marionette/format/types'` rule for `runtime-core`.
- Tests that must exist:
  - `barrel.surface.test.ts`: asserts the exported keys of the barrel match the allowed list exactly (no accidental leak of internal helpers, no missing public type).
  - Lint check (CI, not Vitest): boundary rule and the `any`/`as` rules reject fixture files that violate them.

### WP-F.10 Golden corpus and the Phase 0 fixture

- Scope: `test/fixtures/`: one canonical valid `minimal.json` (handoff section 12 step 2: 1 root bone, 1 slot, 1 region attachment, 1 one-second idle animation with two rotate keyframes, `hash: ""`), one larger valid `rig.json` exercising mesh (weighted and unweighted), IK, transform constraint, deform, draw order, and events (`hash: ""` or a committed correct hash), and an `invalid/` directory with one document per reachable error code, each invalid by exactly ONE fault.
- Laws: LAW 3; supports the conformance invariant (fixtures generated from runtime-core later reuse these rigs).
- Acceptance criteria:
  - `minimal.json` and `rig.json` both validate with zero errors (hand-authored fixtures use `hash: ""` or a committed correct hash so they do not trip `HASH_MISMATCH` under the default `verifyHash: true`).
  - Every reachable `FormatErrorCode` has an `invalid/<code>.json` fixture. The corpus test asserts each fixture's expected code is PRESENT and that NO code from a DIFFERENT check family (section 8.4) is present (the relaxed rule from section 8.4.1; a single fault may raise multiple same-family codes).
  - A corpus test enumerates the `invalid/` directory and is table-driven (no per-file boilerplate).
- Tests that must exist:
  - `corpus.valid.test.ts`: both valid fixtures pass clean.
  - `corpus.invalid.test.ts`: table-driven over `invalid/`, asserts each fixture's expected code present and no cross-family code.
  - `corpus.coverage.test.ts`: asserts every reachable `FormatErrorCode` is represented by at least one `invalid/` fixture (guards against an unexercised check).

---

## 13. Definition of done (Phase 0 exit for `packages/format`)

The ten work packages form one interdependent unit: `validateDocument` runs the full six-layer pipeline (including the version gate from WP-F.8, the mesh layer from WP-F.5, and the animation layer from WP-F.6), the public barrel exposes `getJsonSchema()` (from WP-F.2), and the golden corpus (WP-F.10) asserts coverage of every reachable code, which requires every validator to be present. Delivering a subset leaves the contract unverifiable and the corpus red. Therefore `packages/format` is completed AS A UNIT within Phase 0, which is consistent with handoff section 12 step 2 (create `packages/format` with the section 6 types and a JSON Schema validator, and validate a hand-written minimal document that includes a one-second animation).

`packages/format` satisfies handoff section 12 step 2 when:

1. ALL ten work packages WP-F.1 through WP-F.10 are merged and green.
2. The hand-written minimal document (handoff section 12 step 2, `hash: ""`) validates via `validateDocument` with zero errors.
3. `runtime-core` consumes `@marionette/format/types` with `import type` only and carries zero runtime dependency on the format package; `runtime-web` consumes the value barrel and calls `validateDocument(doc, { verifyHash: false })` on its load path.
4. CI gates pass: lint (no `any`, no `as`, boundary rule), schema drift, and the full Vitest suite at 90%+ coverage on `packages/format`.

Nothing in the format package is deferred to a later phase. The first `formatVersion` bump (the first real `MigrationStep`) happens only when a later phase makes a breaking change; the framework that will carry it ships now, with an empty production registry, proven by the test example chain.

---

## 14. Open decisions for reviewer sign-off

These are decided above but flagged for explicit reviewer approval, since reversing them later is expensive (LAW 3):

1. Zod as the single source of truth, JSON Schema generated (section 7). Reviewer confirms we accept the Zod runtime dependency in `format` given `runtime-core` pays zero.
2. `boneIndex` in weighted meshes is GLOBAL into `SkeletonDocument.bones`, and `bones[]` is the de-duplicated manifest whose PRESENCE flags weighting and drives the decode (section 6.3). Reviewer confirms this normative reading of the handoff's underspecified field.
3. Deform `offsets` are per logical vertex, length `2 * V` (section 4.9). The format validates shape only. The LOCAL-vs-WORLD application space (bind-local before skinning vs world after skinning, which is observable for weighted meshes) is a SOLVE-SEMANTICS decision flagged here for the `runtime-core` solve-plan owner; the format does not adjudicate it and will reference the runtime-core decision plus its conformance fixture once made. Reviewer confirms the format stays shape-only and routes the ambiguity to runtime-core.
4. `MAX_BONE_INFLUENCES = 4` and `WEIGHT_SUM_EPSILON = 1e-4` as format-level invariants (sections 6.3, 8.5). Reviewer confirms 4 is the hard cap runtimes may rely on.
5. Hash is opaque to non-TS runtimes; only the editor import path verifies (`verifyHash: true`), and `runtime-web` passes `verifyHash: false` (section 9.3). Reviewer confirms we do not require byte-identical canonicalization in Unity/Godot and accept that the load path does not verify.
6. The version gate keys on the MIGRATION KEY (MINOR while MAJOR is 0, MAJOR from 1.0 on), not on MAJOR alone, so pre-1.0 breaking changes (which bump MINOR per section 10.3) are actually routed to migration rather than silently accepted. Pre-1.0 breaking changes bump MINOR but still ship a tested migration (sections 8.3, 10.3, 10.4). Reviewer confirms the keying and the migration discipline for Phases 0 to 4.
7. New runtime dependencies for `packages/format` (and therefore transitively for any value-barrel consumer such as `runtime-web` and the editor): `zod`, `zod-to-json-schema` (build/codegen only), and `@noble/hashes` (SHA-256). None is in the load-bearing stack list, so each is surfaced here as a dependency decision. `@noble/hashes` is statically referenced by the hash layer, so it links into `runtime-web` even though `runtime-web` passes `verifyHash: false`; mitigations are that it is tiny and dependency-free, and that the hash layer is the only reference, so it is straightforward to factor hash verification into an editor-only entry point later if bundle pressure demands. `zod-to-json-schema` and `@noble/hashes` are pinned to EXACT versions because the schema drift gate (section 7.4) and the hash fixtures depend on byte-stable output. Reviewer confirms these dependencies and the pinning policy.
8. `bones` is non-empty by structural rule (`.min(1)` to `SCHEMA_SHAPE`) and the `default` skin must exist (`SKIN_DEFAULT_MISSING`). There is NO separate no-root code: a rootless or cyclic bone set is reported as `BONE_ORDER_VIOLATION` (section 5.4), which removes the corpus collision the old `BONE_NO_ROOT` code created. If a "locator-only" or skinless document must ever be representable, `bones.min(1)` and `SKIN_DEFAULT_MISSING` are the two checks to revisit; a locator-only rig still carries at least one root bone today. Reviewer confirms these two hard invariants.
9. The Phase 4 slot scene is a SECOND, independently versioned format owned by this package (section 15): the `SlotSceneDocument` envelope with its own `slotSceneFormatVersion` (decoupled from the skeleton `formatVersion`), the relocation of `SymbolId` and the authoring-config types into `packages/format` (CD-1, also recorded in command-history section 14), and the slot content hash reusing the section 9.2 canonicalizer (section 9.4). Reviewer confirms a second semver line is intended (a slot game references many skeletons, so bumping one format must not force-bump the other) and that this document is the owner of that contract under LAW 3, with the phase-4 plan section 6 referencing it rather than redefining it.

---

## 15. The slot scene contract (Phase 4, the SECOND versioned format)

This section is the SYSTEM OF RECORD for the Phase 4 authored presentation contract. The phase-4 plan (`docs/plan/phase-4-slot-composer.md` section 6) references this section and binds it to work packages; it does not redefine it. The slot scene is a second, independently semver'd format that lives in `packages/format/src/slot/**` and is validated on import exactly like the skeleton document. It contains presentation geometry, timing, and references only; it carries NO outcome, NO RNG, and NO board contents (LAW 1).

### 15.1 Why a second format and a second version

A slot game references many `SkeletonDocument` files (symbols, backgrounds) plus a Phase 3 VFX preset bundle and exactly one `SlotSceneDocument`. The slot scene changes on a different cadence than the skeleton schema, so it carries its OWN `slotSceneFormatVersion` (semver), decoupled from the skeleton `formatVersion`. Bumping one must not force-bump the other. Both are validated on import and both fail loudly (LAW 3). The slot version starts at `0.1.0` and follows the same pre-1.0 rule (section 10.3): breaking changes bump MINOR and ship a tested migration.

### 15.2 Type relocation (CD-1): `SymbolId` and the authoring-config types live here

Handoff 8.10 sketched `SpinResult` and `SlotScene` together in a `packages/math-bridge` comment block. They have OPPOSITE lifecycles, so they are split (CD-1, consumed by command-history section 14):

- `packages/format` owns the AUTHORED side: `SymbolId` (a string brand) and shared slot scalars, `SlotScene` and all its sub-schemas, the `SlotSceneDocument` envelope, and `SceneRefs`. These are command-mutated, undoable, serialized, semver'd document content under LAW 3.
- `packages/math-bridge` owns the OUTCOME side: `SpinResult`, `SpinInput`, `SpinSeed`, `WinLine`, `FeatureEvent`, `CascadeStep`, `MathEngine`, `rngProof`. These are runtime engine output, validated on receipt, NEVER serialized into a document, NEVER authored.

The dependency direction is correct by construction: `math-bridge` may import `format` (so `SpinResult` cells can be typed as `SymbolId`), but `format` never imports `math-bridge`. Placing `SymbolId` in `format` is the only direction-correct choice; placing it in `math-bridge` would force `format` to depend on the outcome package, which is forbidden. This is a deliberate refinement of handoff 8.10, recorded here as the owning document.

### 15.3 Normative shapes

```ts
// packages/format/src/slot

// CD-1: the authored symbol vocabulary brand lives in format, not math-bridge.
export type SymbolId = string & { readonly __brand: 'SymbolId' };

// The scene content the sequencer consumes (the value, not the on-disk envelope).
export interface SlotScene {
  grid: GridConfig;                          // owned by phase-4 WP-4.5
  symbols: Record<SymbolId, SymbolAnimSet>;  // owned by phase-4 WP-4.6
  winSequencer: WinSequenceConfig;           // owned by phase-4 WP-4.8
  featureFlows: FeatureFlowGraph;            // owned by phase-4 WP-4.9
  tumble: TumbleChoreography;                // owned by phase-4 WP-4.10 (conditional track, section 15.6)
}

// The serialized envelope (on disk), validated on import.
export interface SlotSceneDocument {
  slotSceneFormatVersion: string;   // semver of THIS contract; bump on breaking change (section 15.1)
  name: string;
  hash: string;                     // section 15.5: SHA-256 over the canonical envelope EXCLUDING this field
  scene: SlotScene;
  refs: SceneRefs;                  // referenced skeletons + VFX presets, by name + hash
}

export type GridTopology = 'reelStrip' | 'scatterPay' | 'cluster';
export type GravityRule = 'column-down' | 'cluster-down';

export interface GridConfig {
  topology: GridTopology;
  cols: number; rows: number;       // 5x3 reelStrip, 6x5 scatterPay, 7x7 cluster
  cellWidth: number; cellHeight: number; cellGap: number;
  reelStopStaggerMs: number;        // per-column stop delay (timing only), integer ms
  gravity: GravityRule;             // documented forward cascade rule (phase-4 section 5.5.1)
  anticipation: AnticipationConfig; // deterministic, fed by the engine board only (phase-4 section 10.4)
  // LAW 1: there is NO symbol-placement and NO symbol-source field. The board is RNG-driven by
  // the engine at runtime (SpinResult), never authored here.
}

export interface AnticipationConfig {
  triggerSymbols: readonly SymbolId[]; // scatter/trigger ids (the math model's known vocabulary)
  thresholdCount: number;              // start anticipating once this many trigger symbols have landed
  maxAnticipatingCols: number;         // cap on simultaneously anticipating not-yet-stopped columns (>= 1)
}

export interface SymbolAnimSet {
  skeletonRef: string;              // name of a SkeletonDocument in refs.skeletons
  idle: string; land: string; win: string;  // animation names in that skeleton
  anticipation?: string;            // win is reused for anticipation when this is absent
}

export interface SceneRefs {
  skeletons: { name: string; hash: string }[];   // validated against the referenced docs on import
  vfxPresets: { name: string; hash: string }[];   // Phase 3 named presets
}

// WinSequenceConfig, FeatureFlowGraph, TumbleChoreography are specified field-by-field in their
// owning phase-4 work packages (WP-4.8, WP-4.9, WP-4.10) and mirrored as Zod schemas here.
```

`CurveType` (used by the win-counter rollup, referenced by the slot sequencer) is a CLOSED enum owned by `runtime-core/slot` (`'linear' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutCubic'`) and pinned with an integer/fixed-point evaluation (phase-4 section 5.4.2); the slot scene stores the chosen `CurveType` string, the format validates it as a closed enum member, and the evaluation function lives in `runtime-core` so all runtimes share one definition.

### 15.4 Validation (validate on import, fail loudly, typed errors)

`validateSlotScene(input, resolver): Result<SlotSceneDocument, SlotSceneError>` runs Zod shape validation plus the semantic checks below. Every failure is a discriminated `SlotSceneError` carrying a JSON path, never a bare string.

- Shape via Zod: closed (`.strict()`) objects, closed unions, finite numbers, `cols`/`rows` in `[1, 12]`, positive integer durations.
- `grid.cols`/`grid.rows` consistent with `grid.topology` (reelStrip rows in `[2, 6]`, scatterPay cols in `[5, 7]`, cluster is square so `cols === rows`); `grid.gravity` consistent with `topology` (cluster requires `cluster-down`).
- `anticipation.triggerSymbols` non-empty; `thresholdCount >= 1`; `maxAnticipatingCols` in `[1, cols]`.
- Every `SymbolAnimSet.skeletonRef` resolves to a `refs.skeletons[].name`, and that skeleton actually contains the referenced `idle`/`land`/`win`/`anticipation` animation names (`resolver` reads the referenced docs).
- Every VFX preset name used by any win-sequence step or feature-flow node resolves to a `refs.vfxPresets[].name`.
- Every referenced skeleton/preset hash matches the on-disk artifact hash (cache-bust plus tamper detection).
- The top-level `hash` matches the recomputed canonical hash (section 15.5); a mismatch is a typed `hashMismatch`.
- `slotSceneFormatVersion` is routed by the SAME migration-key gate as the skeleton format (section 10): below current keys to migration, above current or no path yields `versionMismatch`.
- Structural LAW 1 check: a field-enumeration test asserts there is NO symbol-placement field anywhere in `SlotSceneDocument`.

A negative-test corpus (one document per reachable `SlotSceneError`, each invalid by exactly one fault) is committed under `packages/format/fixtures/slot-scene/`.

### 15.5 Content hash (reuses the section 9.2 canonicalizer)

`SlotSceneDocument.hash` is computed by `computeSlotSceneHash`, which is `computeContentHash` (section 9.2) applied to the canonical serialization of `{ slotSceneFormatVersion, name, scene, refs }` (the envelope with its own `hash` field removed). There is no second canonicalizer (section 9.4). On import the validator recomputes and compares (`hashMismatch` on failure); on save the serializer computes the hash last, after the rest is final. A round-trip test asserts save-then-load yields a matching hash and that flipping one byte of `scene` changes the hash and is rejected.

### 15.6 Tumble is a CONDITIONAL member

`SlotScene.tumble` (and the cascade-specific boundary fields on the engine side) is gated on the math-engine owner exposing a genuine pre-cascade board and per-step authoritative running total (phase-4 section 5.5 and 5.6). The `TumbleChoreography` schema and the `tumble` member are defined here so the envelope shape is stable, but the cascade authoring path (phase-4 WP-4.10) and its goldens are the conditional follow-on track. For non-cascade games `tumble` carries only timing defaults and is never exercised by a cascade.
