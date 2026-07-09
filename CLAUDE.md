# Armature 2D (codename Marionette): Project CLAUDE.md (session memory)

Armature 2D (internal codename Marionette) is a desktop authoring tool (Electron + React + PixiJS v8) that
produces the full visual presentation of top-tier 2D slot games (Pragmatic Play class): a Spine-equivalent
skeletal animation editor, a particle/VFX subsystem, and a slot composition layer. It exports one portable
data format that web/Unity/Godot runtimes play back. A pre-existing certified math engine drives outcomes;
Armature 2D authors presentation only. **Status: Phases 0, 1, 2 (Rigging), 3 (VFX/particles), and 4 (Slot
composer) complete and green in CI-verifiable form (the document model + commands + runtime-core solve, the
effects subsystem, the slot subsystem with the `math-bridge` engine boundary, conformance fixtures for all
three tracks, MCP tools, the Phase 3 `phase3:acceptance` harness, and the Phase 4 golden-playback
determinism lock). Phase 5 is IN PROGRESS: the headless-CI-verifiable spine is landed and green (MRNT binary
codec + twins, Export Profile core, cross-language vectors + native CI, texture-variant selector,
transformMode in the solve); see `docs/plan/phase-5-production-hardening.md` and `PHASE_5_KICKOFF.md`.
ACTIVE WORK (the current execution order, `docs/DEV_PLAN.md` section 9): finish the earlier phases'
non-headless remainders in phase order BEFORE the remaining Phase 5 native/device/release work, because the
authoring UI and playback renderer trail the backend by roughly one phase (the verified gap map is
`docs/audit/spine-pro-parity-audit.md`): first the Phase 2 GUI remainder (mesh rendering in runtime-web +
viewport, then the WP-2.1/2.3/2.4/2.6/2.7/2.8/2.9 authoring surfaces over the already-complete command
layer), then the Phase 3 remainder (GL particle rendering + designer panel), then the Phase 4 remainder
(GL slot render + scene preview), then Phase 5 continues as planned. NOTE: the WebGL pixel parity, the
live real-engine acceptance step, and the byte-exact fixture-determinism gate on the pinned Node 22.13.1
are not exercisable in a headless container; they are covered by pure-logic + parity + tolerance tests and
the committed golden fixtures instead.** Build phase by phase, do not scaffold everything at once.
The authoritative spec is `MARIONETTE_HANDOFF.md`. The plan of record lives in `docs/plan/`; the master index
and dependency graph are in `docs/DEV_PLAN.md`.

**Product name and editions.** The user-facing product name is "Armature 2D". The package scope and the
codename "Marionette" (including `MARIONETTE_HANDOFF.md` and the `@marionette/*` package names) are kept as
the internal codename for now; the deep package rename is deferred to its own change. The product is planned
to ship in two editions, Essentials and Pro; that tier split carries NO code or feature-gating in Phase 2 and
is tracked for Phase 4/5 in `docs/plan/product-editions.md`. Do not add edition gating before then (Law 5).

---

## The Five Laws (a reviewer rejects any PR that breaks one)

1. **MATH/PRESENTATION BOUNDARY.** Presentation is a pure, deterministic function of a `SpinResult` from the
   certified math engine. Presentation NEVER influences outcome. Same `SpinResult` in => identical visuals out,
   every time. Any code path where the animation/slot layer decides a symbol or a payout is rejected on sight.
2. **ALL MUTATIONS ARE COMMANDS.** Every change to `DocumentModel` goes through the Command/History system
   (`do`/`undo`, coalescing). UI never mutates the document directly. There is no other legal path. The do/undo
   round-trip test is MANDATORY per command (do then undo => deep-equal prior state), and for a coalescing
   command it must cover the merged sequence (one undo restores the pre-interaction state).
3. **THE FORMAT IS THE CONTRACT.** `packages/format` is the one expensive-to-change thing. `formatVersion` is the
   semver of the FORMAT (currently `0.1.0`, `SUPPORTED_FORMAT_MAJOR = 0`), independent of app version. A schema or
   semantic change follows the MAJOR/MINOR/PATCH policy in `docs/plan/cross-cutting/format-contract.md` §10 and
   bumps `formatVersion` with a tested migration; a non-schema change (validator refactor, comment, error wording)
   does NOT bump it. Validate on import; malformed docs fail loudly with a typed `FormatError`.
