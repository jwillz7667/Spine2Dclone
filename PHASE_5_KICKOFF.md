# Phase 5 Kickoff: Production Hardening

This is the working kickoff for Phase 5, written so a NEW session can pick up cleanly. The authoritative
plan of record is `docs/plan/phase-5-production-hardening.md` (816 lines); the shared-core decision is
`docs/adr/0001-shared-csharp-runtime-core.md`; the conformance and CI contract is
`docs/plan/cross-cutting/conformance-and-ci.md`; the format contract is
`docs/plan/cross-cutting/format-contract.md`. This document frames the phase and records what is true on the
branch today. Where it disagrees with the plan, the plan wins.

Phase 5 turns a working editor (Phases 0 to 4, all green) into a SHIPPED product: a binary export, an
optimized atlas, two native runtimes (Unity + Godot) that reproduce the `runtime-core` solve within
tolerance, conformance parity across all three runtimes in CI, a mobile performance profile validated on a
real device, and a signed, auto-updating release pipeline. It is the terminal phase.

---

## 0. Read this first: what a fresh session can and cannot do here

Phase 5 is the phase where the work splits hard along the headless boundary. Be honest about it from line one.

- **CI-verifiable in this headless container (do these first):** the binary codec and its round-trip
  (WP-5.1, pure `packages/format` TS), the Export Profile schema + loader logic (WP-5.0, minus the editor
  panel), the `spinSeed` string-to-uint32 golden vector (entry gate G5.8), the committed binary rig twins,
  the texture-variant SELECTION algorithm and atlas-packing determinism (the non-GPU parts of WP-5.2), and
  the conformance harness scaffolding + the cross-language seed/PRNG golden vectors (WP-5.5 inputs).
- **NOT exercisable in a headless container (need real toolchains or hardware, defer as in Phases 2 to 4):**
  the Unity and Godot native runtimes (WP-5.3/5.4 need the engines installed and native builds), the GPU
  texture transcode/load on device (WP-5.2/5.6), mobile device profiling on named hardware (WP-5.6), the
  release signing and auto-update pipeline (WP-5.7), and any editor GUI. The committed conformance fixtures
  (skeleton + effects + slot tracks, already in `packages/conformance`) are the cross-runtime contract those
  native runtimes will be validated against; building them does not require running them here.

So a productive headless session lands WP-5.1, the WP-5.0 headless core, G5.8, and the WP-5.5 cross-language
golden vectors, leaving the native/device/release work for an environment that has Unity, Godot, a signing
identity, and an iPhone-class device.

---

## 1. Milestone (the exit gate of the project)

> One full reference game (hero rig + slot scene, driven by the real certified math engine) is exported to a
> binary document plus an optimized atlas, plays in the web runtime AND the Unity runtime, and the full
> conformance fixture set is green for web + Unity + Godot in CI within the committed tolerance.

The independence claim is stated precisely (full record in ADR-0001): the TS `runtime-core` is the single
independent oracle. Unity and Godot reuse ONE engine-agnostic C# solve core (`Marionette.Runtime.Core`), so
conformance proves TS-vs-C# parity across the whole fixture set and Unity-vs-Godot agreement is structural by
construction. The compensating control for the one lost independent cross-check is the A.2 reference-rig
COVERAGE checklist: every solve branch (IK both bend directions, every non-`normal` transform mode, stepped
and bezier curves, deform-after-skin, draw-order reorders, all four blend modes) MUST be exercised by a
committed fixture, and the A.2 coverage meta-test MUST be green. Any solve path no committed fixture
exercises has ZERO cross-implementation verification under the shared-core model.

---

## 2. Entry gate: Phase 4 must be GREEN (status on this branch)

Phase 5 is blocked until every box is checked (Law 5). Current reality:

- [x] **G5.1** Phases 0 to 4 milestones green (bone puppet, rigging, VFX, slot composer) in CI-verifiable
      form: the per-phase acceptance harnesses pass (`phase3:acceptance` 11/11, the Phase 4 golden-playback
      determinism lock, the conformance fixtures for all three tracks).
- [x] **G5.2** The `packages/conformance` web suite is green and gating (rigs, sample-spec, fixture schema,
      generator, committed fixtures, fixtures-lock gate, compare engine, single tolerance policy).
- [~] **G5.3** AUDIT NEEDED before WP-5.3/5.4. `rig-2bone` and the six Phase 2 families
      (`rig-rigid-mesh`, `rig-weighted-mesh`, `rig-one-bone-ik`, `rig-two-bone-ik`,
      `rig-transform-constraint`, `rig-deform`) are committed and green. The plan's EXTENDED catalog
      (events/draw-order, blend-mode, transform-mode, ik-into-transform, weighted-deform, events-loop rigs)
      and the A.2 coverage meta-test are the SOLE compensating control for the shared C# core, so confirm
      they exist and are green before the native runtimes are trusted. This is the highest-value pre-WP-5.3
      task.
