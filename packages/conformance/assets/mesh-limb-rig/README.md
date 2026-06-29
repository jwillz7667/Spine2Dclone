# mesh-limb-rig (Phase 2 Definition-of-Done acceptance rig)

This directory holds the committed `mesh-limb-rig`: the integrated artifact that gates Phase 2 (WP-2.11,
DECISION-2.0 named this the DoD rig). It is an editor DoD / integration artifact, distinct from the
cross-runtime conformance rigs (which live under `packages/conformance/src/`). It exercises the whole
Phase 2 stack together: a mesh, skinning, a two-bone IK chain, and a deform timeline, all authored
ENTIRELY through `@marionette/document-core` commands (LAW 2).

## Files

- `mesh-limb-rig.rig.json`: a complete, valid `SkeletonDocument` (`formatVersion` 0.2.0). It validates
  with zero errors and zero warnings under `@marionette/format` `validateDocument(rig, { verifyHash: true })`,
  and `verifyContentHash(rig)` is true. The `hash` field is the SHA-256 content hash stamped once by
  `computeContentHash`, exactly as the exporter writes it.
- `mesh-limb-rig.sample-list.json`: the committed list of sample times the DoD harnesses read. Sample
  times live ONLY here so a harness and this rig cannot drift from them. The list spans `[0, duration]`
  with the deform/IK peak at `0.5`, the seamless-loop endpoints `0` and `duration` (1), and one
  past-duration value (`1.25`) that pins the per-channel clamp.

## How it is built (reproducible from commands)

The rig is produced by `buildMeshLimbRig()` in
`packages/document-core/test/mesh-limb-rig-builder.ts`, which stands up a `Document` and drives every
mutation through `doc.history.execute(...)`, then returns `exportDocument(doc.model)` (which validates
and hashes). The committed JSON is a pure function of that command sequence, so it is regenerated with
`pnpm exec tsx packages/document-core/test/write-mesh-limb-rig.ts` (run from the conformance package,
which provides `tsx`). The document-core DoD test
(`packages/document-core/test/mesh-limb-rig.dod.test.ts`) asserts the committed file deep-equals the
builder output, so any drift fails CI.

The builder lives under document-core (not conformance) because conformance is forbidden by the eslint
boundaries config to import document-core; conformance depends only on `format` + `runtime-core`. The
committed JSON below is read back by `runtime-web` through `@marionette/format` (which has no
document-core edge), keeping every dependency direction legal.

## Rig structure

Bones (document order is parent-before-child, the validated invariant): `root` (`parent: null`),
`ik-target` and `target` (children of `root`), `upper` (child of `root`, at `x = 50`), `lower` (child of
`upper`, at `x = 50`). The IK chain `[upper, lower]` is parent-then-direct-child (continuous).

Slot `limb` rides `upper` and shows a mesh attachment of the same name (`path: "limb"`, resolving to the
atlas region `limb`).

Default skin: a WEIGHTED mesh on `limb`. It begins as a region (`AddRegionAttachment`), becomes an
editable quad (`GenerateMeshFromRegion`), is bound to `[upper, lower]` (`BindMeshToBones`, equalSplit),
then proximity-weighted (`AutoWeightFromProximity`). The mesh's `bones` gather manifest holds the GLOBAL
indices of `upper` and `lower`.

Constraints: one two-bone IK constraint `limb-ik` on `[upper, lower]` reaching `target`, mix 1,
bendPositive.

Animation `wave` (`duration = 1`, looping, seamless by construction; matched endpoints on every channel):

- `limb-ik` (IK mix): `0 -> 1 -> 0` at `t = 0, 0.5, 1` (the limb bends in, then straightens).
- `upper.rotate`: `0 -> 25 -> 0` degrees at `t = 0, 0.5, 1` (the limb wobbles).
- `lower.rotate`: `0 -> -15 -> 0` degrees at `t = 0, 0.5, 1`.
- `default / limb / limb` deform: the 8 offsets (one `(dx, dy)` per logical vertex,
  `offsets.length == uvs.length`) grow at `t = 0.5` then settle to zero, so the mesh wobbles on TOP of
  the IK-driven skin.

So the limb both BENDS (the IK chain driving the weighted skin) and WOBBLES (the deform pose).

## What the gate proves (and does not)

The two DoD harnesses sample `wave` through the editor's `runtime-core` solve path and through
`runtime-web`'s playback path and assert they agree EXACTLY, on bone world transforms AND on the skinned
+ deformed mesh vertices (`sampleMeshVertices`). Both paths call the same `runtime-core` symbols, so the
agreement proves determinism and non-perturbation across the editor/runtime boundary (LAW 1), NOT
cross-implementation correctness. The cross-implementation gate (Unity and Godot reproducing committed
fixtures) is the conformance suite in Phase 5, against the cross-runtime rigs, not this rig.
