# ADR-0009 (ADR-A2.FORMAT): formatVersion 0.4.0, constraint depth, linked meshes, sequences, timeline granularity, and skin scoping

Status: Accepted (2026-07-08)
Owner: Lane A (Contracts)
Gates: ALL PP-A2 (stage F2) schema, validator, and migration work in `packages/format`. MUST be Accepted
before the schema is touched (Law 3 STOP-and-ADR, pro-parity-execution-plan.md section 3).
Cross-ref: `docs/plan/pro-parity-execution-plan.md` sections 3 (stage F2) and 4 (Lane A, PP-A2);
`docs/plan/cross-cutting/format-contract.md` sections 4.6, 4.7, 4.8, 8.4, 10; `MARIONETTE_HANDOFF.md`
section 6; ADR-0002 (weighted encoding), ADR-0003 (constraint solve semantics), ADR-0004 (Phase 2 additive
template), ADR-0008 (the stage F1 additive template this ADR follows);
`docs/audit/spine-pro-parity-audit.md` section 3.1 (the concept rows F2 closes).

## Context

Stage F2 of the Pro Parity program (`pro-parity-execution-plan.md` section 3) is the second format bump
after Phase 2. The audit section 3.1 records a cluster of presentation capabilities the certified authoring
surface needs and that the current 0.3.0 format cannot express:

1. IK constraint depth: softness, stretch, compress, uniform, and a signed bend direction (the current
   format stores only `mix` and a boolean `bendPositive`).
2. Transform-constraint local and relative variants (the current format is world-space, absolute only,
   per ADR-0003).
3. An explicit ordering across the IK and transform constraint arrays (the current format has only the
   implicit IK-then-transform document order).
4. Linked meshes: a mesh attachment that reuses another mesh's geometry, UVs, and weights.
5. Sequence attachments: frame-sequence playback on region and mesh attachments.
6. Per-component bone timelines and per-component bezier curves (the current format keys translate/scale/
   shear as a joint vec2 with one curve per key), slot color rgb/alpha split tracks, and a keyable dark
   color (two-color tint) plus its timeline (the current `Slot.darkColor` is setup-only, not keyable).
7. Skin-scoped bones and constraints (the current skin is name plus attachments only).

The current 0.3.0 format has none of these. `IkConstraint` is `{ name, bones, target, mix, bendPositive }`;
`TransformConstraint` carries six mix channels and six offsets with no space or relativity flag and no
order; `MeshAttachment` has no parent/skin/timelines link; there is no sequence type; `BoneTimelines` is
`{ rotate?, translate?, scale?, shear? }` with a joint vec2 per channel; `SlotTimelines` is
`{ attachment?, color? }` with one RGBA track; `Skin` is `{ name, attachments }`. Every shape below is
designed from the published CONCEPT of skeletal animation, never from Spine source or Spine serialization
(Law 4). The encoding is ours.

This ADR is a single record for the whole of stage F2 (one MINOR bump, `0.3.0 -> 0.4.0`), mirroring
ADR-0008's one-ADR-per-stage pattern. The implementing commits land one coherent schema group at a time
with the version bump and the single migration last, per plan section 3.

## Decision

### 1. Constraint depth

#### 1.1 IK constraint fields

`IkConstraint` gains four depth fields and replaces `bendPositive` with a signed bend direction:

```
IkConstraint {
  name; bones; target; mix;
  bend: 1 | -1;          // REPLACES bendPositive (see 1.4); the elbow/knee direction as a signed unit
  softness: number(>=0); // world-unit distance from full extension at which the two-bone solve eases in
  stretch: boolean;      // the chain may lengthen to reach a target beyond its reach
  compress: boolean;     // a one-bone (or too-close two-bone) chain may shorten toward the target
  uniform: boolean;      // when stretching, scale both chain bones rather than only the parent
  order?: integer(>=0);  // OPTIONAL global solve order across both constraint arrays (see 1.3)
}
```

- `bend` is a signed unit (`1` or `-1`), not a boolean, because "which of the two mirror IK solutions" is
  inherently a sign, and a signed encoding lets a future timeline key it as a numeric channel without a
  boolean-to-sign adapter. It is modeled as a closed literal union (`1 | -1`); any other value fails
  structurally as `SCHEMA_SHAPE`, so no dedicated code is needed.
