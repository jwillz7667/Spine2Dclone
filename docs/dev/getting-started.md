# Developer Getting Started

How to set up, build, run, and verify the Armature 2D monorepo. For using the product (rigging,
animating, exporting) read the user manual instead: `docs/manual/README.md`.

## Prerequisites

- **Node 22.13.1** exactly (`.node-version`). The conformance fixtures store V8-computed floats as
  exact JSON and the drift gate diffs bytes, so fixture generation must run on this pin. Everyday
  dev and the tolerance-based tests pass on any Node >= 22.13.0 (`engines`), but use the pin to
  stay honest: `nvm use "$(cat .node-version)"` or your version manager's equivalent.
- **pnpm 11.8.0**, pinned via the root `package.json` `packageManager` field. Enable with
  `corepack enable`; do not install a global pnpm of a different major.
- macOS (arm64 or x64), Windows, or Linux. The editor targets macOS and Windows; headless work
  (everything except `pnpm --filter editor dev`) runs anywhere including CI containers.

## Install and verify

```sh
git clone <repo> && cd Spine-clone
corepack enable
pnpm install                # from the committed lockfile; electron/esbuild are the only allowed build scripts
pnpm ci:local               # typecheck + lint + test + build + package guard + dash guard
```

`pnpm ci:local` mirrors the required CI checks. A fresh clone on the pinned toolchain must pass it
before you change anything.

## Everyday commands

```sh
pnpm typecheck              # tsc --noEmit across every workspace (TS strict everywhere)
pnpm lint                   # ESLint flat config: boundaries, core purity bans, the dash rule
pnpm test                   # vitest across all workspaces (includes the lint guard tests)
pnpm build                  # tsc builds for libraries; electron-vite bundle for the editor
pnpm --filter <pkg> test    # one workspace, e.g. @marionette/runtime-core
pnpm phase3:acceptance      # the Phase 3 Definition-of-Done harness (11 checks)
pnpm conformance:particles  # the effects conformance suite
pnpm check:packages         # LAW 5: only sanctioned packages exist
pnpm check:dashes           # INV-6: no em/en dashes in docs, code, or UI copy
pnpm check:format-semver    # LAW 3: format source changes require a version-constant change
```

## Running the editor

```sh
pnpm --filter editor dev    # Electron with Vite HMR (relaxed dev CSP)
pnpm --filter editor build  # production bundle to apps/editor/out/
pnpm --filter editor start  # preview the production bundle
```

There is no installer/packaging step yet (Phase 5 WP-5.7).

## Running the MCP server (headless authoring)

```sh
pnpm --filter @marionette/mcp-server build
node packages/mcp-server/dist/cli.js <projectRoot>
```

Register it in an MCP host to drive all 142 authoring tools; see
`packages/mcp-server/README.md` and the tool reference `docs/manual/09-tool-reference.md`. All
file access is sandboxed to `<projectRoot>`.

## Repository orientation

Read in this order:

1. `README.md` then `docs/README.md` (the documentation portal).
2. `CLAUDE.md`: the five laws, the solve order, the document/editor state wall, the Definition of
   Done. These are enforced by lint and CI, not convention.
3. `docs/dev/architecture.md`: the system map and dependency direction.
4. `docs/DEV_PLAN.md`: phase status and what is being built next.
5. The cross-cutting contract for whatever layer you are touching
   (`docs/plan/cross-cutting/format-contract.md`, `command-history.md`, `conformance-and-ci.md`).

## Making a change (the short version)

The full workflow, Definition of Done, and commit conventions are in `CONTRIBUTING.md`. The three
rules newcomers trip on:

1. **Never mutate a document directly.** Add or reuse a command in
   `packages/document-core`; the discovery guard requires a registry entry and the round-trip
   harness requires do/undo coverage.
2. **Never edit a conformance fixture by hand.** If you changed solve behavior on purpose,
   regenerate on the pinned Node in the same PR and go through the behavior-change gate.
3. **Never change `packages/format` without the checklist.** Schema or semantic changes bump the
   right version constant with a tested migration; CI rejects the PR otherwise.

## Environment variables

The product needs none. Optional integrations:

- `MARIONETTE_REMBG_BIN`: absolute path to a rembg binary; enables background removal during
  editor atlas import (`apps/editor/src/main/atlas/rembg.ts`). Absent means the feature is off and
  imports proceed without it.
