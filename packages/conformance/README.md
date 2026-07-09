# @marionette/conformance

The cross-runtime behavioral-truth check for Armature 2D. It holds the committed reference rigs,
the per-rig sample specs, and the expected-output fixtures generated from `runtime-core` (the
TypeScript behavioral source of truth). Every runtime (web today; Unity and Godot when they land in
Phase 5) must reproduce these fixtures within one shared tolerance. The authoritative design is
`docs/plan/cross-cutting/conformance-and-ci.md`.

## The four fixture tracks

All under `src/`:

| Track | Rigs / inputs | Fixtures | Lock |
|---|---|---|---|
| **Skeleton** | `rigs/` (20 rigs, each committed as `.json` AND a binary `.bin` twin): rig-2bone, rig-rigid-mesh, rig-weighted-mesh, rig-one-bone-ik, rig-two-bone-ik, rig-transform-constraint, rig-deform, rig-transform-modes, rig-blendmodes, rig-events-draworder, rig-events-loop, rig-ik-depth, rig-constraint-order, rig-transform-variants, rig-linked-mesh, rig-sequences, rig-split-tracks, rig-skin-scoped, rig-clipping, rig-hit-point | `fixtures/` (20, driven by `sample-spec/`) | `.fixtures.lock` |
| **Effects / particles** | `effects-rigs/` (4): coin-burst, ribbon-trail, circle-spawn, god-rays-sprite | `effects-fixtures/` (4) | `.effects-fixtures.lock` |
| **AnimationState** (ADR-0005) | `anim-state-rigs/anim-state-rig.json` | `anim-state-fixtures/` (4): discrete-flip, additive-layer, queue-loop-boundary, crossfade-fractions | `.anim-state-fixtures.lock` |
| **Slot** | `slot/scenes/` (4 scenes) x `slot/spins/` (6 spins) via `slot/sample-spec/` | `slot/expected/` (6 golden `PresentationTimeline`s) | `.slot.fixtures.lock` |

Plus two **cross-language golden corpora** under `src/cross-language/`. `seed-prng-crc-vectors.json`
(WP-5.5): golden vectors for `spinSeed` (FNV-1a-32), `hash32`, `instanceSeed`, the Mulberry32 stream,
and CRC-32/ISO-HDLC (including the CRC of each binary rig twin body); the TS, C#, and GDScript runtimes
must reproduce these bit for bit. `clip-geometry-vectors.json` (PP-B2, ADR-0012): the clipped output of
the Sutherland-Hodgman triangle clipper for a fixed set of (polygon, triangle-list) inputs (ring count,
per-ring source triangle and vertex count, positions, and barycentrics); all three runtimes must
reproduce the ring structure EXACTLY and the positions/barycentrics within the `VERTEX` tolerance.

Lock files are sha256 manifests over rig + spec + fixture + binary twin, keyed to the pinned
toolchain (`node-22.13.1-v8`).

The last two skeleton rigs are the PP-B1 coverage pair (conformance A.2): **rig-transform-modes**
exercises all five bone transform modes under a rotated, non-uniformly-scaled, reflected animated
parent, so every `worldFromParentByMode` branch (including the `noScaleOrReflection` reflection-removal
path) is observed in the per-bone world affine; **rig-blendmodes** carries the four slot blend modes on
four slots and animates each slot's color. To make the blend track observable, a fixture sample gained
an optional `slots` member (`{ slot, blendMode, color }` per captured slot): a rig's sample-spec opts in
with a `slots: [names]` list, so bone-only and mesh-only fixtures stay byte-identical. `blendMode` is a
discrete exact-compare lane; `color` rides the `COLOR` tolerance.

The last two skeleton rigs are the PP-B4 pair (Stage F1, ADR-0008): **rig-events-draworder** carries a
draw-order timeline that reorders three slots mid-clip plus event keys with resolved payloads, and
**rig-events-loop** fires events across a looping event-step sweep that crosses the loop boundary twice
(including a key exactly at the loop point). Two fixture lanes make them observable: a per-sample integer
`drawOrder` permutation (`drawOrder[renderPosition] = slotIndex`, EXACT compare), opted in with the
sample-spec's `captureDrawOrder`; and a fixture-level fired-event log (`events`, one record per fire with
name/int/string/time EXACT and float on the `EVENT_FLOAT` tolerance), produced by sweeping the
sample-spec's `eventStep`. Both lanes are emitted only when the spec opts in, so every pre-PP-B4 fixture
regenerates byte-identically. Together with the PP-B1 pair these close all four `a2-coverage` `it.todo`
entries.