- `softness` is a NON-NEGATIVE world-unit distance. Zero (the migrated default) reproduces the current
  hard IK solve. A negative value is `IK_SOFTNESS_RANGE` (a structural range refinement, SCHEMA family,
  mirroring `COLOR_RANGE` and the mix ranges: a bounded scalar carries an informative code rather than a
  generic `SCHEMA_SHAPE`).
- `stretch`, `compress`, `uniform` are booleans; their migrated default is `false`, which reproduces the
  current fixed-length, non-stretching solve.

The format stores these; `runtime-core` (Lane B, PP-B5) implements their effect on the IK solve and
conformance locks it. This ADR carries the data and validates only its shape.

#### 1.2 Transform-constraint local and relative variants

`TransformConstraint` gains two boolean variant flags and the optional order:

```
TransformConstraint { ...(existing six mix channels + six offsets); local: boolean; relative: boolean; order?: integer(>=0) }
```

- `local` selects LOCAL-space read/write instead of the world-space blend of ADR-0003 section 5. Default
  `false` reproduces the current world behavior.
- `relative` applies the constraint as an offset RELATIVE to the constrained bone's current value rather
  than an absolute blend toward the target. Default `false` reproduces the current absolute behavior.
- The four combinations of `local` and `relative` are the standard transform-constraint variants. The
  solve semantics of each are owned by `runtime-core` (an ADR-0003 amendment lands in Lane B, PP-B5) and
  locked by conformance; the format carries the two flags and adjudicates no solve behavior.

The existing six-mix-channel set (`mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY`) is unchanged:
Spine constrains `shearY` but not `shearX`, and this format follows that channel model (ADR-0004). No mix
channel is added.

#### 1.3 Explicit constraint order

Every constraint (IK and transform) gains an OPTIONAL `order: integer(>=0)`. `order` is a single ordering
over the COMBINED set of `ikConstraints` followed by `transformConstraints` (constraint names are already
unique across both arrays, ADR-0004; they share one namespace, so they share one order space).

- When NO constraint carries `order`, the default order is the current one: all IK constraints in array
  order, then all transform constraints in array order (ADR-0003 section 3). The migration does NOT inject
  `order`, so every existing document keeps exactly its current solve order.
- When ANY constraint carries `order`, ALL must (all-or-none), and the set of `order` values must be a
  DENSE, UNIQUE permutation of `[0, N)` where `N` is the total constraint count. A partial assignment, a
  duplicate, a gap, or an out-of-range value is `CONSTRAINT_ORDER_INVALID` (CONSTRAINT family). This keeps
  the ordering unambiguous and total; the runtime sorts by `order` when present and falls back to the
  document order otherwise (Lane B, PP-B5). The format validates the permutation is well-formed; it does
  not run the solve.

`order` is optional (not required with a default) because a dense default assignment would have to invent a
canonical numbering for every existing document, and the absence of `order` already has an unambiguous
meaning (the ADR-0003 default order). This is the one F2 addition whose absence is meaningful, so like
`metadata` in ADR-0008 it stays optional and the migration leaves it out.

#### 1.4 `bendPositive` supersession and lossless migration

`bendPositive: boolean` is REMOVED from `IkConstraint` and from the animation IK frame (`IkFrame`),
superseded by the signed `bend`. This is a BREAKING rename (a field is removed and its data reshaped), so
it rides the version bump plus migration like every other stage. The migration is lossless:
`bend = bendPositive === false ? -1 : 1` (true, and any non-`false` value, maps to `+1`; `false` maps to
`-1`). No `bendPositive` value is lost; the two-valued boolean maps onto the two-valued sign exactly.

### 2. Linked meshes: a new closed attachment kind `linkedmesh`

A linked mesh reuses a parent mesh's geometry (uvs, triangles, hull, vertices, weights) while carrying its
own atlas region, color, and (optionally) its own deform timelines. It is added as a SIXTH member of the
closed attachment discriminated union, `type: 'linkedmesh'`:

```
LinkedMeshAttachment {
  type: 'linkedmesh';
  path: string;        // this linked mesh's OWN atlas region (resolves in the atlas, ATTACHMENT_REGION_MISSING)
  parent: string;      // the parent attachment NAME, resolved on the SAME slot in the target skin
  skin?: string;       // the skin that holds the parent (default: the skin containing this linked mesh)
  timelines: boolean;  // whether this linked mesh shares the parent's deform timelines (true) or has its own (false)
  color; width; height;
}
```

Rationale for a NEW closed kind rather than optional fields on `mesh`: a linked mesh has fundamentally
different data than a standalone mesh: it has NO geometry of its own (no `uvs`, `triangles`, `vertices`,
`hullLength`). Modeling it as a `mesh` with those four required fields made conditionally-absent would force
a `superRefine` that flips half the object's required set on a flag, which is exactly the silent-drift
surface `.strict()` exists to prevent. A closed `linkedmesh` kind states the real shape honestly and keeps
each schema member simple and total. The union stays closed, so an unknown `type` is still `SCHEMA_SHAPE`.

Reference model (first principles): a linked mesh at (skin `S`, slot `L`, name `A`) resolves its parent as
attachment `parent` on the SAME slot `L` in skin `skin ?? S`. Sharing the slot is the natural model, because
geometry (the thing inherited) is authored per slot; a cross-slot link would inherit vertices authored
against a different bone frame. Validation (MESH family, since a linked mesh is a geometry attachment):

- `LINKED_MESH_PARENT_MISSING`: the target skin does not exist, or it defines no attachment `parent` on
  slot `L`.
- `LINKED_MESH_PARENT_INVALID`: the resolved parent is neither a `mesh` nor a `linkedmesh` (a region,
  point, clipping, or boundingbox has no geometry to inherit).
- `LINKED_MESH_CYCLE`: following the parent chain (a linked mesh may point at another linked mesh) revisits
  a node, so the chain never reaches a real `mesh`. The walk is bounded by the attachment count.

Deform interaction: a linked mesh MAY be a deform target; its logical vertex count `V` is resolved by
walking the parent chain to the root `mesh` and reading `uvs.length / 2` there. `DEFORM_NOT_MESH` fires only
for an attachment that is neither a `mesh` nor a `linkedmesh`. WHETHER a linked mesh's own deform is used vs
the parent's (the meaning of `timelines`) is SOLVE semantics owned by `runtime-core`; the format does not
forbid a deform on a linked mesh and adjudicates no `timelines` behavior. Sequences (section 3) are scoped
to `region`/`mesh` only, not `linkedmesh`, matching the audit's "region/mesh attachments" wording.

### 3. Sequence attachments

A `region` or `mesh` attachment gains an OPTIONAL `sequence` describing frame-sequence playback:

```
Sequence { count: integer(>=1); start: integer(>=0); digits: integer(>=0); setupIndex: integer(>=0) }
```

- `count` frames; the region NAME of frame `i` is the attachment `path` with the zero-padded integer
  `start + i` appended to `digits` places (the runtime performs the naming; the format carries the numbers).
- `setupIndex` is the frame shown in setup pose, an index in `[0, count)`. Out of range is
  `SEQUENCE_SETUP_RANGE` (a structural cross-field refinement on the attachment, SCHEMA family). `count`,
  `start`, `digits` are non-negative integers by structure; a violation is `SCHEMA_SHAPE`.

Per-key sequence playback is a new OPTIONAL per-slot timeline channel, `SlotTimelines.sequence`:

```
SequenceKeyframe { time; mode: SequenceMode; index: integer(>=0); delay: number(>=0) }
SequenceMode = 'hold' | 'once' | 'loop' | 'pingpong' | 'onceReverse' | 'loopReverse' | 'pingpongReverse'
```

- `mode` covers the natural playback behaviors: hold on a frame, play once and stop, loop, ping-pong, and
  the three reverse variants ("reverse variants" per the brief). The set is a first-principles enumeration
  of the ways a bounded frame index advances over time; an unknown mode is `SCHEMA_SHAPE`.
- `index` is the starting frame offset at the key; `delay` is seconds per frame (non-negative). There is
  no `curve`: a sequence key is a discrete playback-state change, so key times are STRICT-ascending like
  the draw-order timeline (a discrete change between two coincident keys is undefined). The requirement
  that the keyed slot actually carries a sequence attachment at that time is SOLVE state (the active
  attachment is itself animatable), so the format checks only slot existence (`ANIM_SLOT_UNKNOWN`, already
  applied to slot timelines), shape, order, and range; it adds no new referential code for this timeline.