- [x] **G5.4** Slot-presentation determinism is a required check (Law 1): the golden-playback test asserts
      the same `SpinResult` yields an identical timeline (1000x byte-identical), and the sequencer reads no
      RNG/clock (lint-enforced).
- [x] **G5.5** Perf gates green: the Phase 3 per-frame allocation and particle pool high-water gates
      (`phase3-perf-gates.test.ts`) and the committed `perf/baseline.json`.
- [x] **G5.6** The `math-bridge` real-engine adapter is wired (non-transacting projection) and the slot scene
      plays a win sequence, a free-spin trigger, and a tumble cascade (mock-driven; the live engine is the
      WP-5.8 manual step).
- [ ] **G5.7** Editor packageable: confirm `electron-builder` config exists and add a `--smoke` mode that
      loads a reference rig and renders one frame. `release.yml` is NOT a precondition (it is WP-5.7's
      deliverable). NEEDS WORK.
- [ ] **G5.8** The particle seed derivation is pinned bit-exactly: `spinSeed(spinId: string): number` MUST be
      defined in `runtime-core` (the oracle) and committed as a golden vector. If Phase 3/4 left it implicit
      or "for example", that is a Phase 3/4 defect to fix FIRST (Phase 5 locks it, it does not invent it).
      AUDIT + likely small fix. This is CI-verifiable and a good first headless task.

If a box is unchecked, close it before the native/device work. G5.3 and G5.8 are the two real pre-conditions
to resolve in a headless session.

---

## 3. The five laws as they bite here

- **LAW 1 (math/presentation boundary).** Unity and Godot consume `SpinResult` from the certified engines and
  are pure deterministic presentation. The mobile particle profile (WP-5.6) scales ONLY ambient effects
  (`deterministic: false`) via the Phase 3 quality tier; DETERMINISTIC win effects always run at authored
  counts, fit into the mobile budget at AUTHORING time (WP-5.0). No cap or LOD reads measured frame rate, so
  the same `SpinResult` on the same profile yields identical visuals every run.
- **LAW 2 (all mutations are commands).** Phase 5 adds essentially no document mutations. Binary export and
  atlas tuning READ the document and write to the Export Profile store (the third store, section 4.1 of the
  plan), which is NOT the undoable document. Any new `SkeletonDocument` field is a STOP-and-ADR event.
- **LAW 3 (format is the contract).** Binary is a re-encoding of the IDENTICAL logical schema, carrying the
  SAME `formatVersion` semver, validated by the SAME validator after decode, failing loudly on violation.
  Texture compression and mip handling stay OUT of the format (a sidecar manifest). The Export Profile has
  its own `exportProfileVersion`, fenced from `SkeletonDocument` by lint + a disjoint-fields test.
- **LAW 4 (Spine legal boundary).** The binary container is our own (`MRNT` magic, our layout); it is NOT
  Spine `.skel` compatible and claims no compatibility. Unity/Godot solves are first-principles ports of
  `runtime-core`.
- **LAW 5 (phase independence, build in order).** Section 2 entry gate; within the phase, the WP dependency
  graph is enforced at the WP grain.
- **INVs:** `runtime-core` stays PixiJS-free and the behavioral source of truth (the binary codec lives in
  `packages/format`, the contract owner, not a renderer); fixtures are generated from `runtime-core` and
  committed (binary rig twins, seed/PRNG golden vectors); TS strict, no `any`/unjustified `as` in
  `format`/`runtime-core` (byte access through `DataView` with explicit typed reads); 60fps, pooled, no
  per-frame allocation in any runtime solve/render loop; no em-dashes anywhere.

---

## 4. Decisions of record (a reviewer enforces these)

1. **Binary is an EXPORT artifact, never the editor's save format.** The editor's working/save format stays
   JSON; binary is the native-runtime shipping load path. JSON to binary to JSON round-trips losslessly
   (deep-equal). It carries the SAME `formatVersion` as the JSON.
2. **The MRNT container** is our own layout: `MRNT` magic, version, the encoded logical schema, a string
   table (deduped), and a pinned CRC-32/ISO-HDLC trailer. Decode validates magic/version/CRC and then the
   SAME schema validator; bad input fails loudly with a typed `BinaryDecodeError`.
3. **The Export Profile is a THIRD store** (alongside the undoable document and ephemeral Zustand): atlas
   page size/padding/rotation/blend-binning/texture-transport/compression targets, per-device-profile
   `MAX_LIVE_PARTICLES` budgets and ambient quality tiers, and per-surface cold-start budgets. Its own
   `exportProfileVersion`, Zod-validated on load, fenced from the document by lint + a disjoint-fields test.
4. **One shared C# solve core** (`Marionette.Runtime.Core`, no engine types) backs BOTH Unity and Godot
   (ADR-0001). The TS `runtime-core` stays the independent oracle; A.2 coverage is the sole compensating
   control for the shared core. Godot's conformance dump runs through the real Godot headless load + render
   path, not a bare C# console.
