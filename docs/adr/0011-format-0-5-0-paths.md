# ADR-0011 (ADR-A3.FORMAT): formatVersion 0.5.0, path attachments and path constraints

Status: Accepted (2026-07-09)
Owner: Lane A (Contracts)
Gates: ALL PP-A3 (stage F3) schema, validator, and migration work in `packages/format`. MUST be Accepted
before the schema is touched (Law 3 STOP-and-ADR, pro-parity-execution-plan.md section 3).
Cross-ref: `docs/plan/pro-parity-execution-plan.md` sections 3 (stage F3) and 4 (Lane A, PP-A3);
`docs/plan/cross-cutting/format-contract.md` sections 4.6, 4.7, 4.8, 6, 8.4, 10; `MARIONETTE_HANDOFF.md`
section 6; ADR-0002 (weighted-vertex encoding, reused here), ADR-0003 (constraint solve semantics),
ADR-0008 and ADR-0009 (the stage-ADR precedents this ADR follows); the PP-B6 path-solve ADR (Lane B) owns
the runtime evaluation. `docs/audit/spine-pro-parity-audit.md` section 3.1 (the concept rows F3 closes).

## Context

Stage F3 of the Pro Parity program (`pro-parity-execution-plan.md` section 3) is the third format bump.
The audit section 3.1 records two presentation capabilities the certified authoring surface needs and that
the current 0.4.0 format cannot express:

1. A PATH attachment: a smooth spline through a slot, used as a rail that other bones follow (a conveyor,
   a tentacle spine, a motion guide, a text-on-a-curve baseline).
2. A PATH constraint: a constraint that positions and orients a list of bones ALONG a target slot's path
   attachment, with configurable position, spacing, and rotation behavior and a per-channel mix.

The current 0.4.0 format has neither. The attachment union has six kinds (region, mesh, linkedmesh,
clipping, point, boundingbox); the document has `ikConstraints` and `transformConstraints` only; an
animation has `bones/slots/ik/transform/deform/drawOrder/events` timelines. Every shape below is designed
from the published GEOMETRY of a piecewise cubic Bezier spline and the concept of distributing bones along
an arc, never from Spine source or Spine serialization (Law 4). The encoding is ours.

This ADR is a single record for the whole of stage F3 (one MINOR bump, `0.4.0 -> 0.5.0`), mirroring the
ADR-0008 and ADR-0009 one-ADR-per-stage pattern. The implementing commits land one coherent group at a time
(schemas; validators plus fixtures; the migration with the version bump last), per plan section 3.

## Geometry (the source of every field, Law 4)

A path attachment is a piecewise cubic Bezier spline. A single cubic Bezier segment ("curve") is defined by
four control points: a start anchor, two handle points, and an end anchor. Consecutive curves SHARE their
touching anchor, so a spline is stored as a flat list of control points where two handles sit between each
pair of anchors:

```
open  spline of C curves:  a0 h h a1 h h a2 ... a(C-1) h h aC      -> V = 3C + 1 control points
closed spline of C curves: a0 h h a1 h h a2 ... a(C-1) h h         -> V = 3C     control points
                           (the final curve's end anchor wraps to a0)
```

Every field of the path attachment and constraint is justified below from this geometry.

## Decision

### 1. Path attachment: a seventh closed attachment kind `path`

Add a seventh member to the closed attachment discriminated union, `type: 'path'`:

```
PathAttachment {
  type: 'path';
  closed: boolean;         // the spline's last curve wraps to the first anchor (a loop) vs an open arc
  constantSpeed: boolean;  // runtimes reparametrize position by arc length using `lengths` (see 1.1)
  lengths: number[];       // cumulative arc length to the END of each curve; lengths.length === curveCount
  vertices: number[];      // control points, weighted or unweighted (the ADR-0002 codec, see 1.2)
  bones?: number[];        // present => weighted; the ascending de-duplicated referenced-bone manifest
}
```

Every field is justified from the geometry:

