# Architecture

Armature 2D (internal codename Marionette) is a desktop authoring tool plus a family of runtimes,
organized as a pnpm + Turborepo monorepo. This document is the system-level map for engineers; the
authoritative spec is `MARIONETTE_HANDOFF.md` and the plan of record is `docs/plan/`.

## The product in one paragraph

Three subsystems over one shared runtime. Layer A is a Spine-equivalent skeletal animation editor
(bones, weighted meshes, IK and transform constraints, skins, keyframed timelines), implemented
from first principles with its own format (LAW 4). Layer B is a deterministic particle/VFX
subsystem (emitters, sprite animators, ribbon trails, seeded playback). Layer C is a slot
composition layer (grids, symbol mapping, win sequencing, feature flows, tumble choreography)
driven strictly by `SpinResult` values from an external certified math engine (LAW 1). Everything
exports one portable data format that web (and, in Phase 5, Unity and Godot) runtimes play back
identically, proven by a conformance suite.

## Workspace map

```
apps/
  editor/            # Electron + React + PixiJS authoring app (see apps/editor/README.md)
packages/
  format/            # THE CONTRACT: Zod schemas, validators, hashing, migrations, MRNT binary
  runtime-core/      # platform-agnostic solve: skeleton, effects, slot sequencer (no PixiJS/DOM/Node)
  runtime-web/       # PixiJS v8 playback; also powers the editor viewport
  document-core/     # DocumentModel + 101 commands + History (shared by GUI and MCP; ADR-0001)
  mcp-server/        # 143 MCP tools over stdio: full headless authoring control (AI + scripts)
  render-preview/    # deterministic CPU rasterizer -> PNG for headless render feedback (ADR-0006)
  atlas-pack/        # deterministic sprite-atlas pipeline (ADR-0007)
  math-bridge/       # the LAW 1 boundary: SpinResult contract, validator, mock + real engine adapter
  conformance/       # reference rigs + committed expected-output fixtures + drift gates
tools/               # repo guards (package allowlist, dash ban, format semver) + lint guard tests
docs/                # plan of record, ADRs, user manual, developer docs (this directory)
demo/                # sample productions built with the tool (not product code)
slot-assets/         # loose demo art assets
```

`runtimes/unity` holds the shared C# solve core (PP-E1, fixture-conformant; see
`runtimes/unity/README.md`); `runtimes/godot` is still pending (PP-E2), with native CI scaffolded
for both (`.github/workflows/conformance-native.yml`).

## Dependency direction (machine-enforced)

ESLint (`eslint-plugin-boundaries` + `no-restricted-imports`) enforces the graph below; the guard
tests in `tools/lint-checks/lint-guard.test.ts` prove each ban fires on an injected violation.

```
format  <-  math-bridge
format  <-  runtime-core   (types only, via @marionette/format/types)
format  <-  atlas-pack
format, runtime-core            <-  runtime-web (+ pixi.js)
format, runtime-core            <-  render-preview (+ pngjs)
format, runtime-core            <-  document-core
format, runtime-core, math-bridge  <-  conformance
document-core, format, runtime-core, render-preview, atlas-pack  <-  mcp-server
runtime-web, document-core, format, runtime-core, atlas-pack     <-  apps/editor
```

Key bans, all with CI guard tests:

- `runtime-core` and `format` carry no PixiJS, no DOM globals, no Node built-ins, no Electron.
- `runtime-core` may not import the `@marionette/format` value barrel (types only), and may not
  import `@marionette/math-bridge` except the WP-4.7 carve-out: `runtime-core/slot` may use
  `@marionette/math-bridge/types` and `spinResultSchema`. Nothing in core may reach
  `math-bridge/real` (the engine client).
- `Math.random` and `Date.now` are banned in `runtime-core` (determinism), as are non-`as const`
  type assertions.
- Every package and module exposes one barrel (`index.ts`); deep cross-feature imports are banned.
- Editor process boundaries are lint elements too: the renderer cannot import main.

## The five laws

Full text in `CLAUDE.md`; every subsystem below is shaped by them.

1. **Math/presentation boundary.** Presentation is a pure deterministic function of a `SpinResult`.
2. **All mutations are commands** with do/undo and a mandatory round-trip test.
3. **The format is the contract**: versioned, validated on import, fails loudly with typed errors.
4. **Legal boundary on Spine**: first-principles implementation, own format, no Spine source; the
   clean-room import-only migration path (PP-A5) is the single sanctioned exception.
5. **Phase independence, build in order**: each phase ships a usable artifact.

## Data flow

### Authoring (GUI and AI are the same path)

```
   GUI panels / viewport tools            MCP client (AI agent)
              |                                   |
              v                                   v
   apps/editor renderer                 packages/mcp-server (143 tools, stdio)
              \                                   /
               \                                 /
                +--> @marionette/document-core <-+
                     Command -> History.execute -> Mutator (package-private)
                     one undo stack, 250 ms coalescing, interaction sessions
                              |
                              v
                     exportDocument() -> validated, content-hashed format JSON
```