5. **Texture compression stays OUT of the format** (a sidecar manifest); each runtime selects an ASTC/BC7/
   ETC2 variant from the STATIC GPU capability set with a tested PNG fallback, never reading frame rate.
6. **The mobile profile is a playback profile, not the conformance tier.** Conformance always runs at the
   reference tier `high`; the mobile profile scales ambient counts only.

---

## 5. Work package map (build order)

Critical path: **WP-5.0 -> WP-5.1 -> {WP-5.3, WP-5.4} -> WP-5.5 -> WP-5.7 -> WP-5.8.** WP-5.2 (atlas) runs in
parallel with WP-5.1; WP-5.6 (mobile) attaches after WP-5.3 delivers the playable Unity build.

| WP | Deliverable | Headless? |
|---|---|---|
| **5.0** | Risk-first freeze: pick the one ship game, freeze assets + `SpinResult` corpus, author + freeze `export-profile.json`, the Zod schema + `loadExportProfile`/`saveExportProfile`, the disjoint-fields guard | Schema + loader + freeze + guard: YES. The Export Settings editor panel: GUI, no. |
| **5.1** | Binary codec in `packages/format`: `encodeBinary`/`decodeBinary`, MRNT container + CRC-32, string-table dedup, semver alignment, JSON to binary to JSON round-trip, committed binary rig twins, size/parse benchmarks | YES (pure TS) |
| **5.2** | Atlas optimization + compressed-texture pipeline: POT pages (2048 default, 4096 opt-in), deterministic multi-page packing, blend-binning, KTX2/UASTC transport, mips, the runtime-web variant SELECTOR + PNG fallback | Packing determinism + selector logic: YES. GPU transcode/device: no. |
| **5.3** | Unity runtime: the shared `Marionette.Runtime.Core` C# solve, the Unity dynamic-Mesh adapter, the binary loader, the texture-variant loader, the PLAYABLE frozen-game build, the conformance dump | No (needs Unity) |
| **5.4** | Godot runtime: reuse the C# core, an ArrayMesh adapter, the binary loader, the texture loader, the conformance dump through the real Godot headless path | No (needs Godot) |
| **5.5** | Three-runtime conformance in CI (`conformance-native.yml`) + the cross-language seed/PRNG equivalence (`spinSeed` + `hash32` golden vectors, TS vs C#) + binary-twin loading + the A.2 coverage assertion | The TS-side golden vectors + harness wiring: YES. The native CI jobs: need the runtimes. |
| **5.6** | Mobile device profiling of the WP-5.3 Unity build on a named device: 60fps, cold-start + main-thread budgets, the mobile particle profile applied deterministically | No (real hardware) |
| **5.7** | Release pipeline: create `release.yml`, sign + auto-update the editor, publish versioned runtime artifacts, gate every release on green conformance + the format semver check | No (signing + publish) |
| **5.8** | Reference-game integration and ship (the DoD): final assembly, the live real-engine run, side-by-side web-vs-Unity verification | Mostly manual / live |

---

## 6. Start here (a fresh headless session)

1. **Close G5.8 first:** audit whether `spinSeed(spinId: string): number` is pinned in `runtime-core` with a
   committed golden vector. If it is implicit, define it (the string-to-uint32 derivation feeding
   `hash32(spinId, effectInstanceIndex)`) and commit the golden vector. Pure logic, fully CI-verifiable.
2. **Audit G5.3:** confirm the A.2 coverage meta-test exists and is green, and that the extended rig catalog
   (events/draw-order, blend-mode, transform-mode, ik-into-transform, weighted-deform, events-loop) is
   committed. This is the sole compensating control for the shared C# core, so it must be solid before any
   native runtime is trusted. Add the missing rigs + the coverage assertion if absent.
3. **Build WP-5.1 (the binary codec):** `encodeBinary`/`decodeBinary` in `packages/format`, the MRNT
   container + CRC-32/ISO-HDLC, the string table, the same-`formatVersion` alignment, the JSON to binary to
   JSON round-trip test over the committed rigs, and the committed `.bin` rig twins (regenerate-twice yields
   zero diff). This is the keystone the native runtimes load and is fully headless.
4. **Build the WP-5.0 headless core:** the `exportProfileSchema` (Zod) + `loadExportProfile`/`saveExportProfile`
   + the disjoint-fields guard (`keyof ExportProfile` is disjoint from the `SkeletonDocument` field set), with
   round-trip and typed-error tests. Defer the Export Settings GUI panel.
5. **Stage WP-5.5's TS side:** the cross-language seed/PRNG golden vectors (`spinSeed`, `hash32`) and the
   `conformance-native.yml` scaffold, so the native runtimes have a target the moment they exist.

Everything else (Unity, Godot, device profiling, release signing) waits for an environment with those
toolchains. The committed fixtures + binary twins are the contract that lets that work proceed independently.

The governing reminder, unchanged from Phase 4: no runtime adds outcome logic. Unity and Godot read
`SpinResult` and authored scene data and nothing else. A reviewer who sees otherwise rejects the PR.