- **`closed`** selects whether the final curve returns to the first anchor. It changes the control-point
  count that a given curve count implies (section above), so it is load-bearing for the count check (1.3),
  not cosmetic.
- **`constantSpeed`** is the parametrization flag. A cubic Bezier's natural parameter `t in [0,1]` does NOT
  advance at uniform arc-length speed (the curve bunches near high-curvature regions). When
  `constantSpeed` is true, a runtime maps a position to a point by arc length (uniform speed) using the
  `lengths` table; when false it uses the naive per-curve `t`. The format carries the flag and the table;
  the runtime (Lane B, PP-B6) performs the reparametrization and conformance locks it.
- **`lengths`** is the authoring-time arc-length table: `lengths[i]` is the CUMULATIVE arc length from the
  path start to the END of curve `i`, so it is non-decreasing and `lengths[curveCount-1]` is the total path
  length. It is stored (not recomputed at load) because arc length of a cubic Bezier has no closed form
  and requires numeric integration; committing the table lets every runtime share one authored value
  rather than each integrating (and risking cross-runtime drift). The exact VALUES are solve data the
  format cannot cheaply verify (that is Lane B's oracle); the format validates the table's SHAPE: its
  length equals the derived curve count, its entries are finite and non-negative, and it is non-decreasing
  (a cumulative table must be monotonic). `lengths` is REQUIRED, not optional-when-`constantSpeed`-is-false:
  the arc-length table is intrinsic authoring data the editor always computes, and a total shape keeps
  downstream code free of `?? recompute` branches. A runtime that ignores it under `constantSpeed: false`
  simply does not read it.

No atlas `path`, `width`, `height`, or `color`: a path produces NO pixels. It is pure geometry, like
`boundingbox` (which the format also gives no color). Its editor-display tint is editor chrome, not
document data. This is the same first-principles call as `boundingbox` and keeps the runtime contract
minimal; the small inconsistency with `clipping` (which carries an editor color for historical reasons) is
resolved here in favor of the leaner shape for the newer kind.

Deform is deliberately OUT OF SCOPE for paths this stage: `deform` remains mesh-only (`DEFORM_NOT_MESH`
already fires for any non-mesh attachment, so a path is correctly rejected as a deform target). Path deform
timelines, if ever needed, are a later additive stage.

#### 1.2 Vertex encoding (reuse of the ADR-0002 weighted-vertex codec)

A path's control points are stored with the SAME encoding as mesh vertices (the brief's explicit
requirement): unweighted is a flat `[x0,y0,x1,y1,...]`, and weighted uses the ADR-0002 self-delimiting
per-vertex stream (`boneCount, (boneIndex, vx, vy, weight) x boneCount` per logical vertex) with a
top-level `bones` manifest. Reusing the codec is correct because a control point deforms exactly like a
mesh vertex (bones move it); nothing about "it is a path point rather than a mesh point" changes how a
weighted position is computed. The vertex-STREAM faults therefore reuse the existing shared codes
(`MESH_VERTEX_LENGTH`, `MESH_WEIGHT_DECODE`, `MESH_WEIGHT_BONE_RANGE`, `MESH_WEIGHT_BONES_MANIFEST`,
`MESH_WEIGHT_SUM`, `MESH_WEIGHT_INFLUENCE_CAP`): they describe the shared codec, not mesh topology, so a
new near-duplicate `PATH_WEIGHT_*` set would only add noise. The shared walk is factored into
`validate/vertex-stream.ts` and consumed by both the mesh validator and the path validator (a reuse
extraction, not a behavior change; the mesh validator's codes and messages are unchanged).

The logical control-point count `V` is DERIVED from the stream (unweighted: `vertices.length / 2`;
weighted: the decoded logical-vertex count). A path has no `uvs`, so unlike a mesh there is no independent
`V` to cross-check; `V` IS the decoded count.

#### 1.3 Path-specific geometry validation (a new PATH check family)

Beyond the shared vertex-stream checks, a path carries three checks Zod cannot express, in a new PATH
check family:

- `PATH_VERTEX_COUNT`: the control-point count `V` is not valid for a cubic spline of the declared
  openness. Closed requires `V >= 3` and `V % 3 == 0` (`curveCount = V / 3`); open requires `V >= 4` and
  `(V - 1) % 3 == 0` (`curveCount = (V - 1) / 3`). A count that does not fit either the anchors-and-handles
  layout (section geometry) is rejected here. When it fires, `curveCount` is undefined, so the lengths
  checks are skipped (single fault, single code).
- `PATH_LENGTHS_COUNT`: `lengths.length != curveCount`. One cumulative arc length per curve.
- `PATH_LENGTHS_ORDER`: the `lengths` entries are not a non-decreasing sequence of non-negative numbers.
  A cumulative table must start at or above zero and never decrease.

### 2. Path constraint

Add `SkeletonDocument.pathConstraints: PathConstraint[]`, a REQUIRED array (empty when a rig has none),
mirroring `ikConstraints`/`transformConstraints`:

```
PathConstraint {
  name: string;
  target: string;         // a SLOT name whose active attachment is a path (not a bone; a path lives on a slot)
  bones: string[];        // the bones distributed along the path (non-empty)
  positionMode: 'fixed' | 'percent';
  spacingMode: 'length' | 'fixed' | 'percent' | 'proportional';
  rotateMode: 'tangent' | 'chain' | 'chainScale';
  position: number;       // base position along the path (arc-length units if fixed; a [0,1] fraction if percent)
  spacing: number;        // base spacing between consecutive bones (meaning per spacingMode)
  offsetRotation: number; // degrees added to each constrained bone's resulting rotation
  mixRotate: number;      // [0,1]
  mixX: number;           // [0,1]
  mixY: number;           // [0,1]
  order?: integer(>=0);   // OPTIONAL global solve order across ALL THREE constraint arrays (see 2.3)
}
```

- **`target` is a SLOT, not a bone.** A path is an attachment, and an attachment lives on a slot, so the
  constraint names the slot that carries the path. This is the one structural difference from IK/transform
  (which target bones) and follows directly from where paths live.
- **`positionMode`** selects how `position` is read: `fixed` treats it as an absolute arc-length distance
  from the path start; `percent` treats it as a fraction of total length. Two modes because a position is
  naturally either absolute or relative to the whole; nothing else is geometrically distinct.
- **`spacingMode`** is the justified four-member set for distributing N bones along a 1D arc:
  - `length`: each gap equals the constrained bone's own `length` (bones tile the path at their natural
    sizes; the default for a chain of like-length bones).
  - `fixed`: each gap equals the constant `spacing` in arc-length units (uniform, size-independent tiling).
  - `percent`: each gap equals `spacing` as a fraction of total path length (resolution-independent tiling
    that rescales with the path).
  - `proportional`: gaps are the bones' lengths scaled so the chain exactly spans `spacing` of the path
    (the chain stretches or compresses uniformly to fit). These are the four geometrically distinct ways to
    turn a bone list plus a scalar into a set of positions on an arc; no fifth is meaningful.
