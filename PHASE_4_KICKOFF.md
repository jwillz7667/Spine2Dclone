# Phase 4 Kickoff: Slot Composer (Layer C)

This is the working kickoff for Phase 4. The authoritative plan of record is
`docs/plan/phase-4-slot-composer.md`; the format contract it binds is
`docs/plan/cross-cutting/format-contract.md` section 15; the command catalog is
`docs/plan/cross-cutting/command-history.md` section 11; the conformance gate is
`docs/plan/cross-cutting/conformance-and-ci.md` (WP-V.5). This document frames the
phase, records the decisions a reviewer enforces, and tracks live status. It does not
restate the plan; where they disagree, the plan wins.

Phase 4 turns the rigged, animated, VFX-capable presentation from Layers A and B into a
playable slot scene driven by a certified math engine. The single rule that governs
everything: presentation is a pure, deterministic function of the engine outcome. The
engine decides; presentation only displays.

---

## 1. Milestone (the sentence that gates Phase 5)

> A playable slot scene driven by the REAL certified math engine through a NON-TRANSACTING
> resolve: symbols land on the engine's board and idle, a winning spin animates exactly the
> engine's winning cells with named VFX and a counter rollup to exactly the engine's win
> amount, a free-spin trigger runs the feature flow, an escalation tier matches the engine's
> win multiple, and the editor preview and `runtime-web` play the identical timeline, all
> proven to be a pure deterministic function of the `SpinResult` by a committed golden-playback
> test.

A conditional tumble clause (cascade landing, explode/drop/refill, per-step rollup chain)
activates only when the engine owner confirms it exposes the pre-cascade board
(`initialGrid`) and a per-step authoritative running total (`CascadeStep.cumulativeWin`). It
is engineered against the deterministic mock now and proven against the real engine later
(Appendix A of the plan). It does not gate Phase 5 until signed.

---

## 2. Entry gate (verify before opening any WP-4.x)

- [x] Phase 1 green: rig + idle loop plays identically in editor and `runtime-web`.
- [x] Phase 2 green: mesh-deformed, weighted, IK-driven limb plays in editor and `runtime-web`.
- [x] Phase 3 green: a big-win coin-shower + ray-burst authored and played; VFX presets are
      addressable BY NAME (the contract Phase 4 win sequences call), and the particle
      conformance + DoD acceptance gates are green.
- [x] `DocumentModel` + `History` shipped with coalescing and the do/undo round-trip harness;
      `DocState` can gain a `slotScene` aggregate without touching skeleton/mesh/constraint code.
- [x] `runtime-core` solve is PixiJS-free and stable; symbols instantiate as independent
      playback heads.
- [x] CI green: boundary lint, no-`any`/unjustified-`as` in `format`/`runtime-core`, em-dash
      guard, typecheck, unit, conformance.

All boxes are checked on this branch. Phase 4 instantiates Layer A/B artifacts and fires
Layer B VFX by name; it builds nothing it could have built earlier.

---

## 3. The five laws as they bite here (LAW 1 is the governing law)

- **LAW 1 (math/presentation boundary), GOVERNING.** Presentation is a pure function
  `(SpinResult, SlotScene) -> PresentationTimeline`. Symbol placement, win amounts, feature
  triggers, and cascade contents come from `SpinResult` and are NEVER authored, computed, or
  altered by presentation. The near-miss temptation (let presentation invent a tease) is
  rejected by construction: anticipation is a pure function of `initialGrid`. There is no
  channel from presentation back to the engine. Enforced by the import-graph lint (`format`
  never imports `math-bridge`; `runtime-core/slot` reads outcome VALUE TYPES only, never the
  engine client `math-bridge/real`), the `no-outcome-in-commands` rule, and the
  clock/RNG bans in the sequencer.
- **LAW 2 (all mutations are commands).** Every `SlotScene` edit (grid, symbol map, win
  sequence, feature flow, tumble timing) is a `Command` with a mandatory do/undo round-trip
  test on the shared project History. The live `SpinResult` is engine output and is NEVER a
  command input or a document field.