There is exactly one write path into a document: a registered `Command` executed by `History`
(LAW 2). The GUI's DocumentHost and the MCP server's SessionRegistry both hold a document-core
`Document` aggregate; neither has any private mutation privilege. The editor persists via
Electron main-process dialogs and re-validates with `verifyHash: true` on both sides of the disk.

### Playback (runtime side)

```
format JSON (or MRNT binary)
   |  validate on load (typed errors)
   v
runtime-core: buildPose -> per-frame solve (the canonical 6-step order)
   |                          |
   v                          v
runtime-web (PixiJS GL)   render-preview (CPU rasterizer -> PNG)
editor viewport + player  MCP render_frame feedback loop
```

The per-frame solve order (reset, timelines, IK then transform constraints, world pass, skin plus
deform, render) is canonical and identical in every runtime; changing it means regenerating
conformance fixtures behind the behavior-change review gate.

### Slot presentation (LAW 1 in practice)

```
certified math engine (external)     MockMathEngine (5 committed scenarios)
              \                        /
               v                      v
        math-bridge: SpinResult (validated, integer money, integer cells)
                          |
                          v
        runtime-core/slot: sequence(result, scene) -> PresentationTimeline
        (pure, clock-free, RNG-free; integer ms; stable total ordering)
                          |
                          v
        runtime-web slot timeline cursor -> (GL consumer = WP-4.11 remainder)
```

Presentation code can never construct, alter, or influence an outcome: `math-bridge/real` is
lint-unreachable from presentation packages, `sequence()` is a pure function locked by golden
fixtures, and near-miss/tease timing derives only from data already in the `SpinResult`.

## The document / editor-state wall

Document state (bones, slots, skins, attachments, constraints, animations, atlas refs, effects,
slot scene) lives in `document-core` and changes only through commands. Editor state (selection,
active tool, camera, playhead, panel layout) lives in Zustand stores in the renderer, is never
serialized, and is never undoable. Selecting a bone is not a command; moving one is.

## Determinism strategy

- **Skeleton**: pure float solve, fixtures generated from `runtime-core` on a pinned Node
  (22.13.1) and compared byte-exact for drift, tolerance-based across runtimes.
- **Effects**: Mulberry32 PRNG with a normative per-particle draw order, integer step clocks,
  seeds derived by `hash32` chains from `spinSeed` (FNV-1a-32 of the spin id), SoA pools sized
  once. Integer primitives are golden-vectored for cross-language reproduction.
- **Slot**: integer milliseconds, integer base units, BigInt fixed-point rollup, a total two-key
  directive ordering so non-stable sorts agree across languages.
- **Rendering**: render-preview pins its fill rule, sampling, and PNG encoder options for
  byte-identical previews; runtime-web shares placement math with render-preview via parity tests.

## The format (LAW 3)

`packages/format` owns three document families (`SkeletonDocument` 0.2.0, `EffectsDocument` 1.0.0,
`SlotSceneDocument` 0.1.0), each with strict Zod schemas, collect-all validators with typed error
codes, SHA-256 content hashing over canonical JSON, a migration framework (currently one step,
0.1.x to 0.2.0), and the MRNT deterministic binary container (magic `MRNT`, string table, tagged
value tree, CRC-32 trailer). Format changes follow `docs/plan/cross-cutting/format-contract.md`
section 10 and are CI-gated (`check:format-semver`, `check:format-version-stable`).

## Where behavior is pinned

| Behavior | Pinned by |
|---|---|
| Solve order and numeric results | `packages/conformance` fixtures + drift gate + closed-form oracle |
| Command undo correctness | the round-trip harness over all 101 commands |
| Coalescing (250 ms window, sessions) | `coalesce.test.ts`, `cancel-interaction.test.ts` |
| Format acceptance/rejection | positive corpus + negative fixtures named by exact error code |
| Content hash | hash oracle + stability tests |
| MRNT bytes | binary twins of all 7 rigs + CRC vectors |
| PRNG / seeds / CRC across languages | `cross-language/seed-prng-crc-vectors.json` |
| Preview pixels | byte-exact golden PNGs in render-preview |
| Architecture boundaries | ESLint boundaries config + `tools/lint-checks` guard tests |
| Phase 3 / Phase 4 acceptance | `pnpm phase3:acceptance`, slot golden timelines |

## Architecture decision records

`docs/adr/`: 0001 MCP control surface (and the shared-C#-runtime-core sibling), 0002 weighted
vertex encoding, 0003 constraint solve semantics, 0004 Phase 2 format additions, 0005
AnimationState, 0006 headless render feedback (the CPU rasterizer), 0007 atlas pack extraction.
Non-trivial architectural decisions get a new ADR before code.
