# @marionette/format CHANGELOG

The `formatVersion` is the semver of THE FORMAT (Law 3), independent of the package/app version. Pre-1.0,
breaking changes bump MINOR and ship a tested migration (format-contract.md section 10.3).

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
