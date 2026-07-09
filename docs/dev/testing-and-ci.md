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

## Native conformance (`.github/workflows/conformance-native.yml`)

ACTIVE (PP-E3, WP-5.5). Runs on PRs touching runtime/format/runtime-core/conformance paths, pushes
to `main`, and a nightly cron. All jobs run for real now that both native runtimes are landed:

| Job | Runs |
|---|---|
| `cross-language-equivalence` | `@marionette/conformance` seed/PRNG/CRC vectors + binary-twin CRCs (also part of the main `test` job) |
| `detect-runtimes` | directory probe exposing `unity` / `godot` presence to the engine jobs |
| `conformance-unity` | `dotnet test runtimes/unity --nologo`: the shared C# solve core (ADR-0001), no Unity editor, no GameCI |
| `conformance-godot` | pinned official Godot 4.6.3-stable Linux build (SHA256-verified, cached by version), run headless via `runtimes/godot/tests/run.sh` with its PASS-sentinel guard |
| **`conformance-native-pass`** | aggregate: fails if any native job failed or was cancelled; a genuinely skipped engine job (runtime absent) counts as success |

The Unity job is `dotnet test`, not a Unity-editor batchmode run, because the solve is one
engine-agnostic C# library (netstandard2.1, zero `UnityEngine`) that Unity and Godot render over
(ADR-0001); a plain net8.0 xUnit project exercises the entire cross-language solve contract with no
license and no editor. The Unity-editor smoke test (the MonoBehaviour view layer renders a frame)
belongs to the later PP-E1 view-layer slice and is a separate non-blocking job.

The Godot job runs the real `godot --headless` engine path (not a bare console): it downloads the
pinned build, verifies its SHA256 (which cross-checks against Godot's official SHA512-SUMS.txt),
caches it via `actions/cache` keyed on the version, then runs the harness through `run.sh`, which
treats a MISSING `GODOT_CONFORMANCE_RESULT: PASS` sentinel as a failure (Godot exits 0 on a script
parse error, so a broken harness would otherwise look green).

### Required checks (TASK-5.5.6)

This repo has TWO required status checks, configured per-repo in branch protection or a ruleset (they
cannot be set from workflow YAML): `ci-pass` (ci.yml, every PR and push) AND `conformance-native-pass`
(this workflow). They stay separate workflows on purpose: the engine jobs are heavier (a dotnet
restore, a pinned Godot download) and only a runtimes/format/runtime-core/conformance change can move
native conformance, so the native workflow is path-filtered plus nightly rather than run on every
docs-only PR. Because it is path-filtered, a PR touching none of those paths does not start the
workflow, so `conformance-native-pass` is not reported on it; resolve the resulting required-check
wait per GitHub's documented skipped-but-required pattern (a companion no-op job of the same name on
the inverse path filter) or a ruleset that treats a not-triggered workflow as satisfied.

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
