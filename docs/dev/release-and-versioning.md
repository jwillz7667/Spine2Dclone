# Release and Versioning

How versions work in this repository, what gates a change, and where the release pipeline stands.

## The version lines (they are independent)

| Line | Where | Current | Policy |
|---|---|---|---|
| Skeleton format (`formatVersion`) | `packages/format/src/version/constants.ts` | `0.3.0` | `format-contract.md` section 10 |
| Effects format (`effectsFormatVersion`) | same file | `1.0.0` | same document |
| Slot-scene format | same file | `0.1.0` | same document |
| Shared format primitives | same file | `1.0.0` | frozen; a change here is a MAJOR event |
| Boundary contract (math engine) | `packages/math-bridge/src/version.ts` | `1.0.0` | additive changes only without a bump |
| MRNT container version | `packages/format/src/binary/` | `1` | new container features bump it |
| App / package versions | root and workspace `package.json` | `0.0.0` | set by the release pipeline (WP-5.7) |

The format version is the semver of THE FORMAT, deliberately independent of the app version: a
document written today must load in every future app version that supports its MAJOR (with
migrations), regardless of app release cadence.

## Changing the format (the expensive thing, LAW 3)

1. Classify the change MAJOR/MINOR/PATCH per `docs/plan/cross-cutting/format-contract.md`
   section 10. Pre-1.0, a breaking skeleton-format change bumps MINOR.
2. Bump the right constant in `version/constants.ts`, write the migration step in
   `src/version/migrations/`, test it (the registry holds `0.1.x -> 0.2.0` and `0.2.x -> 0.3.0`
   as the pattern to follow), and add a `CHANGELOG.md` entry in the format package.
3. A non-schema change (validator refactor, error wording, comments) must NOT bump the version.
4. CI enforces both directions: `check:format-semver` fails a PR that touches
   `packages/format/src` without touching the constants file, and `check:format-version-stable`
   fails an unjustified bump.
5. Format changes that alter solve semantics also regenerate conformance fixtures in the same PR
   behind the behavior-change gate.

The next planned format change is the 0.4.0 MINOR bump (stage F2 of
`docs/plan/pro-parity-execution-plan.md`: constraint depth, linked meshes, sequences,
per-component curves, two-color tint, skin-scoped bones/constraints). 0.3.0 (events, draw-order
timelines, metadata) landed with ADR-0008.

## Changing solve behavior

Any change that alters numeric output of the per-frame solve, the effects simulation, or the slot
sequencer requires regenerating the affected conformance fixtures on the pinned Node (22.13.1) in
the same PR, under the `behavior-change` label with CODEOWNERS review on `fixtures/**` and an ADR
or CHANGELOG entry. Drift without regeneration fails CI by design.

## Toolchain pins

- Node `22.13.1` (`.node-version`): the fixture-generation toolchain. Bumping it is a deliberate
  act that regenerates every byte-locked artifact (fixtures, lock manifests, golden PNGs) in one
  reviewed PR.
- pnpm `11.8.0` (`packageManager`): bump together with a green `pnpm ci:local` and lockfile diff
  review.
- Dependency policy: exact pins for load-bearing runtime deps (`zod`, `@noble/hashes`,
  `pixi.js 8.19.0`), caret ranges elsewhere, `--frozen-lockfile` in CI, weekly audit review.

## Commit and branch conventions

Conventional Commits enforced by commitlint in CI (`feat:`, `fix:`, `refactor:`, `perf:`,
`test:`, `docs:`, `chore:`, `build:`, `ci:`; imperative subject <= 72 chars; body explains why).
One logical change per commit; a refactor and a behavior change never share one. Branches:
`feat/<slug>`, `fix/<ticket>-<slug>`; one subsystem per branch; a phase branch does not open until
its predecessor milestone is green (LAW 5).

## The release pipeline (status: not built yet)

Phase 5 WP-5.7 owns it. Today `pnpm --filter editor build` produces an electron-vite bundle but no
installer; there is no code signing, notarization, or auto-update. The planned pipeline: signed
macOS (arm64 + x64) and Windows artifacts, notarization, an integrity-checked update feed, and a
GitHub Actions release workflow keyed to tags, gated on the full `ci-pass` set plus (once native
runtimes exist) `conformance-native-pass`. The two-edition split (Essentials/Pro) is a Phase 4/5
packaging concern tracked in `docs/plan/product-editions.md`; no edition gating exists in code yet,
deliberately.

## Definition of a shippable build (Phase 5 exit)

One full game authored in Armature 2D, exported, and played back with conformance parity on web
and Unity, from a signed build produced by the release pipeline. Until then, every merge to `main`
keeps the headless acceptance harnesses green so the eventual release is an artifact of routine,
not a heroic integration.
