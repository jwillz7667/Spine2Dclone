# ADR-0002 (ADR-2.WEIGHTED): Weighted mesh vertex encoding

Status: Accepted (2026-06-27)
Owner: Format Contract
Gates: TASK-2.2.0. MUST be Accepted before any weighted-vertex codec or validator code (TASK-2.2.1+).
Cross-ref: `docs/plan/cross-cutting/format-contract.md` section 6 (normative), `docs/plan/phase-2-rigging.md`
WP-2.2, `MARIONETTE_HANDOFF.md` section 6 (`MeshAttachment`).

## Context

`MeshAttachment` (handoff section 6) carries a single `vertices: number[]` field plus an optional
`bones?: number[]`. The handoff lists an inline per-influence `boneIndex` AND a top-level `bones` array without
stating their relationship, and does not say what `bones` contains given `boneIndex` is already inline. Phase 2
first AUTHORS weighted meshes (Phase 1 only round-tripped them verbatim as preserved attachments), so the codec
(`encodeWeightedVertices`/`decodeWeightedVertices`) and the weighted-encoding validator rules must be written
against a pinned interpretation. Writing code against an unpinned contract is forbidden (Law 3).

The ambiguity was already resolved normatively in `format-contract.md` section 6.3; this ADR ratifies that
resolution as the gating decision TASK-2.2.0 requires and makes the codec/validator/fixture authors cite a
decision record rather than a buried section.

## Decision

The PRESENCE of `bones` is the canonical "this mesh is weighted" signal and selects the decode.

1. **Unweighted mesh (`bones` absent).** `vertices` is a flat `[x0,y0,x1,y1,...]` in slot-bone local space, with
   `vertices.length === 2 * V` where `V = uvs.length / 2`. Final position of vertex i is
   `slotBoneWorldMatrix * (x_i, y_i)`.

2. **Weighted mesh (`bones` present).** `vertices` uses the variable-length, per-vertex, concatenated encoding:
   ```
   [ boneCount, (boneIndex, vx, vy, weight) repeated boneCount times ]   // per logical vertex, concatenated
   ```
   Final position of a logical vertex = `sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy))`,
   where `(vx, vy)` is the vertex expressed in that bone's local (bind) frame.

3. **`boneIndex` is a GLOBAL index** into `SkeletonDocument.bones` (0-based). It is NOT a local index into the
   attachment `bones` array.

4. **`bones`, when present, is the de-duplicated, ascending list of all GLOBAL bone indices referenced by this
   mesh's vertex stream.** Its presence is the weighted discriminator; its content is a binding manifest that lets
   a runtime gather exactly the world matrices it needs before skinning (a pooling/allocation optimization, not a
   second source of truth). It is derivable from the stream; the codec keeps it consistent.

5. **`MAX_BONE_INFLUENCES = 4`** is a pinned `packages/format` constant (the standard runtime-cost cap). It is NOT
   document state and NOT a command and NOT configurable; making it a format field would itself require a separate
   STOP-and-ADR. Runtimes may size fixed per-vertex buffers at 4 and assume the validator rejects anything larger.

6. **`WEIGHT_SUM_EPSILON = 1e-4`.** Per-logical-vertex weight sum must be within this epsilon of 1.0. The validator
   does NOT normalize; the editor weight-paint pipeline normalizes and the exporter writes normalized weights.

### Validator rules (stated non-circularly), each with its reserved `FormatErrorCode`

- If `bones` present, the weighted decode must consume EXACTLY `vertices.length` numbers and yield EXACTLY `V`
  logical vertices; if `bones` absent, `vertices.length === 2 * V`. Otherwise `MESH_WEIGHT_DECODE`
  (unweighted length mismatch remains `MESH_VERTEX_LENGTH`).
- Every inline `boneIndex` is in `[0, document.bones.length)`, else `MESH_WEIGHT_BONE_RANGE`.
- The set of inline `boneIndex` values equals `new Set(bones)` exactly (no unused manifest entry, no referenced
  index missing from the manifest), else `MESH_WEIGHT_BONES_MANIFEST`. The manifest must additionally be ascending
  and duplicate-free (its definition).
- `1 <= boneCount <= MAX_BONE_INFLUENCES` per logical vertex, else `MESH_WEIGHT_INFLUENCE_CAP`.
- Per-logical-vertex weight sum within `WEIGHT_SUM_EPSILON` of 1.0, else `MESH_WEIGHT_SUM`. Each weight is finite.

### Codec contract

- `encodeWeightedVertices(perVertexBindings) -> { vertices: number[], bones: number[] }` where `perVertexBindings`
  is `Array<Array<{ boneIndex: number; vx: number; vy: number; weight: number }>>` (one inner array per logical
  vertex, 1..4 influences). `bones` is the ascending de-duplicated set of referenced global indices.
- `decodeWeightedVertices(mesh) -> perVertexBindings`. Round-trip identity: `decode(encode(x))` deep-equals `x`.
- The codec lives in `packages/format` (the contract owner), is TypeScript-strict (no `any`, no unjustified `as`),
  and is the single producer/consumer of the on-disk weighted layout.

## Consequences

- The codec and weighted validator are ADDITIVE code in `packages/format`. They validate a section-6 structure
  first authored in Phase 2; this is expected and is not a Law 3 break. The `formatVersion` bump and migration that
  make weighted meshes (and the constraint/timeline schemas) loadable are handled in ADR-0004, not here.
- A worked decode example (the format-contract section 6.4 quad) is the canonical codec test vector.
- Unity/Godot read the weighted encoding per this ADR as FORMAT CONSUMPTION (not a solve step); `decodeWeighted`
  in `runtime-core`/runtimes feeds `solveSkin`. The conformance fixtures FIX-2.W and FIX-2.RM lock the resulting
  skinned positions.

## Alternatives considered

- `bones` as a per-vertex bone-count list. Rejected: redundant with the inline `boneCount` headers, and it cannot
  serve as the gather manifest.
- `bones` as a discriminator-only flag (e.g. always `[]` when weighted). Rejected: loses the pooling manifest and
  makes `MESH_WEIGHT_BONES_MANIFEST` meaningless.
- `boneIndex` local to the attachment `bones` array (Spine-runtime style). Rejected: forces every consumer to carry
  an indirection table and re-resolve indices; a global index is simpler and the document already enumerates bones
  in a stable order (the bone-ordering invariant).
