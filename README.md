# Armature 2D

Armature 2D (internal codename Marionette) is a desktop authoring tool (Electron + React + PixiJS
v8) that produces the full visual presentation of top-tier 2D slot games: a skeletal animation
editor (a Spine-equivalent built from first principles), a particle/VFX subsystem, and a slot
composition layer. It exports one portable data format that web, Unity, and Godot runtimes play
back. A pre-existing certified math engine drives outcomes; Armature 2D authors presentation only.

The product is planned to ship in two editions, Essentials and Pro; the tier split is tracked for
Phase 4/5 and is documented in `docs/plan/product-editions.md`. Package names keep the `@marionette`
codename scope for now (the deep package rename is deferred to its own change).

The authoritative spec is `MARIONETTE_HANDOFF.md`. The plan of record lives in `docs/plan/`, with
the master index and dependency graph in `docs/DEV_PLAN.md`. Project laws and conventions are in
`CLAUDE.md`. The user manual (creating animations with the program: rigging, animation, VFX,
composition, playback, plus the complete tool and format references) is `docs/manual/README.md`.

## Status

Phase 0 (Foundations) and Phase 1 (Bone puppet, Tier 0) are complete and green. Phase 2 (Rigging)
adds mesh deform, linear blend skinning, weight painting, analytic IK, transform constraints, named
skins, and deform timelines. See `docs/plan/phase-2-rigging.md` for the work-package breakdown and
`docs/DEV_PLAN.md` for the phase roadmap.

Launch the editor shell in development:

```bash
pnpm --filter editor dev      # opens the window with the hierarchy/viewport/inspector panels
```

## Repository layout

```
packages/
  format/          # Zod-sourced types + validators + content hashing (the shared contract)
  runtime-core/    # platform-agnostic solve (TS, no PixiJS); behavioral source of truth
  runtime-web/     # TS + PixiJS playback; also powers the editor viewport
apps/
  editor/          # Electron main / preload / renderer (renderer hosts the editor UI)
tools/             # repo guards (package guard, dash guard, format-semver) + lint guard tests
docs/              # plan of record and cross-cutting contracts
```

Dependency direction is machine-enforced: `format` <- `runtime-core` <- `runtime-web` <-
`apps/editor`. `runtime-core` and `format` carry no PixiJS, no DOM, and no Node built-ins.

## Prerequisites

- Node 22 LTS (pinned in `.node-version` to the exact patch used to generate fixtures).
- pnpm (pinned via the root `package.json` `packageManager` field; enable with `corepack enable`).

## Quickstart

```bash
pnpm install        # install the workspace from the committed lockfile
pnpm typecheck      # tsc --noEmit across every package (TS strict)
pnpm lint           # ESLint flat config: boundaries, platform-agnostic core, INV-6 dashes
pnpm test           # Vitest unit suites (incl. the boundary lint guard tests)
pnpm build          # tsc build for the libraries; editor bundle lands in WP-0.2
```

Convenience aggregate (mirrors the CI required checks):

```bash
pnpm ci:local       # typecheck + lint + test + build + package guard + dash guard
```

## CI

`.github/workflows/ci.yml` runs typecheck, lint (plus the em-dash guard), unit tests, build, the
format semver gate, and the Phase-0 forbidden-package guard. A single `ci-pass` job aggregates the
required checks; its dependency set grows per phase per `docs/plan/cross-cutting/conformance-and-ci.md`.

## The five laws (a reviewer rejects any PR that breaks one)

1. Math / presentation boundary: presentation is a pure function of a `SpinResult`; it never
   decides outcomes.
2. All document mutations are commands (do / undo, coalescing); the round-trip test is mandatory.
3. The format is the contract: validate on import, fail loudly, version with semver.
4. Legal boundary on Spine: first-principles skeletal animation, our own format, no Spine source.
5. Phase independence: each phase ships a usable artifact; build in order.