- **`rotateMode`** is the justified three-member set for orienting each bone once positioned:
  - `tangent`: align each bone to the path's tangent at its position (the bone points "downstream").
  - `chain`: rotate each bone to point at the NEXT constrained bone's position (a chain following the
    rail, decoupled from the local tangent; used when the bones themselves form the visible chain).
  - `chainScale`: `chain` plus a per-bone scale so the chain's segment lengths are preserved when the path
    stretches the spacing (prevents a following chain from visibly shrinking under `fixed`/`percent`
    spacing). These are the tangent-follow, point-at-next, and point-at-next-with-length-preservation
    behaviors; a fourth adds nothing geometric.
- **`position`, `spacing`, `offsetRotation`** are unbounded finite numbers (an arc position may exceed the
  path and wrap, spacing may be negative to reverse direction, rotation is in degrees). The format does not
  range-clamp them; wrap/clamp is solve behavior (Lane B).
- **`mixRotate/mixX/mixY`** are the three blend factors in `[0, 1]` (`PATH_MIX_RANGE`, a structural
  refinement in the SCHEMA family, exactly like `IK_MIX_RANGE`/`TC_MIX_RANGE`). Three channels because a
  path constraint writes a bone's rotation and its x/y translation but not its scale or shear (scale is
  handled by `chainScale`'s mode, not a mix channel; shear is untouched), following the same channel-model
  discipline as ADR-0004 (only the channels the constraint actually writes get a mix).