4. **LEGAL BOUNDARY ON SPINE.** Implement skeletal animation from first principles. Do NOT copy Spine runtime
   source, do NOT vendor it, do NOT open Spine source while working on this repo, ever. Our format is our own
   and we NEVER write/export Spine's formats. One sanctioned exception (owner directive 2026-07-08,
   `docs/plan/pro-parity-execution-plan.md` PP-A5): an import-only, strictly clean-room Spine-project importer
   (built solely from published format documentation and user-owned exported files) that converts to our
   format on import, quarantined in `packages/import-spine`.
5. **PHASE INDEPENDENCE, BUILD IN ORDER.** Each phase ends with a usable artifact. Do not start a phase before the
   prior phase's milestone passes. Do not skip ahead.

---

## Tech stack (load-bearing; do not swap casually)

| Concern | Choice | Why not to swap |
|---|---|---|
| App shell | Electron + React + TypeScript | TS leverage + local FS for projects/atlases + code-share with web runtime. |
| Renderer (viewport + web runtime) | PixiJS v8 (WebGL) | One renderer backs both editor viewport and web runtime; meshes/blend/particles at 60fps. |
| Panels | dockview | Dockable resizable panels are table stakes; do not hand-roll docking. |
| Ephemeral UI state | Zustand | Selection/tool/camera/playhead/layout ONLY. Never the document. |
| Document state | Custom immutable model + command history | Undo/redo and serialization live here, separate from Zustand. |
| 2D math | Custom 2x3 affine lib (no dependency) | 2D affine is trivial and keeps `runtime-core` dependency-light. If `gl-matrix` is ever used, constrain to `mat2d` and verify tree-shaking; the custom lib is the default. |
| Triangulation | earcut now, cdt2d/poly2tri later | Ear clipping is fine for v1 meshes; upgrade when deform triangle quality matters. |
| Atlas packing | maxrects-packer | Packs sprite regions into pages on export. |
| Particles | @pixi/particle-emitter (runtime) + custom designer | Proven emitter model; author configs in-editor. |
| Tests | Vitest (unit) + conformance suite | Conformance suite keeps three runtimes honest. |

---

## Repo map (condensed) and dependency direction

```
apps/editor/
  src/main/                      # Electron main: filesystem/dialog IPC, window, CSP, menu, atlas + export-profile hosting
  src/preload/                   # sandboxed contextBridge (window.marionette); Zod bundled in
  src/shared/                    # the isomorphic IPC contract: channel allowlist + Zod schemas
  src/renderer/
    document/                    # DocumentHost over @marionette/document-core (the doc is NOT in Zustand)
    editor-state/                # Zustand: selection, tool, camera, playback, mesh-edit, weight-paint
    viewport/                    # PixiJS viewport, gizmo, overlays, 4 tools (imports runtime-web)
    panels/                      # hierarchy, assets, slot, viewport, inspector, effects, animations, dopesheet, curve editor
    dopesheet/                   # timeline math, keyframe/curve editing, transport logic
    modules/{mesh,constraints}   # mesh tooling (triangulate, trace, weights) + IK gizmo
packages/
  format/                        # Zod-sourced types + validators + hashing + migrations + MRNT binary (SHARED CONTRACT)
  runtime-core/                  # platform-agnostic solve (skeleton, effects, slot). NO PixiJS. Behavioral source of truth.
  runtime-web/                   # TS + PixiJS playback; also powers the editor viewport
  document-core/                 # renderer-agnostic DocumentModel + commands + History (ADR-0001). NO React/PixiJS/DOM. Shared by the editor AND the headless MCP server.
  mcp-server/                    # standalone headless MCP server (stdio CLI: marionette-mcp), 160 tools over the same commands (WP-M.1). Imports document-core/format/runtime-core/render-preview/atlas-pack.
  render-preview/                # deterministic CPU rasterizer -> PNG (ADR-0006) for headless render feedback
  atlas-pack/                    # deterministic atlas pipeline (ADR-0007), shared by editor main + mcp-server
  math-bridge/                   # SpinResult types + adapter to the existing engine (+ mock)
  conformance/                   # reference rigs + expected-output fixtures + harness (4 tracks + cross-language vectors)
runtimes/{unity,godot}/          # LANDED (PP-E1/E2): C# + GDScript mirrors of runtime-core, full-corpus fixture-conformant, gated by conformance-native CI
docs/plan/                       # plan of record: phase-*.md + cross-cutting/*.md
```

