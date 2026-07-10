# @marionette/format CHANGELOG

The `formatVersion` is the semver of THE FORMAT (Law 3), independent of the package/app version. Pre-1.0,
breaking changes bump MINOR and ship a tested migration (format-contract.md section 10.3).

## 0.6.0 (2026-07-09)

Stage F4 presentation additions (ADR-0014): physics constraints. A physics constraint drives one bone with a
per-channel damped spring toward its animated pose, so secondary motion (tails, ropes, jiggle) emerges
deterministically from the pose plus world forces. Additive and backward compatible via a migration; no
existing field is removed or repurposed. The runtime solve (a fixed-timestep semi-implicit integrator on an
integer step clock, ADR-0014 section 2) is Lane B (PP-B7), landed after this stage.

Added (schema):

- Physics constraint. A new `SkeletonDocument.physicsConstraints: PhysicsConstraint[]` (required array, empty
  when a rig has none): a single `bone`, a non-empty unique `channels` set over `x`/`y`/`rotation`/`scaleX`/
  `shearX`, the model parameters `step` (the fixed timestep, > 0), `inertia`/`damping`/`mix` (in `[0, 1]`),
  `strength` (>= 0), `mass` (> 0), and `wind`/`gravity` (finite world-force inputs), and an optional shared
  `order`. Physics constraints join the existing constraint name and `order` namespace, which now spans the
  ik, transform, path, and physics arrays.
- Skeleton physics settings. A new OPTIONAL `SkeletonDocument.physics` block (`gravity`, `wind`, `mix`): global
  defaults added to (or, for `mix`, multiplied into) each constraint's values. Absent means gravity 0, wind 0,
  mix 1.
- Physics timeline. A new required `Animation.physics` record keying the dynamic physics channels
  `mix`/`inertia`/`strength`/`damping`/`wind`/`gravity` (partial per frame). `step`/`mass`/`channels` are not
  keyable (the determinism anchor, a static inertial property, and a structural set).

Added (validation):

- SCHEMA family: `PHYSICS_STEP_RANGE` (step <= 0), `PHYSICS_MASS_RANGE` (mass <= 0), `PHYSICS_STRENGTH_RANGE`
  (strength < 0), and `PHYSICS_INERTIA_RANGE` / `PHYSICS_DAMPING_RANGE` / `PHYSICS_MIX_RANGE` (a factor outside
  `[0, 1]`; definition, settings, or frame).
- CONSTRAINT family: `PHYSICS_CHANNELS_EMPTY` (structural), `PHYSICS_CHANNEL_DUPLICATE` (structural), and
  `PHYSICS_BONE_MISSING` (the bound bone does not resolve). Name uniqueness and the dense `order` permutation
  (`CONSTRAINT_NAME_DUPLICATE`, `CONSTRAINT_ORDER_INVALID`) now span all four constraint arrays; skin scoping
  (`SKIN_CONSTRAINT_UNKNOWN`) resolves physics constraints too.
- ANIM family: `ANIM_PHYSICS_UNKNOWN` (a physics timeline references a missing physics constraint).

Migration:

- Registered the `0.5.x -> 0.6.0` step: inject the empty root `physicsConstraints` array and the per-animation
  `physics` record, stamp `formatVersion`, and recompute the content hash when the source carried one. The
  optional skeleton `physics` settings block is NOT injected (absent is valid). Every other F4 addition is
  new-and-unreferenced by a 0.5.0 document, so nothing else is injected. A `0.1.0` document still loads through
  the full six-step chain (backward compatibility suite in `migrate.test.ts`).

## 0.5.0 (2026-07-09)

Stage F3 presentation additions (ADR-0011): path attachments and path constraints. Additive and backward
compatible via a migration; no existing field is removed or repurposed.

Added (schema):

- Path attachment. A seventh closed attachment kind `path` (a piecewise cubic Bezier spline through a slot):
  `closed`, `constantSpeed`, `lengths` (the cumulative per-curve arc-length table for constant-speed
  parametrization), and `vertices` with an optional `bones` manifest reusing the mesh weighted-vertex codec
  (ADR-0002). A path renders no pixels, so it carries no atlas region, size, or color.
- Path constraint. A new `SkeletonDocument.pathConstraints: PathConstraint[]` (required array, empty when a
  rig has none): a `target` SLOT whose active attachment is a path, a non-empty `bones` list, `positionMode`
  (`fixed`/`percent`), `spacingMode` (`length`/`fixed`/`percent`/`proportional`), `rotateMode`
  (`tangent`/`chain`/`chainScale`), `position`/`spacing`/`offsetRotation`, and `mixRotate`/`mixX`/`mixY`.
  Path constraints join the existing constraint name and optional `order` namespace, which now spans the ik,
  transform, and path arrays.
- Path timeline. A new required `Animation.path` record keying path-constraint `position`, `spacing`, and
  the three `mix` channels (partial per frame).

Added (validation):

