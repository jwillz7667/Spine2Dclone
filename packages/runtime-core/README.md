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

1. **Reset** to setup pose (`resetToSetupPose`, plus slot colors, constraint mixes, and the setup
   draw order).
2. **Apply animation timelines** (`applyAnimationAt` blends locals, slot color, and constraint
   mixes, and applies the active draw-order key; `composeTouchedBones` composes touched local
   matrices). Event firing is NOT part of this instantaneous pose sample (it is a time-range
   operation, see below).
3. **Solve constraints**: by default all IK constraints first (`solveIkOneBone` / `solveIkTwoBone`),
   then all transform constraints (`solveTransformConstraint`), then all path constraints
   (`solvePathConstraint`), each in document order (ADR-0003, ADR-0011); when the rig assigns an explicit
   `order` the combined set (now spanning all three constraint arrays) is solved in one interleaved
   schedule instead (ADR-0010, ADR-0013). IK also honours the depth controls (softness easing, stretch,
   compress, uniform) that write local rotation and, for stretch/compress, local scaleX. A path constraint
   distributes and orients its bones along a target slot's path attachment (a piecewise cubic Bezier
   spline), writing local translation, rotation, and, for `chainScale`, scaleX (ADR-0013). Constraints
   write local transforms only.
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
| Sampling | `skeleton/sample.ts`, `curve.ts`, `prepared.ts` | Single-animation sampling, the bezier table sampler (`BEZIER_SEGMENTS`), the prepared-animation cache, the draw-order lane application (PP-B4) |
| Event firing | `skeleton/event-fire.ts` | Draw-order/event solve for PP-B4: `fireEventsInStep`, `collectFiredEvents`, `prepareEventTimeline`, the pooled `EventQueue`. Time-range fire-on-cross with exact loop-boundary semantics |
| Skin state | `skeleton/skin-state.ts` | Runtime skin selection (PP-B3): `buildSkinState`, `setActiveSkin`, `resolveAttachment`, `resolveSlotAttachment`. An allocation-free lookup of the attachment a slot presents under the active skin (default-skin fallback), so a renderer switches skins live without rebuilding the `Pose`. A pure lookup over document skins + `pose.slotAttachment`; changes no solve output |
| Geometry attachments | `skeleton/attachment-geometry.ts` | Clipping / bounding-box / point solve (PP-B2, ADR-0012): `prepareClipping`, `resolveClipWorldPolygonForSlot`, `computeClippedSlotRange`, `clipTriangleList`, `boundingBoxWorldVerticesForSlot`, `hitTestPolygon` / `hitTestBoundingBox`, `resolvePointWorld`. Post-step-4 accessors over the solved pose (world pass + draw order); read-only, so they change no fixture (Law 1) |
| AnimationState | `skeleton/animation-state.ts` | Multi-track playback per ADR-0005: `setAnimation`, `crossfadeTo`, `queueAnimation`, additive layering, the per-update event queue drain (PP-B4) |
| Solve primitives | `solve/` | `resolveWorld`, one/two-bone IK, transform constraint, path constraint (`solvePathConstraint`, ADR-0013: cubic Bezier eval, the pinned 64-segment world arc-length LUT for constant speed, position/spacing distribution, the three rotate modes, the parent-frame mix write), weighted/unweighted skinning, deform |
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

## Draw order and event firing (PP-B4, ADR-0008)