### 4. Timeline granularity

#### 4.1 Per-component bone timelines (and per-component bezier curves)

`BoneTimelines` gains six OPTIONAL scalar component tracks alongside the existing joint tracks:
`translateX, translateY, scaleX, scaleY, shearX, shearY`. Each is a list of `Keyframe<{ value: number }>`;
each keyframe carries its OWN curve, so per-component easing (per-component bezier curves) is expressed
directly by the split tracks. `rotate` is already a scalar joint track and needs no split.

Precedence decision: joint and split tracks for the SAME channel MUST NOT COEXIST on one bone. A bone
timeline may carry `translate` OR any of `translateX`/`translateY`, never both (and likewise
`scale`/`scaleX`/`scaleY`, `shear`/`shearX`/`shearY`). Coexistence is `TIMELINE_COMPONENT_CONFLICT` (ANIM
family). Forbidding coexistence (rather than defining a precedence) keeps the data unambiguous: the joint
and split tracks are two encodings of the same channel, and allowing both would force the runtime to define
a precedence for contradictory keys. One channel, one encoding.

We deliberately add ONE mechanism for per-component easing (the split tracks), not two: the joint
`translate`/`scale`/`shear` keyframe keeps its single curve applied to both components, and a rigger who
needs independent easing or independent key times per component uses the split tracks, which subsume dual
per-key curves. This avoids a redundant second `curveX`/`curveY` field on the joint keyframe.

#### 4.2 Slot color rgb/alpha split

`SlotTimelines` gains two OPTIONAL split color tracks: `rgb` (`Keyframe<{ rgb: RGB }>`, each channel in
`[0, 1]`) and `alpha` (`Keyframe<{ alpha: number }>`, in `[0, 1]`). Like the bone tracks, the joint `color`
(RGBA) track and the split `rgb`/`alpha` tracks MUST NOT COEXIST on one slot;
coexistence is `TIMELINE_COMPONENT_CONFLICT`. Out-of-range channels are `COLOR_RANGE` (the existing color
refinement, reused for the new `RGB` value and the alpha scalar).

#### 4.3 Keyable dark color (two-color tint)

`SlotTimelines` gains an OPTIONAL `dark` track (`Keyframe<{ color: RGBA }>`) that animates the slot's
two-color dark tint. The setup `Slot.darkColor` (present since Phase 0, optional) is now keyable. A slot
that keys a `dark` timeline MUST define a setup `darkColor` (two-color tint enabled), else
`ANIM_DARK_NO_SETUP` (ANIM family): a document cannot animate a channel the slot does not have. `dark` uses
RGBA for consistency with the existing `Slot.darkColor` field (the alpha channel is inert for two-color
tinting; the runtime ignores it); out-of-range channels are `COLOR_RANGE`.

### 5. Skin-scoped bones and constraints

`Skin` gains two OPTIONAL name lists: `bones?: string[]` and `constraints?: string[]`. They declare the
bones and constraints that are active only while this skin is active (Spine 4.x skin scoping). Each entry
is a NAME reference validated in the SKIN family:

- `SKIN_BONE_UNKNOWN`: a `bones` entry names a bone that does not exist.
- `SKIN_CONSTRAINT_UNKNOWN`: a `constraints` entry names neither an IK nor a transform constraint.

`constraints` is a single list over both constraint arrays because they share one name namespace (ADR-0004,
section 1.3 above). The lists are optional; a skin without scoping simply omits them, so the migration
injects nothing. The runtime activation semantics (which bones/constraints participate under a given active
skin) are owned by `runtime-core`; the format validates only that the referenced names resolve.

### 6. Skeleton metadata

Stage F2 needs no metadata change. The `SkeletonMeta` block (ADR-0008) is untouched.

### 7. New error codes

Ten codes are added to `FORMAT_ERROR_CODES`, appended after the existing set (order within the const array
is not semantic; the frozen-union guard test is updated to match):

