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
| **Skeleton** | `rigs/` (7 rigs, each committed as `.json` AND a binary `.bin` twin): rig-2bone, rig-rigid-mesh, rig-weighted-mesh, rig-one-bone-ik, rig-two-bone-ik, rig-transform-constraint, rig-deform | `fixtures/` (7, driven by `sample-spec/`) | `.fixtures.lock` |
| **Effects / particles** | `effects-rigs/` (4): coin-burst, ribbon-trail, circle-spawn, god-rays-sprite | `effects-fixtures/` (4) | `.effects-fixtures.lock` |
| **AnimationState** (ADR-0005) | `anim-state-rigs/anim-state-rig.json` | `anim-state-fixtures/` (4): discrete-flip, additive-layer, queue-loop-boundary, crossfade-fractions | `.anim-state-fixtures.lock` |
| **Slot** | `slot/scenes/` (4 scenes) x `slot/spins/` (6 spins) via `slot/sample-spec/` | `slot/expected/` (6 golden `PresentationTimeline`s) | `.slot.fixtures.lock` |

Plus the **cross-language integer-determinism corpus**
`src/cross-language/seed-prng-crc-vectors.json` (WP-5.5): golden vectors for `spinSeed` (FNV-1a-32),
`hash32`, `instanceSeed`, the Mulberry32 stream, and CRC-32/ISO-HDLC (including the CRC of each
binary rig twin body). The TS runtime, the future C# runtime, and the future GDScript runtime must
reproduce these bit for bit.

Lock files are sha256 manifests over rig + spec + fixture + binary twin, keyed to the pinned
toolchain (`node-22.13.1-v8`).

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
`phase4-slot`, `anim-state`, `binary-twins` (WP-5.1), `cross-language-vectors` (WP-5.5), and the
`a2-coverage` meta-test that gates every solve branch the current fixture schema observes (the
unobserved branches are pending `it.todo` entries by design).

The tolerance-based tests pass on any modern Node; only the byte-exact drift gate and lock files
are toolchain-sensitive and must run on the pin.