**Dependency direction (machine-enforced; see DoD):** `format` <- `runtime-core` <- `runtime-web` <- `apps/editor`,
and `format` <- `document-core` <- (the `apps/editor` renderer AND the standalone `mcp-server` package; the MCP
server is its own stdio process, NOT hosted inside the Electron main process).
`format` imports nothing project-internal. `runtime-core` imports only `format` types (plus the WP-4.7
math-bridge-types carve-out in `runtime-core/slot`) and has **NO PixiJS** (solving is
core's job, rendering is the renderer's job; this is what lets the logic move to C#/Godot). `document-core` is the
renderer-agnostic command/History spine (ADR-0001): it imports `format` (and `runtime-core` for transform commands),
never React/PixiJS/DOM/Electron, so the GUI and a headless MCP server drive the SAME commands (user + AI control).
Runtimes only READ the format; the only WRITERS are `document-core`'s validated `exportDocument` path (used by the
editor save flow and the MCP `document.save` tool) plus the atlas emitters. Unity/Godot mirror `runtime-core` and validate against the same fixtures.
No deep cross-feature imports: each module/package exposes one barrel (`index.ts`); consume only the barrel. These
rules are enforced by ESLint (`eslint-plugin-boundaries` + `no-restricted-imports`) with CI guard tests, not by
reviewer trust (WP-0.1).

---

## The per-frame solve order (canonical; ALL runtimes must match exactly)

1. **Reset** every bone to setup pose.
2. **Apply animation timelines** (bone transforms, slot colors/attachments, deform offsets, draw order, fire events).
3. **Solve constraints in order: IK first, then transform constraints.**
4. **World transforms**: single forward pass (bones are stored parent-before-child; rely on that invariant).
5. **Skin meshes** (weighted vertex positions from world matrices) and **apply deform offsets** on top.
6. **Render in current draw order** with per-slot blend mode and color.

This order is the behavioral spec. Changing it is changing conformance fixtures (a deliberate, reviewed act,
gated by the `behavior-change` label + runtime CODEOWNERS per `docs/plan/cross-cutting/conformance-and-ci.md`).
The bone-ordering invariant (parents precede children) is produced by the exporter and validated on load.
Phase 0 implements steps 1 and 4 only; steps 2, 3, 5, 6 arrive in Phase 1 and later.

---

## Document vs Editor state wall (do not mix)

| Document state (undoable, saved, in `DocumentModel`) | Editor state (ephemeral, Zustand, not in the save) |
|---|---|
| bones, slots, skins, attachments | current selection |
| ik/transform constraints | active tool |
| animations, timelines, deform, draw order, events | viewport camera (pan/zoom) |
| atlas refs | playback position / which animation is open |
| | panel layout |

Selecting a bone is NOT an undoable change. Moving a bone IS (a command). Save snapshots `DocumentModel`; load
parses, validates, rebuilds, and **resets History**. Coalescing folds a drag (hundreds of moves), a scrub edit, or
a weight-paint stroke into a single undo step (`coalesceWith`, 250ms window, same-target only; different-target
edits must never coalesce).

---

## Working agreement / Definition of Done

A PR is mergeable only when ALL of these hold. Items tagged "(applies once X exists)" are vacuous before that
point and must not be faked; the rest apply from Phase 0.

- [ ] **Commands for all mutations** (Law 2). No `DocumentModel` mutation exists outside a `Command.do`/`undo`;
      mutators are package-internal and excluded from the barrel, enforced by the boundaries lint, not just review.
