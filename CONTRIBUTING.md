# Contributing to Armature 2D

Internal engineering guide for Viral Ventures LLC staff and contractors (contributions are
work-for-hire under the repository LICENSE). Setup and everyday commands:
`docs/dev/getting-started.md`. This document is the workflow and the bar a change must clear.

## The five laws

A reviewer rejects any PR that breaks one; full text in `CLAUDE.md`.

1. Presentation is a pure, deterministic function of a `SpinResult`; it never influences outcome.
2. Every document mutation is a Command with do/undo through History; there is no other path.
3. The format is the contract: validated on import, typed errors, semver with tested migrations.
4. First-principles skeletal animation: no Spine source, no Spine format compatibility claims.
5. Build in phase order; each phase ships a usable artifact; do not skip ahead.

## Workflow

1. **Find the work in the plan.** `docs/DEV_PLAN.md` section 9 is the status tracker; the active
   phase plan owns the work-package IDs and acceptance criteria. Work that exists in no plan
   document enters through the plan (and an ADR if architectural), not ad hoc.
2. **Branch** from `main`: `feat/<slug>` or `fix/<ticket>-<slug>`. One subsystem per branch.
3. **Read the owning contract first** when touching the format
   (`docs/plan/cross-cutting/format-contract.md`), commands (`command-history.md`), or anything
   affecting solve behavior or CI (`conformance-and-ci.md`).
4. **Make the change with its tests in the same commit.** Refactor and behavior change never
   share a commit.
5. **Run `pnpm ci:local`** (mirrors the required CI checks) before pushing.
6. **Open a small, reviewable PR** with a test plan. `ci-pass` must be green; never merge red CI.
   Verify the branch merges cleanly into `main` before requesting review.

## Commits

Conventional Commits, enforced by commitlint in CI: `feat:`, `fix:`, `refactor:`, `perf:`,
`test:`, `docs:`, `chore:`, `build:`, `ci:`, optional scope (`feat(auth): ...`). Imperative
subject of at most 72 characters; the body explains why, not what. One logical change per commit.

## Definition of Done (the enforced checklist)

The authoritative list lives in `CLAUDE.md` and is machine-enforced where possible. In summary, a
PR is mergeable only when all of these hold:

- Every document mutation goes through a registered Command; mutators stay package-internal.
- Every new or changed command has a green do/undo round-trip test; coalescing commands cover the
  merged sequence (one undo restores the pre-interaction state; different targets never merge).
- The boundary lints pass AND their guard tests prove the bans fire (no PixiJS in core, barrel-only
  imports, inward layer direction, the package allowlist).
- TypeScript strict everywhere; no `any` and no unjustified `as` in `format`, `runtime-core`, or
  `math-bridge`.
- Every external boundary validates input and fails loudly with a typed error, with at least one
  negative test asserting the exact error code.
- Format changes follow the semver policy with a tested migration and CHANGELOG entry; non-schema
  changes do not bump the version.
- No per-frame allocation in solve or render loops; pool particles, sprites, and mesh buffers.
- Solve-behavior changes regenerate conformance fixtures in the same PR, on the pinned Node
  (22.13.1), behind the `behavior-change` label and fixtures CODEOWNERS review.
- The math boundary stays intact: presentation code never reads RNG or decides an outcome.
- No em-dashes or en-dashes anywhere (docs, comments, UI copy); `pnpm check:dashes` is green.

## Adding things (common recipes)

- **A new command**: `*.command.ts` in the right family, a registry entry, round-trip coverage
  (the discovery guard fails CI if any of the three is missing), and, if it should be reachable
  headlessly, an MCP tool in `packages/mcp-server` with a family test.
- **A new format rule**: schema or validator change + version classification + negative fixture
  named by the exact error code + (if semantic) migration and CHANGELOG.
- **A new package**: does not happen casually. It enters through the plan of record and updates
  `tools/check-packages.mjs` plus the ESLint boundaries config in the same PR.
- **An architectural decision**: `docs/adr/NNNN-title.md` (context, decision, consequences)
  before the code lands.

## Documentation

Every workspace keeps its README accurate (purpose, public surface, commands, invariants). A
change that makes any README, manual chapter, or dev doc stale updates it in the same PR. Docs
follow the same dash rule as code.
