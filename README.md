# Armature 2D

Proprietary software. Copyright (c) 2026 Viral Ventures LLC, Maple Grove, Minnesota.
All rights reserved; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Not open source.

Armature 2D (internal codename Marionette) is a desktop authoring tool (Electron + React + PixiJS
v8) that produces the full visual presentation of top-tier 2D slot games: a skeletal animation
editor (a Spine-equivalent built from first principles), a particle/VFX subsystem, and a slot
composition layer. It exports one portable data format that web, Unity, and Godot runtimes play
back. A pre-existing certified math engine drives outcomes; Armature 2D authors presentation only.

Two control surfaces drive the exact same command layer: the desktop GUI, and a headless MCP
server exposing all 143 authoring tools so an AI agent or script can build, inspect, render, and
save everything a person can, with the same undo history.

The product is planned to ship in two editions, Essentials and Pro; the tier split is tracked for
Phase 4/5 in `docs/plan/product-editions.md`. Package names keep the `@marionette` codename scope
for now (the deep package rename is deferred to its own change).

## Documentation

The portal is [`docs/README.md`](docs/README.md). Highlights:

- **User manual** (rigging, animation, VFX, slots, export, the full tool and format references):
  [`docs/manual/README.md`](docs/manual/README.md)
- **Developer docs** (architecture, setup, testing/CI, security, releasing, troubleshooting):
  [`docs/dev/`](docs/dev/)
- **Contributing** (workflow and the Definition of Done): [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Spec and plan of record**: `MARIONETTE_HANDOFF.md` (authoritative spec), `docs/DEV_PLAN.md`
  (roadmap, status), `docs/plan/` (per-phase plans and cross-cutting contracts), `docs/adr/`
  (decision records), `CLAUDE.md` (the enforced laws and conventions)
- **Per-package references**: a README in every workspace (see the portal for the list)

## Status (see `docs/DEV_PLAN.md` section 9 for the tracker)

Phases 0 to 4 (foundations, bone puppet, rigging, VFX/particles, slot composer) are complete and
green in CI-verifiable form: the document model, the 100-command layer with exact undo, the
deterministic solve, the effects and slot runtimes, the `math-bridge` engine boundary, the MCP
control surface, and the four-track conformance suite. Phase 5 (production hardening) is in
progress: the headless spine is landed (MRNT binary codec, export-profile core, cross-language
determinism vectors, texture-variant selection); the Unity/Godot native runtimes, device
profiling, and the signed release pipeline are the remainder. The authoring GUI intentionally
trails the finished backend and is being completed in phase order; where a panel is still landing,
the MCP tools are the complete interface. The verified gap map against Spine Pro is
`docs/audit/spine-pro-parity-audit.md`.

## Repository layout

```
apps/
  editor/          # Electron + React + PixiJS authoring app
packages/
  format/          # THE CONTRACT: Zod schemas, validators, hashing, migrations, MRNT binary
  runtime-core/    # platform-agnostic solve (skeleton, effects, slot); behavioral source of truth
  runtime-web/     # TS + PixiJS v8 playback; also powers the editor viewport
  document-core/   # DocumentModel + commands + History, shared by GUI and MCP (ADR-0001)
  mcp-server/      # headless MCP control surface (143 tools over stdio)
  render-preview/  # deterministic CPU rasterizer -> PNG for headless render feedback
  atlas-pack/      # deterministic sprite-atlas packing pipeline
  math-bridge/     # SpinResult contract + validator + mock engine + real-engine adapter
  conformance/     # reference rigs, committed fixtures, drift gates, cross-language vectors
tools/             # repo guards (package allowlist, dash ban, format semver) + lint guard tests
docs/              # portal, user manual, developer docs, plan of record, ADRs
demo/              # sample productions built with the tool
```

Dependency direction is machine-enforced (ESLint boundaries plus guard tests); `runtime-core` and
`format` carry no PixiJS, no DOM, and no Node built-ins. The full graph is in
[`docs/dev/architecture.md`](docs/dev/architecture.md).

## Prerequisites

- Node 22 LTS, pinned in `.node-version` (22.13.1, the exact patch used to generate fixtures).
- pnpm 11.8.0 via the root `packageManager` field (enable with `corepack enable`).

## Quickstart

```bash
pnpm install                # from the committed lockfile
pnpm ci:local               # typecheck + lint + test + build + package guard + dash guard
pnpm --filter editor dev    # launch the editor (hierarchy/viewport/inspector/timeline panels)

# headless authoring (MCP over stdio; sandboxed to the given project root)
pnpm --filter @marionette/mcp-server build
node packages/mcp-server/dist/cli.js <projectRoot>
```

## CI

`.github/workflows/ci.yml` runs typecheck, lint (including the dash guard), tests, build, the
format semver gates, the package allowlist guard, the Phase 3 acceptance harness, and commitlint;
a single `ci-pass` job aggregates the required checks. `conformance-native.yml` already runs the
cross-language determinism vectors and is scaffolded for the Unity/Godot runtimes. Details:
[`docs/dev/testing-and-ci.md`](docs/dev/testing-and-ci.md).

## The five laws (a reviewer rejects any PR that breaks one)

1. Math / presentation boundary: presentation is a pure function of a `SpinResult`; it never
   decides outcomes.
2. All document mutations are commands (do / undo, coalescing); the round-trip test is mandatory.
3. The format is the contract: validate on import, fail loudly, version with semver.
4. Legal boundary on Spine: first-principles skeletal animation, our own format, no Spine source;
   the only sanctioned contact with Spine's formats is the clean-room import-only migration path
   (PP-A5 in the parity plan).
5. Phase independence: each phase ships a usable artifact; build in order.