#### 2.1 The bones list: non-empty and resolvable, no parent-chain requirement

`bones` must be non-empty (`PATH_BONES_EMPTY`, a structural refinement in the CONSTRAINT family, mirroring
`IK_BONES_ARITY`) and every entry must resolve to an existing bone (`PATH_BONE_MISSING`, semantic,
CONSTRAINT family). Unlike an IK chain, the path bones do NOT need to form a parent-then-child chain: each
bone independently SAMPLES a position on the shared arc (that is the whole point of a path constraint), so
there is no geometric continuity requirement between them and the format imposes none. The list order is
the along-path order; that is authoring data, not a graph invariant. This is the deliberate answer to the
brief's "chain rules": the rule reduces to non-empty and resolvable, justified from the sampling geometry.

#### 2.2 Target references a path (checked where statically decidable)

`target` must name an existing SLOT (`PATH_TARGET_MISSING`, CONSTRAINT family). The stronger check "the
target slot's active attachment is a path" is only STATICALLY decidable for the setup pose: when the target
slot's setup `attachment` is non-null and resolves in the `default` skin, that attachment must be a `path`
(`PATH_TARGET_NOT_PATH`, CONSTRAINT family). When the setup attachment is null, or resolves only in a
non-default skin, the active attachment is animatable/skin-dependent and the format cannot decide it; the
check is skipped and the requirement becomes a runtime concern (Lane B). This mirrors exactly how
`clipping.end` is validated against setup draw order only (format-contract section 4.6).

#### 2.3 The shared constraint order now spans three arrays

The optional `order` (ADR-0009 section 1.3) is a single dense-unique permutation of `[0, N)` over the
COMBINED constraint set, which now spans `ikConstraints` then `transformConstraints` then
`pathConstraints` (constraint names are unique across ALL THREE arrays, one namespace, so one order space).
All-or-none and the dense-permutation rule are unchanged (`CONSTRAINT_ORDER_INVALID`); the order validator
is extended to enumerate the third array. Omitted everywhere means the default order: all IK, then all
transform, then all path, each in array order (the runtime solves IK before transform before path by
default; Lane B owns that default and the sort).

Constraint-name uniqueness (`CONSTRAINT_NAME_DUPLICATE`) and skin-scoped `constraints` resolution
(`SKIN_CONSTRAINT_UNKNOWN`, ADR-0009 section 5) are likewise extended to include path constraints in the
combined name set.

### 3. Path-constraint timelines

Add `Animation.path: Record<constraintName, Keyframe<PathFrame>[]>`, a REQUIRED record (empty when an
animation keys none), mirroring `ik`/`transform`:

```
PathFrame {              // a PARTIAL record; a frame may key any subset of channels
  position?: number;
  spacing?: number;
  mixRotate?: number;    // [0,1]
  mixX?: number;         // [0,1]
  mixY?: number;         // [0,1]
}
```

- The constraint `name` a `path` timeline keys must reference an existing PATH constraint
  (`ANIM_PATH_UNKNOWN`, ANIM family, mirroring `ANIM_IK_UNKNOWN`/`ANIM_TRANSFORM_UNKNOWN`).
- Present `mix*` channels are range-checked to `[0, 1]` (`PATH_MIX_RANGE`, the same refinement as the
  constraint definition). `position`/`spacing` are unbounded finite. Frames are strict-ascending
  interpolated value timelines (format-contract section 4.8), range and order checked like the other
  constraint timelines. The MEANING of an absent channel during a frame is solve semantics owned by
  `runtime-core`; the format assigns none.