- PATH family: `PATH_VERTEX_COUNT` (control-point count invalid for the declared open/closed cubic spline),
  `PATH_LENGTHS_COUNT` (arc-length table length != curve count), `PATH_LENGTHS_ORDER` (table not a
  non-negative non-decreasing cumulative sequence). The path vertex stream reuses the shared `MESH_*` codec
  codes.
- CONSTRAINT family: `PATH_TARGET_MISSING`, `PATH_TARGET_NOT_PATH` (checked against the setup attachment
  where statically decidable), `PATH_BONES_EMPTY` (structural), `PATH_BONE_MISSING`. Name uniqueness and the
  dense `order` permutation (`CONSTRAINT_NAME_DUPLICATE`, `CONSTRAINT_ORDER_INVALID`) now span all three
  constraint arrays; skin scoping (`SKIN_CONSTRAINT_UNKNOWN`) resolves path constraints too.
- SCHEMA family: `PATH_MIX_RANGE` (a path mix channel, definition or frame, outside `[0, 1]`).
- ANIM family: `ANIM_PATH_UNKNOWN` (a path timeline references a missing path constraint).

Migration:

- Registered the `0.4.x -> 0.5.0` step: inject the empty root `pathConstraints` array and the per-animation
  `path` record, stamp `formatVersion`, and recompute the content hash when the source carried one. Every
  other F3 addition is new-and-unreferenced by a 0.4.0 document, so nothing else is injected. A `0.1.0`
  document still loads through the full five-step chain (backward compatibility suite in `migrate.test.ts`).

## 0.4.0 (2026-07-08)

Stage F2 presentation additions (ADR-0009). Additive plus one lossless rename (`bendPositive` to a signed
`bend`), backward-compatible via a migration.

Added (schema):

- Constraint depth. `IkConstraint` gains `softness` (>= 0), `stretch`, `compress`, `uniform`, and replaces
  `bendPositive` with a signed `bend` (`1 | -1`). `TransformConstraint` gains `local` and `relative`
  variant flags. Both constraint arrays share an optional explicit `order` (a dense, unique permutation of
  `[0, N)` when present; omitted means the default IK-then-transform document order). The animation
  `IkFrame` replaces `bendPositive` with `bend` and gains optional `softness`/`stretch`/`compress`.
- Linked meshes. A new closed attachment kind `linkedmesh` (`type`, `path`, `parent`, optional `skin`,
  `timelines`, `color`, `width`, `height`) reuses a parent mesh's geometry; it may itself be a deform
  target (its V resolved through the parent chain).
- Sequence attachments. An optional `sequence` block (`count`, `start`, `digits`, `setupIndex`) on region
  and mesh attachments, and a per-slot `sequence` timeline keyed by `mode` (hold/once/loop/pingpong plus
  the three reverse variants), `index`, and `delay`.
- Timeline granularity. Per-component bone tracks (`translateX/Y`, `scaleX/Y`, `shearX/Y`, each scalar with
  its own curve) alongside the joint tracks; split slot color tracks (`rgb`, `alpha`); a keyable two-color
  `dark` track. A joint track and its split components must not coexist on one bone or slot.
- Skin scoping. Optional `bones` and `constraints` name lists on a skin (active while the skin is active).

Added (validation):

- SCHEMA family: `IK_SOFTNESS_RANGE` (negative softness), `SEQUENCE_SETUP_RANGE` (setupIndex outside
  `[0, count)`). Split color channels reuse `COLOR_RANGE`.
- CONSTRAINT family: `CONSTRAINT_ORDER_INVALID` (order partial, duplicated, gapped, or out of range).
- MESH family: `LINKED_MESH_PARENT_MISSING`, `LINKED_MESH_PARENT_INVALID`, `LINKED_MESH_CYCLE`.
- ANIM family: `TIMELINE_COMPONENT_CONFLICT` (joint vs split coexistence), `ANIM_DARK_NO_SETUP` (dark
  timeline without a setup `darkColor`).
- SKIN family: `SKIN_BONE_UNKNOWN`, `SKIN_CONSTRAINT_UNKNOWN`.

Migration:

- Registered the `0.3.x -> 0.4.0` step: map `bendPositive` to the signed `bend` losslessly (in both IK
  constraints and IK frames), inject the IK depth defaults (`softness` 0, `stretch`/`compress`/`uniform`
  false) and the transform variant flags (`local`/`relative` false), stamp `formatVersion`, and recompute
  the content hash when the source carried one. Every other F2 addition is optional or new, so nothing else
  is injected. A `0.1.0` document still loads through the full four-step chain (backward compatibility suite
  in `migrate.test.ts`).

## 0.3.0 (2026-07-08)

Stage F1 presentation additions (ADR-0008). Additive and backward-compatible via a migration; no existing
field is removed or repurposed.

Added (schema):

- `SkeletonDocument.events: EventDef[]` (required array, empty when a rig defines none). `EventDef` carries
  a unique `name`, optional `int`/`float`/`string` payload defaults, and an optional `audio` hint
  (`path`, `volume` in [0, 1], `balance` in [-1, 1]). `events` is an array (not a record) so name
  uniqueness is a typed error.
