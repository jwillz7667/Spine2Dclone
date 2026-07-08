# @marionette/runtime-core

The platform-agnostic solve: the behavioral source of truth for every runtime. All skeletal
solving, the particle/VFX simulation, and the slot presentation sequencer live here as pure
deterministic TypeScript. Conformance fixtures are generated from this package, and the planned
Unity (C#) and Godot runtimes must reproduce it within the pinned tolerances.

**Hard boundaries (lint-enforced with CI guard tests):** no PixiJS, no DOM, no Node built-ins, no
Electron, no Zod (types come from `@marionette/format/types` via `import type` only), no
`Math.random`, no `Date.now`, and no non-`as const` type assertions. `no-explicit-any` is an error.
These bans exist so the logic ports unchanged to C# and GDScript.

## The per-frame solve order (canonical)

Implemented in `src/skeleton/sample.ts` (`sampleSkeleton`); this order is the behavioral spec every
runtime must match exactly:

1. **Reset** to setup pose (`resetToSetupPose`, plus slot colors and constraint mixes).
2. **Apply animation timelines** (`applyAnimationAt` blends locals, slot color, and constraint
   mixes; `composeTouchedBones` composes touched local matrices).
3. **Solve constraints**: all IK constraints first (`solveIkOneBone` / `solveIkTwoBone`), then all
   transform constraints (`solveTransformConstraint`), each in document order (ADR-0003).
   Constraints write local transforms only.
4. **World transforms**: one forward pass (`computeWorldTransforms`), parents before children,
   dispatching per bone on `transformMode` (`normal` plus four parent-influence-suppressing modes
   in `src/skeleton/transform-mode.ts`).
5. **Skin meshes and apply deform**: `skinMeshInto` (linear blend skinning) then `applyDeform`
   (world-space additive offsets), via `src/skeleton/mesh-sample.ts`.
6. Render: not this package's job.

## Module map

| Area | Modules | Contents |
|---|---|---|
| Affine math | `math/affine.ts` | The 2x3 matrix library: `compose`, `decompose`, `multiply`, `invert`, in-place `*Into` variants |
| Pose | `skeleton/pose.ts`, `build-pose.ts` | The `Pose` structure-of-arrays buffers (Float64), built once from a `SkeletonDocument` |
| Sampling | `skeleton/sample.ts`, `curve.ts`, `prepared.ts` | Single-animation sampling, the bezier table sampler (`BEZIER_SEGMENTS`), the prepared-animation cache |
| Skin state | `skeleton/skin-state.ts` | Runtime skin selection (PP-B3): `buildSkinState`, `setActiveSkin`, `resolveAttachment`, `resolveSlotAttachment`. An allocation-free lookup of the attachment a slot presents under the active skin (default-skin fallback), so a renderer switches skins live without rebuilding the `Pose`. A pure lookup over document skins + `pose.slotAttachment`; changes no solve output |
| AnimationState | `skeleton/animation-state.ts` | Multi-track playback per ADR-0005: `setAnimation`, `crossfadeTo`, `queueAnimation`, additive layering |
| Solve primitives | `solve/` | `resolveWorld`, one/two-bone IK, transform constraint, weighted/unweighted skinning, deform |
| Effects | `effects/` | Mulberry32 PRNG (`makePrng`, `hash32`, `spinSeed` = FNV-1a-32 over UTF-8), the normative per-particle draw order, SoA particle pools with integer age steps, life curves, the emitter/sprite-animator/ribbon solvers, `EffectSystem` (quality tiers, `DEFAULT_MAX_LIVE_PARTICLES = 2000` budget with eviction) |
| Slot | `slot/` | `sequence(result, scene)` producing a `PresentationTimeline` (pure function of a `SpinResult`, LAW 1), the integer fixed-point `rollupValueAt`, the column-down cascade `solveCascadeStep` |

## Runtime skin selection (PP-B3)

`buildSkinState(document)` builds an allocation-free `SkinState` whose active skin defaults to `default`.
A renderer solves the pose once with `sampleSkeleton`, then reads each slot's geometry with
`resolveSlotAttachment(state, pose, slotIndex)`, which returns the `Attachment` the slot presents (or
`null`). `setActiveSkin(state, name)` switches skins live (a re-costumed character) and throws the typed
`UnknownSkinError` for an unknown name; an attachment the active skin does not define falls back to the
`default` skin, so a costume skin can override only some slots and inherit the rest. This is a pure
lookup over `pose.slotAttachment` (the resolved attachment NAME the solve writes at step 2) plus the
document skins: it adds no per-frame allocation, changes no solve output, and touches no fixture.

## Determinism rules

- Same document, animation, and time always produce the same pose; same seed always produces the
  same particles; same `SpinResult` plus scene always produces the same timeline (all times are
  integer milliseconds, all money integer base units).
- The emitter uses an integer step clock (fixed-point spawn accumulator, `SPAWN_FIXED_ONE = 65536`)
  with a single pinned quantization at instance creation.
- Integer primitives (`spinSeed`, `hash32`, Mulberry32, CRC-32) are golden-vectored in
  `packages/conformance/src/cross-language/seed-prng-crc-vectors.json` and must be bit-identical in
  every language.
- No per-frame allocation: module-level scratch matrices, typed-array pools with free-list stacks,
  prepared tables built once. `test/determinism.test.ts` includes an allocation probe.

## Run

```sh
pnpm --filter @marionette/runtime-core typecheck
pnpm --filter @marionette/runtime-core test        # vitest, 28 test files
pnpm --filter @marionette/runtime-core gen:golden  # regenerate the byte-locked golden fixtures
pnpm --filter @marionette/runtime-core build
```

Dependencies: `@marionette/format` (types only). `@marionette/math-bridge` appears as a
devDependency for tests; product code may import only `@marionette/math-bridge/types` and
`spinResultSchema`, and only from `src/slot` (the WP-4.7 carve-out).

Changing solve behavior here changes conformance fixtures: regenerate them in the same PR behind
the behavior-change review gate (`docs/plan/cross-cutting/conformance-and-ci.md`).