### 4. New error codes

Nine codes are added to `FORMAT_ERROR_CODES`, appended after the F2 set (array order is not semantic; the
frozen-union guard test is updated to match). The path vertex-STREAM reuses the shared `MESH_*` codec codes
(section 1.2); no new codes are minted for it.

| Code | Family | Layer | Fault |
|---|---|---|---|
| `PATH_VERTEX_COUNT` | PATH | semantic | control-point count invalid for a closed/open cubic spline |
| `PATH_LENGTHS_COUNT` | PATH | semantic | `lengths.length` != curve count |
| `PATH_LENGTHS_ORDER` | PATH | semantic | `lengths` not a non-negative non-decreasing cumulative table |
| `PATH_TARGET_MISSING` | CONSTRAINT | semantic | path-constraint target slot does not exist |
| `PATH_TARGET_NOT_PATH` | CONSTRAINT | semantic | target slot's setup attachment is not a path |
| `PATH_BONES_EMPTY` | CONSTRAINT | structural refinement | path-constraint bone list is empty |
| `PATH_BONE_MISSING` | CONSTRAINT | semantic | a path-constraint bone does not resolve |
| `PATH_MIX_RANGE` | SCHEMA | structural refinement | a path mix channel (definition or frame) is outside `[0,1]` |
| `ANIM_PATH_UNKNOWN` | ANIM | semantic | a path timeline references a missing path constraint |

`PATH_MIX_RANGE` is a SCHEMA-family refinement (like the other mix ranges and `IK_SOFTNESS_RANGE`).
`PATH_BONES_EMPTY` is a structural custom refinement assigned to the CONSTRAINT family (like
`IK_BONES_ARITY`): the layer is structural, the CHECK family is CONSTRAINT. Each code ships with a committed
negative fixture named exactly by the code (format-contract WP-F.10) and a family entry in the corpus family
map.

### 5. Classification and version

Adding the REQUIRED root `pathConstraints` array and the REQUIRED per-animation `path` record means a 0.4.0
document (which has neither) no longer satisfies the new schema. By format-contract section 10.2 that is a
BREAKING change; pre-1.0 (section 10.3) a breaking change bumps MINOR and ships a written, tested migration.
Therefore `CURRENT_FORMAT_VERSION` moves `0.4.0 -> 0.5.0`; `SUPPORTED_FORMAT_MAJOR` stays 0; the migration
key moves `4 -> 5` so the gate routes a 0.4.x (and, through the existing chain, every older document)
through migration.

The required-not-optional choice for `pathConstraints` and `path` follows ADR-0008/ADR-0009: it matches a
total document/animation shape, keeps downstream code free of `?? []`/`?? {}` fallbacks, and a one-step
migration makes old documents loadable at zero authoring cost. The path ATTACHMENT kind, the path
CONSTRAINT fields, and the `order` addition to the path array are all new-and-unreferenced by a 0.4.0
document, so the migration injects nothing for them.

### 6. Migration 0.4.x to 0.5.0

Register the step `{ fromKey: 4, toKey: 5, targetVersion: '0.5.0' }`:

```
migrate(doc):
  inject pathConstraints: [] on the root (preserve an existing array if already present);
  for each animation, inject path: {} (preserve an existing record if already present);
  set formatVersion = '0.5.0';
  recompute hash over the new canonical content IFF the source hash was non-empty
  (a draft with hash '' stays a draft; hash '' is a HASH_ABSENT warning, not an error).
```

The transform is pure, forward-only, and defensive: it reads an existing value when present (so a
mislabeled-but-already-0.5.0-shaped document migrates idempotently) and supplies the empty default
otherwise. The hash MUST be recomputed because the canonical content includes `formatVersion`, the new root
array, and the new per-animation record. `runMigrations` already validates only the fully migrated result
against the current schema (ADR-0008 section 7), so a 0.1.x document walks the full five-step chain and only
the 0.5.0 result is validated.

### 7. Process (format-contract section 11 checklist)