- [ ] **Do/undo round-trip test present and green** for every new/changed command (do then undo => deep-equal prior
      state). For a coalescing command the test covers the MERGED sequence: undoing a coalesced drag/scrub/weight
      stroke returns to the pre-interaction state in ONE undo step, the 250ms window is pinned, and different-target
      actions do not coalesce.
- [ ] **Boundary invariants are machine-enforced** (Law 5 + global standards), not reviewer-trusted: CI lint passes
      AND its guard tests prove the bans fire on injected violations: no `pixi.js`/`@pixi/*` in `runtime-core`,
      barrel-only / no deep cross-feature imports, inward layer direction (UI -> application -> domain ->
      infrastructure), and the forbidden-package guard (only the sanctioned packages for the current phase exist).
- [ ] **TS strict everywhere; NO `any` and no unjustified `as` in `format` or `runtime-core`** (ESLint
      `no-explicit-any` is an error there). Other packages strict too.
- [ ] **Validate-on-import / fail loudly** (Law 3). Every external boundary (file load, IPC payload) validates with
      the `format` schema or Zod and rejects malformed input with a typed error; a negative test asserts the exact
      `FormatError` code for at least one rejection case (positive plus negative).
- [ ] **`formatVersion` discipline** (Law 3). A schema or semantic change to `packages/format` is classified
      MAJOR/MINOR/PATCH (`format-contract.md` §10), bumps `formatVersion` with a tested migration and CHANGELOG
      entry, and pre-1.0 breaking changes bump MINOR. A non-schema change does NOT bump `formatVersion`.
- [ ] **No per-frame allocation in the solve/render loop; pooling** of particles, sprites, mesh buffers (applies
      once a solve/render loop exists; Phase 0 world pass writes into pre-allocated arrays).
- [ ] **Conformance fixtures regenerated from `runtime-core`** when solve behavior changes, committed in the same
      PR behind the behavior-change review gate; drift fails CI for web/Unity/Godot (applies once the conformance
      harness exists, Phase 1; in Phase 0 solve steps 1 and 4 are covered by unit tests and world-pass fixtures
      land in Phase 1).
- [ ] **Math boundary intact** (Law 1): presentation never reads RNG or decides outcome; it only consumes
      `SpinResult` (architecturally reserved in Phase 0, where no `SpinResult` exists yet; enforced from Phase 1).
- [ ] **No em-dashes** anywhere (docs, comments, UI copy); the em-dash grep guard is green. Use commas,
      parentheses, or separate sentences.
- [ ] **Conventional Commits**, one logical change per commit; refactor and behavior change never share a commit.
- [ ] **Milestone-gated branch.** One subsystem per branch; do not open a phase whose predecessor milestone is unmet.

---

## Build order (Phases 0 to 5; do not skip ahead, Law 5)

Each phase ships a usable artifact and is gated on its predecessor's milestone.

**Work-package IDs are defined ONCE, in `docs/plan/phase-0-foundations.md` (the plan of record).** The list below
mirrors that source verbatim so session memory cross-references correctly; if the two ever disagree, the plan wins
and this list is the bug. Do not renumber here.

