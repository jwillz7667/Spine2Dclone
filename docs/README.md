# Armature 2D Documentation

The documentation portal. Armature 2D (internal codename Marionette) is proprietary software of
Viral Ventures LLC; see the repository `LICENSE` and `NOTICE`.

## Start here

| You are | Read |
|---|---|
| Using the product (rigging, animating, VFX, slots, export) | The user manual: [`manual/README.md`](manual/README.md) |
| A new engineer on the codebase | [`dev/getting-started.md`](dev/getting-started.md), then [`dev/architecture.md`](dev/architecture.md) |
| An AI agent or script author driving the MCP surface | [`../packages/mcp-server/README.md`](../packages/mcp-server/README.md) and the tool reference [`manual/09-tool-reference.md`](manual/09-tool-reference.md) |
| Deciding what to build next | [`DEV_PLAN.md`](DEV_PLAN.md) (status tracker section 9), then the active phase plan |

## Developer documentation (`dev/`)

| Document | Contents |
|---|---|
| [`dev/getting-started.md`](dev/getting-started.md) | Toolchain, install, build, run, everyday commands, env vars |
| [`dev/architecture.md`](dev/architecture.md) | The system map: packages, dependency direction, data flow, determinism strategy, where behavior is pinned |
| [`dev/testing-and-ci.md`](dev/testing-and-ci.md) | The test pyramid, the harnesses, exactly what CI gates |
| [`dev/security.md`](dev/security.md) | Trust boundaries: file input, Electron hardening, IPC, MCP sandboxing, supply chain |
| [`dev/release-and-versioning.md`](dev/release-and-versioning.md) | Format semver policy, toolchain pins, commit conventions, release pipeline status |
| [`dev/troubleshooting.md`](dev/troubleshooting.md) | Known failure modes and fixes |

Contribution workflow and the Definition of Done: [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## User manual (`manual/`)

Ten chapters from first launch through the complete tool and format references; the index is
[`manual/README.md`](manual/README.md).

## Governance and planning

| Document | Owns |
|---|---|
| [`../MARIONETTE_HANDOFF.md`](../MARIONETTE_HANDOFF.md) | The authoritative product spec |
| [`../CLAUDE.md`](../CLAUDE.md) | The five laws, the solve order, the state wall, the enforced Definition of Done |
| [`DEV_PLAN.md`](DEV_PLAN.md) | Master index: roadmap, dependency graph, milestone gates, status, glossary |
| [`plan/`](plan/) | The plan of record: one document per phase (0 to 5) plus `product-editions.md` |
| [`plan/cross-cutting/`](plan/cross-cutting/) | The contracts spanning phases: `format-contract.md`, `command-history.md`, `conformance-and-ci.md`, `mcp-control-surface.md` |
| [`adr/`](adr/) | Architecture decision records (0001 to 0007) |
| [`audit/spine-pro-parity-audit.md`](audit/spine-pro-parity-audit.md) | The verified Spine-parity gap map driving the current execution order |
| [`plan/pro-parity-execution-plan.md`](plan/pro-parity-execution-plan.md) | The five-lane parallel execution program that closes the audit's remaining gaps |

## Package references

Each workspace has a README documenting its purpose, public surface, invariants, and commands:

- [`packages/format`](../packages/format/README.md), the data contract
- [`packages/runtime-core`](../packages/runtime-core/README.md), the platform-agnostic solve
- [`packages/runtime-web`](../packages/runtime-web/README.md), PixiJS playback
- [`packages/document-core`](../packages/document-core/README.md), commands and history
- [`packages/mcp-server`](../packages/mcp-server/README.md), the headless control surface
- [`packages/render-preview`](../packages/render-preview/README.md), the CPU preview rasterizer
- [`packages/atlas-pack`](../packages/atlas-pack/README.md), atlas packing
- [`packages/math-bridge`](../packages/math-bridge/README.md), the math-engine boundary
- [`packages/conformance`](../packages/conformance/README.md), the behavioral truth suite
- [`apps/editor`](../apps/editor/README.md), the desktop application