This ADR covers items 1 to 2 (necessity, classification). The implementing commits complete items 3 to 14:
the Zod schemas (`schema/attachment.ts` path kind, `schema/constraint.ts` path constraint,
`schema/animation.ts` path timeline, `schema/document.ts` root array), the nine new codes assigned to
families with tests, the semantic and structural validators (`validate/paths.ts`, the extended
`validate/constraints.ts` order/name checks, `validate/semantic.ts` skin/anim extensions, the extracted
`validate/vertex-stream.ts`), the migration plus its tests, the golden corpus (an F3 positive completeness
fixture `f3-complete.json` plus one negative fixture per new code, named by the code), the
`CURRENT_FORMAT_VERSION` bump, the CHANGELOG and README updates, and the frozen-union and barrel-surface
guard tests kept in sync. Conformance fixtures and the solve are Lane B (PP-B6), landed after this stage
merges.

## Consequences

- `packages/format` receives a purely additive diff: the `path` attachment kind, the `PathConstraint`
  shape and the `pathConstraints` root array, the `path` animation timeline, their validators, and the
  0.4.x to 0.5.0 migration. No existing field is removed or repurposed, so Law 3 holds through the version
  bump plus migration mechanism. `assert-format-version-stable.mjs` sees `0.4.0 -> 0.5.0` and requires THIS
  ADR (which references `0.5.0`) to pass, which is the intended gate.
- Blast radius (recorded, not fixed here; the orchestrator sequences the downstream lanes): every package
  that CONSTRUCTS a `SkeletonDocument` or an `Animation` literal (runtime-core, conformance, document-core,
  mcp-server, runtime-web, editor) must add the empty `pathConstraints: []` root array and the empty
  `path: {}` per-animation record, or run its input through the migration. New surfaces (path attachments,
  path constraints, path timelines) are opt-in and break no existing constructor. Documents on disk load
  unchanged via the migration.
- Lane B (PP-B6) owns the path solve: constant-speed arc-length reparametrization from the `lengths` table,
  the position/spacing/rotate modes, the mix blend, and the default IK-before-transform-before-path order.
  This ADR deliberately leaves all of that to `runtime-core` and conformance and scopes the format to shape
  and reference validity.

## Alternatives considered

- A `PATH_WEIGHT_*` code set parallel to the mesh weighted codes. Rejected: the weighted-vertex codec is
  shared by ADR-0002 and the faults describe the codec, not the attachment; a parallel set is noise, and a
  path fault carrying a `MESH_WEIGHT_SUM` code is honest because it IS the shared codec's weight-sum rule.
- A required `curveCount` (or `vertexCount`) field on the path attachment. Rejected: it is fully derivable
  from the vertex stream plus `closed`, so storing it invites a second consistency check for zero benefit;
  the count is derived and `PATH_VERTEX_COUNT` validates that the derived count fits a cubic spline.
- `lengths` optional when `constantSpeed` is false. Rejected: the arc-length table is intrinsic authoring
  data the editor always has, a total shape avoids `?? recompute` fallbacks downstream, and a runtime that
  does not need it simply does not read it. Optionality would buy nothing and add a branch.
- A `color`/`width`/`height` on the path attachment (as `clipping` carries a color). Rejected: a path
  renders no pixels; its display tint is editor chrome, not runtime data. `boundingbox` (the closest analog:
  pure non-rendering geometry) already omits color, and the newer kind follows the leaner precedent.
- Path bones required to form a parent chain (as IK requires). Rejected: each path bone independently
  samples the arc; there is no geometric continuity between them, so a chain requirement would be an
  invented constraint that rejects legitimate rigs. Non-empty plus resolvable is the correct rule.
- Making `pathConstraints`/`path` optional to avoid the migration and blast radius. Rejected for the same
  reasons as ADR-0008/ADR-0009: the pre-1.0 migration-key gate routes old documents through migration
  regardless, so a migration is needed anyway, and optional collections would litter downstream code with
  `?? []`/`?? {}` and diverge from the total-shape discipline.
</content>