| Code | Family | Layer | Fault |
|---|---|---|---|
| `IK_SOFTNESS_RANGE` | SCHEMA | structural refinement | IK `softness` (definition or frame) is negative |
| `CONSTRAINT_ORDER_INVALID` | CONSTRAINT | semantic | constraint `order` is partial, duplicated, gapped, or out of range |
| `LINKED_MESH_PARENT_MISSING` | MESH | semantic | linked-mesh parent skin/slot/name does not resolve |
| `LINKED_MESH_PARENT_INVALID` | MESH | semantic | resolved parent is not a mesh or linked mesh |
| `LINKED_MESH_CYCLE` | MESH | semantic | linked-mesh parent chain has a cycle |
| `SEQUENCE_SETUP_RANGE` | SCHEMA | structural refinement | sequence `setupIndex` is outside `[0, count)` |
| `TIMELINE_COMPONENT_CONFLICT` | ANIM | semantic | a joint track and its split component tracks coexist |
| `ANIM_DARK_NO_SETUP` | ANIM | semantic | a slot dark timeline without a setup `darkColor` |
| `SKIN_BONE_UNKNOWN` | SKIN | semantic | a skin `bones` entry names a missing bone |
| `SKIN_CONSTRAINT_UNKNOWN` | SKIN | semantic | a skin `constraints` entry names a missing constraint |

`IK_SOFTNESS_RANGE` and `SEQUENCE_SETUP_RANGE` are SCHEMA-family refinements (like the mix ranges and
`EVENT_AUDIO_RANGE`) because they are bounded scalar checks Zod expresses. The remaining eight are graph
checks in their natural families. Each code ships with a committed negative fixture named exactly by the
code (format-contract WP-F.10) and a family entry in the corpus family map.

### 8. Classification and version

The `bendPositive -> bend` rename (section 1.4) makes a 0.3.0 IK constraint (and IK frame) no longer satisfy
the new schema, and the newly REQUIRED IK depth fields (`softness`, `stretch`, `compress`, `uniform`) and
transform variant flags (`local`, `relative`) mean a 0.3.0 constraint no longer parses. By format-contract
section 10.2 that is a BREAKING change; pre-1.0 (section 10.3) a breaking change bumps MINOR and ships a
written, tested migration. Therefore `CURRENT_FORMAT_VERSION` moves `0.3.0 -> 0.4.0`; `SUPPORTED_FORMAT_MAJOR`
stays 0; the migration key moves `3 -> 4` so the gate routes a 0.3.x (and, through the existing chain, a
0.2.x and 0.1.x) document through migration.

The required-not-optional choice for the IK depth fields and transform flags follows ADR-0004 and ADR-0008:
it matches a total constraint shape, keeps downstream code (document-core, runtime-core, the exporter) free
of `?? default` fallbacks, and a one-step migration makes old documents loadable at zero authoring cost.
`order` (section 1.3), the sequence blocks, the per-component and split-color and dark timelines, the
linked-mesh kind, and the skin scoping lists are all OPTIONAL or new-and-unreferenced-by-old-documents, so
the migration injects nothing for them.

### 9. Migration 0.3.x to 0.4.0

Register the step `{ fromKey: 3, toKey: 4, targetVersion: '0.4.0' }`:

```
migrate(doc):
  for each ikConstraint c:
    replace c.bendPositive with c.bend = (c.bend is a number ? c.bend : (c.bendPositive === false ? -1 : 1));
    inject c.softness = (number ? keep : 0), c.stretch/compress/uniform = (boolean ? keep : false);
    preserve c.order if present;
  for each transformConstraint c:
    inject c.local/relative = (boolean ? keep : false); preserve c.order if present;
  for each animation, for each ik timeline, for each frame f:
    replace f.value.bendPositive with f.value.bend = (number ? keep : (f.value.bendPositive === false ? -1 : 1));
    (softness/stretch/compress on frames are optional and left as-is)
  set formatVersion = '0.4.0';
  recompute hash over the new canonical content IFF the source hash was non-empty
  (a draft with hash '' stays a draft; hash '' is a HASH_ABSENT warning, not an error).
```