- `SkeletonDocument.metadata?: SkeletonMeta` (optional, strict): `fps` (positive), `imagesPath`,
  `audioPath`, all optional.
- `Animation.drawOrder: DrawOrderKeyframe[]` and `Animation.events: EventKeyframe[]` (required arrays,
  empty when unused). A draw-order key is a compact list of `{ slot, offset }` entries against the setup
  order (empty means setup order); an event key is `{ time, name, int?, float?, string? }` with no curve.

Added (validation):

- EVENT family made live: `EVENT_NAME_DUPLICATE` (unique event-def names) and `ANIM_EVENT_UNKNOWN` (an
  event-timeline key references a defined event).
- `DRAWORDER_INCOMPLETE` made live for the offset representation: a duplicated slot, an out-of-range
  target index, or two slots colliding on one index in a single key. An unknown slot in a draw-order
  offset is `ANIM_SLOT_UNKNOWN`.
- New `EVENT_AUDIO_RANGE` code (SCHEMA family) for audio `volume`/`balance` out of range.
- The event timeline uses non-decreasing time order (coincident events legal); value and draw-order
  timelines stay strictly ascending (`ANIM_TIME_ORDER`).

Migration:

- Registered the `0.2.x -> 0.3.0` step: inject the empty root `events` collection and the per-animation
  `drawOrder` and `events` timelines, stamp `formatVersion`, and recompute the content hash when the
  source carried one. `runMigrations` now validates only the fully migrated result against the current
  schema (not each intermediate), so a `0.1.x` document still loads through the two-step chain
  (backward compatibility suite in `migrate.test.ts`).

## 0.2.0 (2026-06-27)

Phase 2 rigging additions (ADR-0004). Additive and backward-compatible via a migration; no existing field
is removed or repurposed.

Added (schema):

- `SkeletonDocument.ikConstraints: IkConstraint[]` and `SkeletonDocument.transformConstraints:
  TransformConstraint[]` (required arrays, empty when a rig has none).
- `Animation.ik`, `Animation.transform`, and `Animation.deform` timelines (required records, empty when an
  animation keys none). New `IkFrame`, `TransformFrame`, and `DeformTimelines` shapes.
- `IkConstraint` and `TransformConstraint` shapes (handoff section 6).

Added (codec and validation):

- Weighted-vertex codec `encodeWeightedVertices` / `decodeWeightedVertices`, `isWeightedMesh`, and the
  pinned constants `MAX_BONE_INFLUENCES` (4) and `WEIGHT_SUM_EPSILON` (1e-4) (ADR-0002).
- MESH validator family: `MESH_UV_LENGTH`, `MESH_TRIANGLE_LENGTH`, `MESH_TRIANGLE_INDEX_RANGE`,
  `MESH_HULL_RANGE`, `MESH_EDGE_INVALID`, `MESH_VERTEX_LENGTH`, `MESH_WEIGHT_DECODE`,
  `MESH_WEIGHT_BONE_RANGE`, `MESH_WEIGHT_BONES_MANIFEST`, `MESH_WEIGHT_INFLUENCE_CAP`, `MESH_WEIGHT_SUM`.
- CONSTRAINT validator family: `IK_BONES_ARITY`, `IK_BONE_MISSING`, `IK_TARGET_MISSING`,
  `IK_CHAIN_DISCONTINUOUS`, `IK_MIX_RANGE`, `TC_BONE_MISSING`, `TC_TARGET_MISSING`, `TC_MIX_RANGE`,
  `CONSTRAINT_NAME_DUPLICATE`.
- ANIM extensions: `ANIM_IK_UNKNOWN`, `ANIM_TRANSFORM_UNKNOWN`, plus time range/order on the new timelines.
- DEFORM validator family: `DEFORM_SKIN_UNKNOWN`, `DEFORM_SLOT_UNKNOWN`, `DEFORM_ATTACHMENT_UNKNOWN`,
  `DEFORM_NOT_MESH`, `DEFORM_OFFSET_LENGTH`.
- All of the above codes were already reserved in `FORMAT_ERROR_CODES`; the union is unchanged.

Migration:

- Built the migration framework (`version/migrate.ts`, `version/migrations/`, deferred WP-F.8) and
  registered the `0.1.x -> 0.2.0` step: inject the empty constraint arrays and animation timelines, stamp
  `formatVersion`, and recompute the content hash when the source carried one. The version gate runs the
  chain on import, so every committed Phase 1 (0.1.0) document still loads (backward compatibility suite in
  `migrate.test.ts`).

## 0.1.0 (Phase 0 / Phase 1)

Initial format: bones, slots, region/mesh/clipping/point/boundingbox attachment shapes, skins, the strict
`{ duration, bones, slots }` animation subset, atlas, content hashing, and the structural + semantic
validators for the bone/slot/skin/atlas/anim families.
