# @marionette/format CHANGELOG

The `formatVersion` is the semver of THE FORMAT (Law 3), independent of the package/app version. Pre-1.0,
breaking changes bump MINOR and ship a tested migration (format-contract.md section 10.3).

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