**Draw order** is a `Pose` lane, `pose.drawOrder` (an `Int32Array` where `drawOrder[renderPosition] =
slotIndex`, position 0 furthest back). Step 1 resets it to the setup identity order; step 2 applies the
animation's active draw-order key (the latest key at or before `t`, stepped) as a discrete
greater-weight-wins channel, exactly like the attachment swap. Below the first key the setup order holds
(coherent with ADR-0008's "empty offsets means setup order"). Each key's compact `{slot, offset}` diff is
derived once at build into a full render-order permutation (`buildDrawOrderTimeline`), so application is a
single allocation-free typed-array copy. A renderer reads `pose.drawOrder` after `sampleSkeleton` /
`applyAnimationState` to draw slots front-to-back.

**Events** are discrete markers fired as playback time advances PAST them, so they are a TIME-RANGE
operation (`fireEventsInStep` / `collectFiredEvents`), not part of the instantaneous pose sample. Firing
is half-open on the low end `(from, from+dt]` with exact loop-boundary semantics (tail of the current
period, then one full pass per completed period, then the head). Event times live in `[0, duration]`:
`t == duration` is the loop point (fires once per loop in the tail), and `t == 0` is the animation's
starting state (it does not fire on its own during looping playback, since every sweep starts at
`fromTime >= 0` and is half-open). Payloads are resolved once (the `EventDef` default overridden by the
key) into a pooled, drained-per-update `EventQueue` (zero steady-state allocation, pinned by the
allocation probe).

`AnimationState` drains its `eventQueue` each `updateAnimationState`: every ADVANCING entry fires,
including a crossfading-OUT `mixFrom` entry. This is a first-principles choice, not Spine imitation: an
event is a discrete logical/audio marker, not a weighted value, so a track's blend weight (`alpha`, the
crossfade fraction) cannot fire "half an event." A playing animation fires its events as it plays,
independent of how visible it is; weight gates the visual contribution, never the firing. Fire order
within one update is (ascending track index, outgoing-before-incoming, timeline), matching the apply
order, so the drained log is deterministic.

## Clipping, bounding boxes, and points (PP-B2, ADR-0012)

The three non-drawing geometry attachment kinds (`clipping`, `boundingbox`, `point`) are solved in
`skeleton/attachment-geometry.ts` as pure accessors over an already-solved `Pose` (they read
`pose.world` and `pose.drawOrder` and never write, so they add no fixture and keep Law 1 intact). In
our format these polygons are always unweighted (no `bones` manifest), so a vertex's world position is
`slotBoneWorld * (x, y)`.

- **Clipping.** `prepareClipping(clip)` decides convexity once on the LOCAL polygon (affine invariant)
  and, when concave, ear-clips it into reusable triangle topology, recording the pooled worst-case
  bounds. Per frame, `resolveClipWorldPolygonForSlot` transforms the polygon to world and
  `computeClippedSlotRange` returns the slots the clip affects (the slots after the clip slot up to and
  including its `end` slot in the CURRENT draw order). `clipTriangleList` is the geometry operation a
  CPU rasterizer needs: pooled Sutherland-Hodgman clipping of a triangle stream against the polygon
  (single pass when convex, one pass per ear-clip piece when concave), reorienting each convex piece CCW
  by its signed area, emitting each output vertex with its barycentric coordinates so a renderer
  interpolates UVs/colors. Zero steady-state allocation; a determinism test and an allocation probe pin
  it, and the cross-language `clip-geometry-vectors.json` golden locks it across TS, C#, and GDScript.
- **Bounding boxes.** `boundingBoxWorldVerticesForSlot` transforms the box to world;
  `hitTestPolygon` / `hitTestBoundingBox` is even-odd (crossing-number) point-in-polygon, orientation
  independent and compared EXACT in conformance.
- **Points.** `resolvePointWorld` composes the local `(x, y, rotation)` with the slot bone world:
  position is the affine of `(x, y)`, rotation is `point.rotation` plus the bone's world x-axis angle.

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
pnpm --filter @marionette/runtime-core test        # vitest, 34 test files
pnpm --filter @marionette/runtime-core gen:golden  # regenerate the byte-locked golden fixtures
pnpm --filter @marionette/runtime-core build
```

Dependencies: `@marionette/format` (types only). `@marionette/math-bridge` appears as a
devDependency for tests; product code may import only `@marionette/math-bridge/types` and
`spinResultSchema`, and only from `src/slot` (the WP-4.7 carve-out).

Changing solve behavior here changes conformance fixtures: regenerate them in the same PR behind
the behavior-change review gate (`docs/plan/cross-cutting/conformance-and-ci.md`).
