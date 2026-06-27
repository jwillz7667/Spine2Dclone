# idle-sprite (Phase 1 Definition-of-Done acceptance rig)

This directory holds the committed `idle-sprite` rig: the artifact that gates Phase 1 (WP-1.13). It is
pinned exactly by `docs/plan/phase-1-bone-puppet.md` section 8.4, alongside the cross-runtime
conformance rigs but distinct from them (those live under `packages/conformance/src/`). This rig is an
editor DoD / integration artifact, not a cross-implementation fixture.

## Files

- `idle-sprite.rig.json`: a complete, valid `SkeletonDocument` (`formatVersion` 0.1.0). It validates
  with zero errors and zero warnings under `@marionette/format` `validateDocument(rig, { verifyHash: true })`,
  and `verifyContentHash(rig)` is true. The `hash` field is the SHA-256 content hash computed once by
  `computeContentHash` (format section 9), exactly as the exporter stamps it.
- `idle-sprite.sample-list.json`: the committed list of sample times the DoD harness reads. Sample times
  live ONLY here so the harness and this rig cannot drift from them. The list mixes exact keyframe times,
  between-key interpolation times, `0` and `duration` (the seamless-loop endpoints), and `1.35`
  (one value past `duration = 1.2`, which pins the per-channel clamp; under the transport loop map it
  folds to `0.15`).

## Rig structure

Bones (document order is parent-before-child, the validated invariant):

- `torso`: root (`parent: null`), `rotation = 90`, `length = 120`. The non-zero setup rotation is
  deliberate (it exercises the auto-key delta rule, TASK-1.8.2).
- `armL`: child of `torso` at the torso tip (`x = 120`), `rotation = 35`, `length = 70`.
- `armR`: child of `torso` at the torso tip (`x = 120`), `rotation = -35`, `length = 70`.

Slots (the `slots[]` array order IS the setup draw order, back to front): `armR`, `torso`, `armL`. Each
slot rides its like-named bone and shows a region attachment of the same name, color white, blend normal.

Default skin: slot `torso` -> attachment `torso` (`path: "torso"`), slot `armL` -> `armL`, slot `armR` ->
`armR`. Each region attachment resolves to an atlas region of the same name.

Animation `idle` (`duration = 1.2`, looping, seamless by construction): every authored channel has
MATCHED ENDPOINTS, the first keyframe value equals the last, so with the single-period clamp
`pose(0) == pose(duration)` and the loop has no pop (TASK-1.4.7). Channels (each value is the DELTA over
the setup pose, TASK-1.4.3):

- `torso.rotate`: `0 -> 8 -> 0` degrees at `t = 0, 0.6, 1.2`, bezier easing on the first two segments.
- `torso.translate`: `(0,0) -> (0,6) -> (0,0)` at `t = 0, 0.6, 1.2`, linear (a small vertical bob).
- `armL.rotate`: `0 -> 20 -> 0` degrees at `t = 0, 0.6, 1.2`, first segment stepped then linear.
- `armR.rotate`: `0 -> -20 -> 0` degrees at `t = 0, 0.6, 1.2`, bezier then linear.

This uses all three curve types (linear, stepped, bezier) across multiple bones and moves between
distinct in-cycle times, so the harness equalities are not vacuously true on a static rig.

## Atlas

The `atlas` field is hand-authored to the section 8.4 pack spec (`maxPageSize = 128`, `padding = 2`,
`allowRotation = false`, sort area-descending then name-ascending), yielding two `128x128` pages:
page 0 = `[torso]`, page 1 = `[armL, armR]` (so the rig exercises the multi-page path). All `rotated`
flags are false (Phase 1, section 4.2). Region trim (`offsetX/offsetY`, `originalW/originalH`) matches
the source-sprite dimensions in section 8.4.

## Advisory PNGs are deferred (non-gating)

The source sprite PNGs and the packed page PNGs (`idle-sprite-page0.png`, `idle-sprite-page1.png`,
named in the rig) are the DETERMINISTIC OUTPUT of the WP-1.3 atlas pipeline and feed only the
NON-gating advisory visual check (TASK-1.13.5). The Phase 1 milestone gate is transform-only: it reads
bone world affines and bone-tip positions, never atlas pixels. The committed `AtlasRef` geometry above
exists so the document validates and every attachment path resolves; the pixel artifacts are deferred
to the WP-1.3 packer integration and are intentionally not committed here. Do not block the gate on the
PNGs (section 8.4).

## What the gate proves (and does not)

The DoD harness (`packages/runtime-web/test/idle-sprite-dod.test.ts`) samples `idle` through the
editor's `runtime-core` solve path and through `runtime-web`'s playback path and asserts they agree
EXACTLY. Both paths call the same `sampleSkeleton` symbol, so the agreement proves determinism and
non-perturbation across the editor/runtime boundary (LAW 1), NOT cross-implementation correctness. The
cross-implementation gate (Unity and Godot reproducing committed fixtures) is the conformance suite in
Phase 5, against the cross-runtime rigs, not this rig.