- **Phase 0, Foundations.** Milestone: create a bone by dragging, move AND rotate it with a gizmo, undo/redo cleanly,
  save the file, reload to the same state. (Rotation is part of `MoveBone`, which sets local `x`/`y`/`rotation`;
  there is no separate `RotateBone` command in Phase 0.)
  - **WP-0.1** Monorepo (pnpm + Turborepo), tooling (ESLint/Prettier), boundary lint, and CI skeleton
    (typecheck/lint/test/build) with guard tests that prove the no-PixiJS-in-core and `any`-in-format bans fire.
  - **WP-0.2** Electron + React shell with three dockview panels (hierarchy/viewport/inspector) and secure IPC
    (`contextIsolation`/`sandbox` on, `nodeIntegration` off, channel allowlist, Zod-validated payloads). No file IO yet.
  - **WP-0.3** `packages/format` v0: Zod-sourced types + derived JSON Schema + runtime validator (typed `FormatError`)
    + a minimal hand-written fixture, tested with POSITIVE and NEGATIVE cases (each negative asserts the exact code).
  - **WP-0.4** `packages/runtime-core`: 2x3 affine lib + world-transform pass (solve steps 1 and 4 only);
    parent-rotation world-transform unit test; NO PixiJS.
  - **WP-0.5** `packages/runtime-web`: PixiJS scene that loads a `SkeletonDocument` and draws bones (tapered
    diamonds) + region attachments (tinted unit textures) at setup pose. No animation.
  - **WP-0.6** Editor viewport imports `runtime-web`; pan/zoom camera around the cursor. Camera is ephemeral and
    never serialized.
  - **WP-0.7** `DocumentModel` + `History` (handoff 8.1); `CreateBone` and `MoveBone` (coalescing) commands;
    create-by-drag tool; select-move-rotate gizmo; undo/redo keybindings. LAW 2 governs this WP.
  - **WP-0.8** Save (serialize to format JSON) and load (parse, validate-on-load, rebuild, reset History) via the
    Electron main-process filesystem APIs.
- **Phase 1, Bone puppet (Tier 0).** Region attachments, atlas import+pack, dopesheet (keys + bezier), playback,
  `runtime-web` plays an exported anim. The conformance harness starts here. Milestone: rig a sprite, author an idle
  loop, play it identically in editor and web runtime.
- **Phase 2, Rigging (the hard one).** Mesh create/edit + triangulation, skinning, weight painting, two-bone IK,
  transform constraints, skins, deform timelines. Milestone: a mesh-deformed, weighted, IK-driven limb animating
  smoothly in editor and web runtime.
- **Phase 3, VFX / particles (Layer B).** Particle designer, emitter runtime, slot presets (coin shower, sparkle,
  rays, glow, trails), blend modes. Milestone: author a big-win coin-shower + ray-burst and play it.
- **Phase 4, Slot composer (Layer C).** Grid/reel config, symbol library, win sequencer, feature/free-spin flows,
  tumble choreography, `math-bridge` (mock then real engine). Milestone: a playable scene driven by the real engine
  with a win sequence, free-spin trigger, and a working cascade.
- **Phase 5, Production hardening.** Binary export, atlas optimization, Unity + Godot runtimes, conformance green
  across all three, mobile profiling, build pipeline. Milestone: one full game shipped to web + Unity with
  conformance parity.

The three things that must be right early: the data format (`MARIONETTE_HANDOFF.md` §6 and
`docs/plan/cross-cutting/format-contract.md`), the command system (§8.1 and `command-history.md`), and the
math/presentation boundary (§7). Everything else is replaceable.

---

## Where things live / where to look

- **`MARIONETTE_HANDOFF.md`**: authoritative spec. Format types §6, command system §8.1, math boundary §7,
  subsystem detail §8, phased roadmap §9, risk register §10, Phase 0 literal steps §12.
- **`docs/DEV_PLAN.md`**: master index for the build: document map, phase roadmap with milestone gates, the
  dependency graph, the cross-phase risk register, the status tracker, and the glossary. Read it to navigate.
- **`docs/plan/phase-0-foundations.md`**: the active plan of record. **Start here for what to do next.** It owns the
  WP-0.x IDs, tasks, acceptance criteria, and the Phase 0 exit gate. Sibling phase plans: `phase-1-bone-puppet.md`,
  `phase-2-rigging.md`, `phase-3-vfx-particles.md`, `phase-4-slot-composer.md`, `phase-5-production-hardening.md`.
- **`docs/plan/cross-cutting/`**: the authoritative contracts that span phases: `command-history.md` (do/undo/redo,
  coalescing), `format-contract.md` (types, validator, typed errors, versioning §10), and `conformance-and-ci.md`
  (fixtures-from-core, CI gates, drift triage). Read these before touching the command, format, or runtime layers.
- **`packages/format`**: the contract. Read the schema before touching anything that imports it.
- **`packages/conformance`**: reference rigs and committed fixtures; the behavioral truth check for every runtime
  (lands in Phase 1).