- **LAW 3 (format is the contract).** `SlotScene` serializes as its own semver'd envelope
  (`SlotSceneDocument`, `slotSceneFormatVersion = 0.1.0`), validated on import, failing
  loudly with typed errors carrying a JSON path. `SpinResult` is a runtime boundary type
  validated on receipt with its own `BOUNDARY_CONTRACT_VERSION`; it is never a document format.
- **LAW 4 (Spine legal boundary).** No Spine surface here (Spine has no slot composer). The
  slot format, the sequencer, and the timeline are our own design.
- **LAW 5 (phase independence, build in order).** Phase 4 ends with a playable, engine-driven
  scene. No Phase 5 work (binary export, Unity/Godot runtimes) leaks in. `packages/math-bridge`
  is introduced HERE, not pre-scaffolded earlier.

---

## 4. Decisions of record (a reviewer rejects deviations)

1. **The integration boundary is one-way.** Engine output flows to presentation; there is no
   edge back. Presentation cannot influence an outcome because it has no channel to.
2. **Type split (CD-1).** The authored side (`SymbolId`, `SlotScene` and its sub-schemas, the
   `SlotSceneDocument` envelope, `SceneRefs`) lives in `packages/format`. The outcome side
   (`SpinResult`, `SpinInput`, `MathEngine`, `WinLine`, `FeatureEvent`, `CascadeStep`,
   `SymbolVocabulary`) lives in `packages/math-bridge`. `math-bridge` may import `format`;
   `format` never imports `math-bridge`.
3. **The `PresentationTimeline` is the determinism surface.** A flat, time-ordered, fully
   resolved list of typed directives: pure data, JSON serializable, deep-equal comparable.
   Times are INTEGER MILLISECONDS and win amounts INTEGER BASE UNITS, so the cross-runtime
   byte surface has no IEEE division.
4. **Ordering is a two-key total comparator `(atMs asc, seq asc)`** with NO hidden priority
   key. `seq` is a globally unique monotonic emission index assigned in the documented
   construction order, so a non-stable C# or Godot sort yields the identical sequence.
5. **The counter rollup value is pinned** by a fixed-point integer function `rollupValueAt`
   (FP = 2^16, floor rounding, BigInt intermediates). A Phase 5 runtime that reproduces the
   timeline but evaluates the curve differently still fails conformance.
6. **One rollup channel per spin.** Line-win spins emit a single `0 -> totalWin` rollup;
   cascade spins emit a contiguous per-step chain reading the engine's `cumulativeWin`. The
   selector is whether `cascades` is present, so the two never both fire. `totalWin` stays
   authoritative; presentation never sums `stepWin`.
7. **Mock then real, both non-transacting.** The editor and conformance bind to the engine's
   non-transacting RESOLVE entry point (a deterministic read of what a seed would produce),
   never a transacting bet. The money boundary is structural: the resolve client interface
   exposes no transacting method, and config fails fast if a transacting endpoint is set for
   preview.
8. **Conditional tumble track.** The cascade engineering is built and tested against the
   deterministic mock now; its real-engine proof and milestone credit are deferred until the
   engine exposes `initialGrid` and `cumulativeWin`.

---

## 5. Work packages and live status (build order)

The sequencer (WP-4.7) and its three extensions are the schedule core; the golden conformance
(WP-4.13) locks the determinism contract; the real-engine integration (WP-4.14) is the gate.