The transform (like ADR-0004 and ADR-0008) is pure, forward-only, and defensive: it reads existing values
when present (so a mislabeled-but-already-0.4.0-shaped document migrates idempotently) and supplies the
migrated default otherwise. The hash MUST be recomputed because the canonical content includes the reshaped
constraints and the injected fields. `runMigrations` already validates only the fully migrated result
against the current schema (ADR-0008 section 7), so a 0.1.x document walks the full four-step chain and
only the 0.4.0 result is validated.

### 10. Process (format-contract section 11 checklist)

This ADR covers items 1 to 2 (necessity, classification). The implementing commits complete items 3 to 14:
Zod schemas in `src/schema/*`, the ten new codes assigned to families with tests, the semantic and
structural validators, the migration plus its tests, the golden corpus (an F2 positive completeness fixture
plus one negative fixture per new code, named by the code), the `CURRENT_FORMAT_VERSION` bump, the CHANGELOG
and README updates, and the frozen-union and barrel-surface guard tests kept in sync. Conformance fixtures
and the solve are Lane B (PP-B5), landed after this stage merges. `format-contract.md` (outside Lane A's
code map) needs a follow-up reconciliation edit for its section 4 tables and section 8.2 code list; this
ADR is the authority for the implemented shape in the interim.

## Consequences

- `packages/format` receives an additive-plus-one-rename diff: the constraint depth fields, the transform
  variant flags, the constraint order, the `linkedmesh` kind, the sequence blocks and timeline, the
  per-component and split-color and dark timelines, the skin scoping lists, their validators, and the 0.3.x
  to 0.4.0 migration. The only field REMOVED is `bendPositive`, superseded losslessly by `bend`; every
  other change is purely additive, so Law 3 holds through the version bump plus migration mechanism.
  `assert-format-version-stable.mjs` sees `0.3.0 -> 0.4.0` and requires THIS ADR (which references `0.4.0`)
  to pass, which is the intended gate.
- Blast radius (recorded, not fixed here; the orchestrator sequences the downstream lanes): every package
  that CONSTRUCTS an `IkConstraint`, `TransformConstraint`, or an animation IK frame literal (runtime-core,
  conformance, document-core, mcp-server, runtime-web, editor) must replace `bendPositive` with `bend` and
  supply the new required IK depth fields and transform variant flags. Documents on disk load unchanged via
  the migration. New optional surfaces (linked meshes, sequences, split/component/dark timelines, constraint
  order, skin scoping) are opt-in and break no existing constructor.
- Lane B (PP-B5) owns the solve for every new capability: IK softness/stretch/compress/uniform and signed
  bend; transform local/relative variants; ordered constraint solving honoring `order` with the ADR-0003
  default when omitted; per-component and split-color and dark timeline application; linked-mesh and
  sequence sampling. This ADR deliberately leaves all of that to `runtime-core` and conformance and scopes
  the format to shape and reference validity.

## Alternatives considered

- `bendPositive` kept and a separate `bendDirection` added. Rejected: two fields encoding one concept
  invite contradiction (`bendPositive: true` with `bendDirection: -1`), and the boolean cannot express the
  signed channel a future timeline keys. A clean supersession with a lossless migration is simpler and
  matches how the format grows (one encoding per concept).
- Linked meshes as optional `parent`/`skin`/`timelines` fields on `mesh` with geometry made
  conditionally-required. Rejected: it flips half the object's required set on a flag, defeating the closed
  `.strict()` drift guard. A dedicated closed `linkedmesh` kind is the honest shape.
- Defining a precedence for coexisting joint and split component tracks instead of forbidding it. Rejected:
  precedence is a solve decision, and two contradictory encodings of one channel is exactly the ambiguity
  the format should reject loudly (`TIMELINE_COMPONENT_CONFLICT`), not paper over.
- A required, densely-defaulted constraint `order` on every constraint. Rejected: it would force the
  migration to invent a canonical numbering for every existing document, and the ABSENCE of `order` already
  has an unambiguous meaning (the ADR-0003 default). Optional-with-a-meaningful-absence matches `metadata`.
- Generic `SCHEMA_SHAPE` for IK softness and sequence setup range instead of dedicated codes. Rejected: the
  format gives bounded-scalar faults their own informative codes (the color and mix ranges,
  `EVENT_AUDIO_RANGE`); these are the same kind of fault and deserve the same treatment (errors carry
  information).
