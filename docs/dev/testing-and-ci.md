# Testing and CI

The testing strategy, the suites that exist, and exactly what CI gates. The authoritative design is
`docs/plan/cross-cutting/conformance-and-ci.md`; this is the engineer-facing summary of what is
implemented today.

## The pyramid

1. **Unit tests (Vitest, colocated per workspace).** Pure functions, solvers, schema validators,
   panel logic. Roughly 2,100+ tests across the ten workspaces (the parity audit of 2026-07-02
   counted 2,130 passing with 4 `it.todo` placeholders).
2. **Contract and harness tests.** The mandatory machinery that keeps the laws true:
   - The **do/undo round-trip harness** (`packages/document-core/test/round-trip.harness.test.ts`
     plus the effects mirror): every one of the 100 registered commands, against every applicable
     seed document, must produce a bit-exact prior state on undo and a bit-exact post-do state on
     redo, with document invariants asserted after every step.
   - **Discovery guards**: every `*.command.ts` file must be registered exactly once.
   - **Lint guard tests** (`tools/lint-checks/lint-guard.test.ts`): load the real ESLint config
     and prove each architectural ban fires on an injected violation (no PixiJS in core, no `any`
     in format, barrel-only imports, determinism bans). A ban that cannot be shown to fire does
     not count as enforced.
   - **Negative format fixtures** named by the exact error code they must produce (20 skeleton,
     14 effects, 15 slot).
3. **Conformance (behavioral truth).** Committed fixtures generated from `runtime-core` across
   four tracks (skeleton, effects, AnimationState, slot), compared within the single pinned
   tolerance policy, plus the closed-form oracle, binary rig twins, and the cross-language
   seed/PRNG/CRC vectors. See `packages/conformance/README.md`.
4. **Acceptance harnesses.** `pnpm phase3:acceptance` (11 checks) and the Phase 4 golden-playback
   determinism lock exercise each phase's Definition of Done headlessly.
5. **Byte-exact golden gates.** runtime-core golden fixtures, render-preview golden PNGs, MRNT
   binary twins. Regeneration is deliberate and reviewed, never incidental.

## What is NOT covered headlessly (known, tracked)

WebGL pixel parity, the live real-engine acceptance step, and the byte-exact fixture-determinism
gate on the pinned Node are not exercisable in a headless container. They are covered by
pure-logic parity tests (for example `runtime-web/test/headless-sample-playback.test.ts`),
tolerance tests, and the committed goldens instead; the formal human sign-off per phase plan is a
manual step. There are no GUI e2e tests yet.

## CI (`.github/workflows/ci.yml`)

Triggers on every PR and push to `main`; superseded PR runs are cancelled. Every job runs on
ubuntu-latest with Node from `.node-version` (22.13.1), pnpm from `packageManager` (11.8.0), pnpm
store caching, and `pnpm install --frozen-lockfile`.

| Job | Runs |
|---|---|
| `typecheck` | `pnpm typecheck` |
| `lint` | `pnpm lint` + `pnpm format:check` + `pnpm check:dashes` |
| `test` | `pnpm test` (includes lint guard tests and cross-language vectors) |
| `build` | `pnpm build` |
| `format-semver` | `check:format-semver` + `check:format-version-stable` (full history fetch) |
| `package-guard` | `check:packages` (LAW 5 allowlist) |
| `phase3-acceptance` | `conformance:particles` then `phase3:acceptance` |
| `commitlint` | Conventional Commits (PR only) |
| **`ci-pass`** | the single required status: fails if any needed job failed or was cancelled |

`ci-pass`'s dependency set grows per phase per `conformance-and-ci.md`; never merge red CI.

## Native conformance scaffold (`.github/workflows/conformance-native.yml`)

Prepared for Phase 5 (WP-5.5). Runs on PRs touching runtime/format/conformance paths, pushes to
`main`, and a nightly cron. Live today: `cross-language-equivalence` (the seed/PRNG/CRC vectors and
binary-twin suites, also part of the main `test` job). Gated off until the runtimes exist:
`conformance-unity`, `conformance-godot`, `conformance-core-fast`, each auto-detected by directory
probe. Its `conformance-native-pass` aggregate joins `ci-pass` when the first native runtime lands
(TASK-5.5.6).

## Local mirror

```sh
pnpm ci:local   # typecheck + lint + test + build + check:packages + check:dashes
```

Run it before pushing. For fixture work, also regenerate on the pinned Node and confirm
`git diff` is empty (or intended and gated).

## Writing tests here

- Name by behavior: `it("returns 409 when email already exists")` style, not implementation.
- Arrange/Act/Assert with blank-line separation; one assertion concept per test.
- A new command is not done without its round-trip case (the harness picks it up via the registry,
  but it needs an applicable seed and a non-trivial representative delta).
- A new format rule is not done without a negative fixture asserting its exact error code.
- A solve change is not done without regenerated fixtures in the same PR.
- Determinism claims get a determinism test (same inputs twice, deep-equal or byte-equal), and hot
  loops get allocation probes where the pattern exists (`runtime-core/test/determinism.test.ts`).