| WP | Deliverable | Status |
|---|---|---|
| 4.1 | `math-bridge` boundary types + Zod schemas + `validateSpinResult` + `SymbolVocabulary` | DONE |
| 4.2 | `MockMathEngine` + five committed scenario fixtures | DONE |
| 4.3 | `RealEngineAdapter` (non-transacting projection) + config fail-fast | DONE (live engine deferred to 4.14) |
| 4.4 | `SlotSceneDocument` envelope + validator + hash + manifest + negative corpus | DONE |
| 4.5 | Grid + `AnticipationConfig` schema + `SetGridConfig` command | DONE (schema + command; panel UI not headless) |
| 4.6 | Symbol library `SymbolAnimSet` + `MapSymbolAnimSet` command | DONE (schema + command; panel UI not headless) |
| 4.7 | `SlotPresentationSequencer` core: landing + anticipation + `seq`/comparator + `rollupValueAt` | DONE |
| 4.8 | Win sequencer stage + `slot.winseq.*` commands + escalation | DONE (commands + stage; panel not headless) |
| 4.9 | Feature + free-spin flow graph stage + `slot.flow.*` commands | DONE (commands + stage; panel not headless) |
| 4.10 | Tumble/cascade stage + drop solver + `SetTumbleChoreography` (mock-driven) | DONE (commands + stage; panel not headless) |
| 4.13 | Golden-playback conformance: locked timelines + pinned rollups + `.slot.fixtures.lock` | DONE |
| 4.11 | `runtime-web` `TimelinePlayer` | Pure cursor/rollup logic is CI-verifiable; WebGL render + pixel parity are not headless |
| 4.12 | Editor composer shell + spin-preview transport | GUI/Electron, not headless; the transport spin-orchestration logic is CI-verifiable |
| 4.14 | Real-engine integration + DoD acceptance | Hermetic golden replay covered by 4.13; live engine + pixel parity are not headless |

Remaining CI-verifiable slices: the `SlotSceneDocument` save/load round-trip (the persistence
gap), and the `TimelinePlayer` pure directive-cursor + rollup-value logic (the non-GL heart of
4.11). The WebGL rendering, the Electron composer GUI, and the live real-engine step are not
exercisable in a headless container; the committed golden fixtures (WP-4.13) are the
cross-runtime proof those would validate against, exactly as in Phases 2 and 3.

---

## 6. How determinism is guaranteed (by construction, not by hope)

| Mechanism | Effect |
|---|---|
| Pure sequencer signature `(SpinResult, SlotScene) -> PresentationTimeline` | Output is a function of arguments only |
| No clock / no RNG in `runtime-core/slot` (lint-enforced) | No wall-clock or random divergence |
| Integer-ms time, integer-unit amounts | No float accumulation or IEEE division in the golden; exact compare |
| Two-key total comparator with a unique `seq`, no hidden priority key | Portable to non-stable C#/Godot sorts |
| Keyed-lookup-only access to `Record` maps (arrays decide order) | Object-key iteration order cannot affect output |
| Pinned integer/fixed-point `rollupValueAt` | The displayed rollup integer is identical across runtimes |
| Mutually exclusive rollup models reading engine `cumulativeWin` | One channel per spin; terminal is `totalWin`; no double-count |
| Renderer plays a pre-resolved timeline | No new timing or outcome decisions at render time |
| `SpinResult` validated on receipt; never authored; never serialized | Outcomes cannot leak into authoring |

The proof is the committed golden-playback test (WP-4.13): for each `(SpinResult, SlotScene)`
pair, `sequence` is run, deep-equaled to the committed timeline and the pinned per-sample
rollup values, then run 1000 times and asserted byte-identical. Drift fails CI behind the
`.slot.fixtures.lock` manifest.

---

## 7. Start here

- For what to build next: section 5 above (the remaining CI-verifiable slices) and
  `docs/plan/phase-4-slot-composer.md` sections 8 (work packages) and 12 (the DoD acceptance
  script).
- Before touching the boundary types: read `format-contract.md` section 15 (the slot format
  system of record) and `phase-4-slot-composer.md` section 5 (architecture decisions).
- Before adding a command: read `command-history.md` section 11 (the slot command catalog) and
  mirror an existing `slot.*` command; every command ships a do/undo round-trip spec.
- Before changing solve behavior: regenerate the WP-4.13 goldens as a reviewed act
  (`pnpm --filter @marionette/conformance run generate:slot`); a silent drift fails CI.
- The governing reminder, on every PR: presentation code may read or branch on `SpinResult`
  fields and authored `SlotScene` config and nothing else. A reviewer who sees otherwise
  rejects the PR. This is LAW 1, the governing law of the phase.