The final two skeleton rigs are the PP-B5 pair (Stage F2, ADR-0009 + ADR-0010): **rig-ik-depth** drives
the IK constraint-depth solve (softness easing near full extension, uniform and non-uniform stretch beyond
reach, and compress inside the fold dead zone, on both one- and two-bone chains, plus a keyed softness
channel); **rig-constraint-order** assigns an explicit `order` that schedules a transform constraint before
an IK constraint on a dependent bone, an interleaving that provably differs from the default IK-then-
transform order. Both observe only the existing per-bone world-affine lane (no fixture-schema change), and
they add no lanes to any other rig, so every pre-PP-B5 fixture regenerates byte-identically.

**rig-transform-variants** (PP-B5 slice 2, ADR-0010 section 3) drives the four transform-constraint
variants: one constrained bone per variant (world absolute, local absolute, world relative, local
relative) under a rotated parent so the world and local results provably differ. It too observes only
the bone world-affine lane.

**rig-linked-mesh** (PP-B5 slice 4, ADR-0011 section 1) is a mesh plus two linked meshes that reuse its
geometry: one with `timelines: true` (its vertices track the parent's deform exactly) and one with
`timelines: false` (its own deform diverges). Observed on the existing mesh-vertex lane.

**rig-sequences** (PP-B5 slice 5, ADR-0011 section 2) resolves sequence-attachment frames across all seven
playback modes (hold, once, loop, pingpong, and the three reverses) plus the setup-frame fallback (a slot
with a sequence attachment but no `sequence` timeline). It is observed on a new per-sample `sequences` lane
(`{ slot, frame }` per captured slot, opted in with the sample-spec's `captureSequences`), compared EXACT
because the frame index is discrete integer math. The lane is emitted only when the spec opts in, so every
non-sequence fixture stays byte-identical.

**rig-split-tracks** (PP-B5 slice 6, ADR-0011 section 3) exercises the per-component split bone tracks
(translateX/Y, scaleX/Y, shearX/Y, observed on the bone world-affine lane, and unit-tested to equal the
joint channels), the split rgb/alpha slot color (observed on the existing slot color lane), and the keyable
two-color dark tint (observed on a new optional `dark` field of the slot capture, compared on the COLOR
tolerance). The dark field is emitted only for a slot with a setup `darkColor`, so pre-slice-6 slot captures
stay byte-identical.

**rig-skin-scoped** (PP-B5 slice 7, ADR-0011 section 4) locks skin-scoped constraint solving: a transform
constraint scoped to skin "gold" solves only while "gold" is active, while an unscoped one always solves.
It uses a new per-sample `activeSkins` sample-spec knob (parallel to `poseTimes`) to sample the same rig
under active skin null (scoped off) and "gold" (scoped on), observing the on/off difference on the bone
world-affine lane. Scoped bones are pure data with no transform-solve effect (ADR-0011 section 4).

The last two skeleton rigs are the PP-B2 pair (Stage 0, ADR-0012), locking the clipping / bounding-box /
point solve. **rig-clipping** animates a clip bone (moving the world clip polygon) whose `end` slot is a
deforming mesh, and carries a draw-order key that changes which slots the clip covers; a new per-sample
`clips` lane captures `{ slot, attachment, worldPolygon, clippedSlots }` (the world polygon on the
`VERTEX` tolerance, the clipped-slot name list EXACT). **rig-hit-point** carries a bounding box and a
point on a moving bone; a `boxes` lane captures `{ worldVertices, hits }` (world vertices on `VERTEX`,
per-probe even-odd hits EXACT against the spec's `hitProbes`) and a `points` lane captures
`{ x, y, rotation }` (position on `VERTEX`, rotation on the new `ANGLE` tolerance). The Sutherland-Hodgman
triangle clipper itself is locked cross-language by `clip-geometry-vectors.json` (above). All three lanes
are emitted only when the spec opts in, so every pre-PP-B2 fixture regenerates byte-identically.

## Structure

- `registry.ts`: the `RigId` union, ordered `RIG_IDS`, per-rig phase map, and `CONFORMANCE_PHASE`
  gating.
- `schema/`: Zod schemas and typed validators for rigs, sample specs, and every fixture shape.
- `build-fixture.ts`, `build-effects-fixture.ts`, `build-anim-state-fixture.ts`,
  `build-slot-fixture.ts`: PURE builders, (inputs, spec, provenance) to fixture, importing only
  `runtime-core`, `format`, and (for slot) `math-bridge` types. No clock, no random.
- `generate.ts` plus `generate-effects` / `generate-anim-state` / `generate-slot` scripts: the
  generator CLIs. Each refuses to run on a mismatched Node before writing anything.
- `io.ts`: the only filesystem module (path resolution, validating loaders, sha256).
- `compare/`: `tolerance.ts` (the SINGLE source of the epsilon policy) and the compare engines
  producing structured `DriftReport`s.
- `run-phase3-acceptance.ts`: the Phase 3 Definition-of-Done harness
  (`pnpm phase3:acceptance`, 11 checks).

## Tolerance policy (A.5)

Tight but nonzero (IEEE-754 arithmetic is not associative across V8, .NET, and GDScript). The
formula is `|actual - expected| <= atol + rtol * max(|actual|, |expected|)`:

| Class | atol | rtol |
|---|---|---|
| WORLD_TRANSLATION | 1e-4 | 1e-6 |
| WORLD_BASIS | 1e-6 | 1e-6 |
| VERTEX | 1e-4 | 1e-5 |
| COLOR | 1e-5 | 0 |
| EVENT_FLOAT | 1e-5 | 1e-6 |
| ANGLE | 1e-4 | 1e-6 |
| PARTICLE | 1e-4 | 1e-5 |
| PARTICLE_COLOR | 1e-5 | 0 |

Integer lanes (live counts, spawn order, frame indices, vertex counts) compare EXACT, as do slot
timelines (integer milliseconds and integer base units, plain deep-equal). Loosening a tolerance to
make a runtime pass is forbidden; that is a solve bug by definition.

## Regenerating fixtures (the A.6 ceremony)

Fixtures are generated FROM `runtime-core` and committed. Regeneration is a deliberate, reviewed
act behind the behavior-change gate (the `behavior-change` label, CODEOWNERS on `fixtures/**`, an
ADR or CHANGELOG entry). Never hand-edit a fixture.

```sh
# Use the PINNED Node (fixtures store V8-computed floats as exact JSON; the drift gate is a
# byte-exact git diff, so the generation toolchain must match .node-version exactly).
nvm use "$(cat .node-version)"   # 22.13.1
pnpm --filter @marionette/conformance generate            # skeleton track
pnpm --filter @marionette/conformance generate:effects
pnpm --filter @marionette/conformance generate:anim-state
pnpm --filter @marionette/conformance generate:slot
pnpm --filter @marionette/conformance exec tsx scripts/gen-clip-geometry-vectors.mts  # PP-B2 clipper golden
```

The drift gate regenerates and runs `git diff --exit-code` over the rig/spec/fixture trees: any
solve-behavior change in `runtime-core` without regenerated fixtures fails CI.

## Tests

```sh
pnpm --filter @marionette/conformance test               # all tracks
pnpm phase3:acceptance                                   # the Phase 3 DoD harness (from repo root)
pnpm conformance:particles                               # the effects fixture suite (from repo root)
```

Notable suites: the independent closed-form **oracle** for rig-2bone (`test/oracle.test.ts`, so the
first fixture generation was checked against hand-computed values, not merely frozen), in-memory
round-trip regeneration per track, `phase2-rigs`, `phase3-effects`, `phase3-perf-gates`,
`phase4-slot`, `anim-state`, `binary-twins` (WP-5.1), `cross-language-vectors` (WP-5.5),
`clip-geometry-vectors` (PP-B2, the clipper golden drift tripwire), `geometry-attachments` (PP-B2
clip/box/point observability coverage), and the `a2-coverage` meta-test that gates every solve branch
the current fixture schema observes (the unobserved branches are pending `it.todo` entries by design).

The tolerance-based tests pass on any modern Node; only the byte-exact drift gate and lock files
are toolchain-sensitive and must run on the pin.
