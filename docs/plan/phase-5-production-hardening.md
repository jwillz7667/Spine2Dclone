# Phase 5: Production hardening

> Plan of record. Requires senior reviewer sign-off before WP-5.1 starts.
> Codename Marionette. Authoritative source: `MARIONETTE_HANDOFF.md` (format and binary note section 6, math boundary section 7, editor vs document state section 8.2, commands section 8.1, particle determinism section 8.8, atlas section 8.9, slot layer section 8.10, runtimes and conformance section 8.11, roadmap section 9, risks section 10, conventions section 11).
> Particle determinism, quality tiers, and the global budget / eviction policy are owned by `docs/plan/phase-3-vfx-particles.md` (sections 7.3 and 8.8) and are referenced here as the normative contract, never re-specified or amended.
> Harness, tolerance, and CI details are owned by `docs/plan/cross-cutting/conformance-and-ci.md` and are cross-referenced here by WP-V.x / section letter, never re-specified.
> The shared C# runtime core and the amended conformance independence model are recorded in `docs/adr/0001-shared-csharp-runtime-core.md`; this plan references that ADR, it does not restate the decision as a table row.

| Field | Value |
|---|---|
| Phase | 5 (Production hardening) |
| Plan ID | PHASE-5 |
| Status | Draft, awaiting senior reviewer sign-off |
| Owner | Runtime / Platform lead |
| Predecessor gate | PHASE-4 milestone GREEN (entry gate, section 2). Law 5: Phase 5 does not start until Phase 4 passes. |
| Milestone (exit) | One full reference game shipped through Marionette to web AND Unity, with conformance parity verified across web + Unity + Godot in CI within the single tolerance policy (A.5). Per ADR-0001, the independent oracle is the TS `runtime-core`; Unity and Godot share one validated C# solve core, so cross-language parity is TS-vs-C# and Unity-vs-Godot agreement is structural by construction, with the A.2 coverage checklist as the sole compensating control. |
| Successor | None. Phase 5 is the terminal phase; its artifact is a shippable, versioned, signed product plus three conformance-green runtimes. |
| Rough effort | 2 to 4 months solo + AI. Variance dominated by native runtime drift hunting and device perf, not algorithms. |

---

## 1. Phase goal and exit milestone

Phase 5 turns a working editor (Phases 0 to 4) into a shipped product. The single deliverable that defines success:

**One full reference game (hero rig + slot scene, driven by the real certified math engine) is exported to a binary
document plus an optimized atlas, plays in the web runtime AND the Unity runtime, and the full conformance fixture
set is green for web + Unity + Godot in CI within the committed tolerance.**

The independence claim is stated precisely so it is not oversold (the full record is ADR-0001). TS `runtime-core` is
the single independent oracle. Unity and Godot reuse ONE engine-agnostic C# solve core (`Marionette.Runtime.Core`).
Conformance therefore proves TS-vs-C# parity across the whole fixture set, and Unity-vs-Godot agreement is guaranteed
by construction (same C# solve) and exercised through each engine's actual load + render path, not by two independent
solves. This trade is deliberate (one fewer reimplementation, zero engine-to-engine drift).

**The compensating control for the lost independent cross-check (read this before signing off on the shared core).**
Under the shared-core model, a bug in `Marionette.Runtime.Core` that the committed fixtures do not exercise would pass
IDENTICALLY in Unity and Godot, because there is no second independent engine to disagree. The only remaining
cross-implementation guard is TS-vs-C# parity, and that itself only covers paths a committed fixture exercises.
Therefore the A.2 reference-rig coverage checklist is now the SOLE compensating control: every solve branch (IK both
bend directions, every non-`normal` `transformMode`, `stepped` and `bezier` curves, deform-after-skin, draw-order
reorders, per-slot blend mode and color) MUST be exercised by a committed fixture, and the A.2 coverage meta-test
MUST be green. Any solve path not exercised by a committed fixture has ZERO cross-implementation verification under
this model (ADR-0001). G5.3 (entry gate) and TASK-5.5.8 (the shared-core coverage assertion) enforce this.

Decomposed, the exit milestone requires all of the following to be simultaneously true and verifiable (full acceptance script in section 13):

1. The editor exports a binary encoding of the exact same logical schema as the JSON format, semver-aligned with the JSON format, and JSON to binary to JSON round-trips losslessly (deep-equal). The editor's native working/save format stays JSON (handoff section 6); binary is an export artifact and the native-runtime shipping load path, never the editor's save format (section 4.2).
2. The atlas pipeline emits mobile-tuned pages (2048 default, 4096 opt-in), power-of-two, with measured trim and rotate efficiency, deterministic multi-page packing, and mip plus GPU-compression handling that does not change the format contract; compressed variants are loaded by each shipping runtime with a tested PNG fallback.
3. A Unity runtime (C#) reproduces the runtime-core solve within the A.5 tolerance for every committed fixture, rendering via dynamic `Mesh` updates.
4. A Godot runtime (ArrayMesh / MeshInstance2D), running the shared C# core through the Godot engine load path, reproduces the same solve within the same tolerance for every committed fixture.
5. CI runs the Unity and Godot conformance jobs headless, compares against the same committed fixtures with the single tolerance policy, and any drift fails a required check via the `ci-pass` aggregator.
6. The reference game sustains 60fps on a named real mobile device with the mobile particle profile applied: AMBIENT effects scaled by the quality tier, DETERMINISTIC win effects at their authored counts (authored within the mobile budget at freeze time), inside the per-surface cold-start and main-thread budgets.
7. The release pipeline packages, signs, and auto-updates the editor, publishes versioned runtime artifacts, and gates every release on green conformance plus the format semver check.

---

## 2. Entry gate: Phase 4 must be GREEN

Do not begin WP-5.1 until every item below is checked. This gate is non-negotiable (Law 5, phase independence).

- [ ] G5.1 Phases 0 to 4 milestones are green: bone puppet (Phase 1), rigging (Phase 2), VFX (Phase 3), and the slot composer (Phase 4) all pass their Definition of Done.
- [ ] G5.2 `packages/conformance` web suite (WP-V.0 through WP-V.4) is a required check and green: rigs, sample-spec, fixture schema, generator, committed fixtures, fixtures-lock gate, compare engine, tolerance policy. The committed fixtures are the exact contract the native runtimes must meet (D.9).
- [ ] G5.3 The full reference rig catalog exists and is green for web (A.2): `rig-2bone`, `rig-weighted-mesh`, `rig-ik-2bone`, `rig-deform`, `rig-events-draworder`, `rig-transform-constraint`, and the extended catalog (`rig-ik-into-transform`, `rig-weighted-deform`, `rig-transform-modes`, `rig-blendmodes`, `rig-events-loop`). The A.2 coverage checklist meta-test passes for EVERY solve branch (IK both bend directions, every non-`normal` transformMode observable, stepped and bezier curves, deform-after-skin, draw-order reorders, all four blend modes). This gate is load-bearing for Phase 5 because, per ADR-0001, A.2 coverage is the sole compensating control for the shared C# core.
- [ ] G5.4 WP-V.5 slot-presentation determinism is a required check (Law 1): the same canned `SpinResult` yields an identical event/transform/draw-order stream twice; presentation reads no RNG, wall-clock, or `Date`.
- [ ] G5.5 Perf gates (WP-V.8) are green: frame-time baseline, per-frame allocation gate, particle pool high-water-mark gate.
- [ ] G5.6 The real math engine adapter in `packages/math-bridge` is wired (Phase 4) and emits `SpinResult` objects; the slot scene plays a win sequence, a free-spin trigger, and a tumble cascade.
- [ ] G5.7 The editor is packageable: `electron-builder` config exists, the editor main process boots with a `--smoke` mode that loads a reference rig and renders one frame, and the Phase 3 particle subsystem exposes the per-scene `MAX_LIVE_PARTICLES` budget plus quality tier (section 8.8) that the mobile profile will set. `release.yml` does not yet exist and is NOT a precondition: its creation is OWNED by WP-5.7 (TASK-5.7.1). The cross-cutting WP-V.11 label has been corrected at the source from "scaffold in Phase 0" to "created in Phase 5" (see the corrective edit to `conformance-and-ci.md`), so this gate verifies only the inputs WP-5.7 needs.
- [ ] G5.8 The particle seed derivation is pinned bit-exactly by its owning plan BEFORE WP-5.3/5.4 may claim particle determinism. Phase 3 section 8.3 pins the integer PRNG and `hash32(a: number, b: number)`; Phase 4 supplies the trigger seed `hash32(spinId, effectInstanceIndex)`. Because `spinId` is a string and `hash32` takes two numbers, the string-to-uint32 derivation `spinSeed(spinId: string): number` MUST be defined in `runtime-core` (the oracle, INV-2) and committed as a golden vector. If that derivation is still implicit or "for example" in Phase 3/4, that is a Phase 3/4 defect that BLOCKS this gate; Phase 5 does not invent it (that would amend the Phase 3 contract). Phase 5 LOCKS whatever is pinned via the cross-language equivalence test (TASK-5.5.7).

If any box is unchecked, Phase 5 is blocked. Hardening a soft foundation wastes the most expensive native and device work in the project.

---

## 3. Architectural laws this phase must honor (call-outs)

| Law / invariant | How Phase 5 honors it | Enforced by |
|---|---|---|
| Law 1: math/presentation boundary | The Unity and Godot runtimes consume `SpinResult` from the certified engines and are pure deterministic presentation. The mobile particle profile (WP-5.6) scales ONLY ambient effects (`deterministic: false`) via the Phase 3 quality tier (section 8.8) and relies on the Phase 3 NORMATIVE deterministic eviction (ambient evicted before deterministic); DETERMINISTIC win effects always run at their AUTHORED counts (Phase 3 section 7.3), authored within the mobile budget at freeze time (WP-5.0). No cap or LOD reads measured frame rate, so the same `SpinResult` on the same profile yields identical visuals every run. No runtime adds outcome logic. | WP-5.3, WP-5.4, WP-5.6; WP-V.5; phase-3 7.3/8.8 |
| Law 2: all mutations are commands | Phase 5 adds essentially no document mutations. Binary export and atlas tuning read the document and write to the Export Profile store (section 4.1), which is NOT the undoable document. The only document-touching command is the pre-existing `SetAtlasRef`. Any new document field is a STOP-and-ADR event (section 8). | WP-5.1, WP-5.2; section 9; section 4.1 |
| Law 3: the data format is the contract | Binary is a re-encoding of the IDENTICAL logical schema (handoff section 6). It carries the SAME `formatVersion` semver as the JSON. After decode it is validated by the SAME schema/validator and fails loudly on violation. Texture compression and mip handling are deliberately kept OUT of the format (sidecar manifest). The Export Profile is a separate store with its own `exportProfileVersion`, fenced from `SkeletonDocument` by lint and a disjoint-fields test (section 4.1) so it can never become a silent format change. | WP-5.1, WP-5.2; section 4.1; D.11 semver gate |
| Law 4: Spine legal boundary | The binary container is our own (`MRNT` magic, our layout). It is NOT Spine `.skel` compatible, claims no compatibility, and vendors no Spine code. Unity/Godot solves are first-principles ports of `runtime-core`. | WP-5.1, WP-5.3, WP-5.4 |
| Law 5: phase independence, build in order | Section 2 entry gate. Within the phase, the WP dependency graph (section 5) is enforced at the WP grain. | section 2, section 5 |
| INV runtime-core is PixiJS-free and is the behavioral source of truth | The binary codec lives in `packages/format` (the contract owner), not in a renderer. `runtime-core` has no renderer import; PixiJS lives only in `runtime-web` (the renderer). Native runtimes are ports of `runtime-core`, validated against fixtures generated from `runtime-core` (INV-2). | WP-5.1, WP-5.3, WP-5.4; D.5 |
| INV fixtures generated from runtime-core, committed | The committed binary rig twins (WP-5.1) and the seed/PRNG golden vectors (TASK-5.5.7) are generated deterministically by `runtime-core` / the TS codec; native runtimes load them. No fixture is hand-edited. | WP-5.1, WP-5.5 |
| INV TS strict, no `any`, no unjustified `as` in format + runtime-core | The binary codec in `packages/format` is TS-strict with no `any` and no unjustified `as`; byte access is through `DataView` with explicit typed reads. | WP-5.1; D.4, D.5 |
| INV 60fps, pool objects, no per-frame allocation | Unity reuses vertex arrays with `MarkDynamic` + `Mesh.SetVertices`; Godot reuses `PackedVector2Array` (held to a measured per-frame allocation ceiling where Godot's 2D API forces an allocation, TASK-5.4.3); particles pool with static caps. No unbounded per-frame allocation in any runtime solve/render loop. | WP-5.3, WP-5.4, WP-5.6; WP-V.8 |
| No em-dashes anywhere | This document, all code, comments, and UI copy use commas, parentheses, or separate sentences. | review, D.5 no-em-dash lint |

---

## 4. WP-5.0 (RISK-FIRST): pin the one shippable reference game, freeze its assets, freeze the Export Profile

This is a gate, not a formality. The milestone is "one full game shipped", so the game (and the Export Profile that
governs how it exports and plays back) must be chosen and frozen before any hardening work, or every later WP chases
a moving target.

| ID | Task | Owner | Done when |
|---|---|---|---|
| TASK-5.0.1 | Select the single reference game from the Phase 4 slot scenes. It must exercise the full stack: a weighted-mesh + two-bone-IK + deform hero character (Phase 2), at least two particle presets (coin shower + ray burst, Phase 3), a win sequencer with a big/mega escalation, a free-spin trigger, and a tumble/cascade grid (Phase 4). CONSTRAINT (Law 1, R1 reconciliation): the DETERMINISTIC win effects (big/mega coin shower, ray burst) are AUTHORED so their peak simultaneous live-particle count fits inside the mobile `MAX_LIVE_PARTICLES` budget (section 4.1 profile, the Phase 3 section 8.8 per-scene budget) with headroom for ambient effects. Deterministic effects are never count-scaled or spawn-rate-LOD'd at runtime (Phase 3 section 7.3), so authoring time is the ONLY legal place to fit them within the mobile budget. | Lead | The game is named and recorded in `docs/plan/phase-5-ship-target.md`, and the deterministic win effects' authored peak count is recorded and shown to be <= the mobile budget minus the reserved ambient headroom. |
| TASK-5.0.2 | Freeze the asset set: the rig documents, atlas source sprites, particle configs (including the authored deterministic counts from TASK-5.0.1), slot scene, and the canned plus real `SpinResult` corpus used to drive presentation. Commit under `packages/conformance/assets/ship/`. | Lead | A frozen manifest with content hashes is committed; later WPs reference this exact set. A test asserts the frozen deterministic win-effect peak count fits the frozen mobile `MAX_LIVE_PARTICLES` budget. |
| TASK-5.0.3 | Define the ship targets explicitly: web runtime AND Unity runtime are the SHIP targets (handoff section 9 milestone). Godot is a conformance-green third runtime, not a ship target in this phase. Record this so scope does not creep into a Godot game build. | Lead + reviewer | A one-line scope decision is recorded and signed off. |
| TASK-5.0.4 | Author and freeze the ship Export Profile (section 4.1): `packages/conformance/assets/ship/export-profile.json` carrying the atlas page size / padding / rotation / blend-binning / texture-transport / compression targets, the per-device-profile `MAX_LIVE_PARTICLES` budgets and ambient quality tiers, and the per-surface cold-start budgets. It is Zod-validated on load and is an INPUT to every downstream benchmark and device test. | Lead | The frozen `export-profile.json` validates against `exportProfileSchema` and is committed with a content hash in the freeze manifest. |
| TASK-5.0.5 | Lock the Export Profile out of the document contract: add the lint and disjoint-fields guard from section 4.1 so the profile can never leak into `SkeletonDocument`. | Lead | The cross-import lint rule and the disjoint-fields test are committed and green; changing a profile field does not trip the D.11 format semver gate and vice versa. |
| TASK-5.0.6 | Editor-side Export Profile loader (the owner of the section 4.1 boundary): implement `loadExportProfile(projectRoot)` in `apps/editor/renderer/export/export-profile/` that reads `<project-root>/export-profile.json`, Zod-validates it against `exportProfileSchema`, and returns a typed `ExportProfile` or a typed `ExportProfileError` discriminated union (`{ kind: 'missing' } | { kind: 'invalid'; issues } | { kind: 'unreadable'; cause }`). It is invoked at editor startup AND at export time; an invalid or missing profile fails loudly with `ExportProfileError`, never a silent default. Persistence (`saveExportProfile`) writes the validated profile back to the same path. | Lead | Unit tests: a valid file loads to a typed `ExportProfile`; a malformed file yields `ExportProfileError.invalid` with the Zod issues; an absent file yields `ExportProfileError.missing`; a round-trip `load(save(p))` deep-equals `p`. The export flow refuses to run on an `ExportProfileError`. |
| TASK-5.0.7 | Minimal editor wiring/UI for the profile: a read-only-by-default Export Settings panel surfaces the loaded profile (page size, transport, particle profiles, cold-start budgets) and edits persist via `saveExportProfile` (TASK-5.0.6). This is project state, NOT a `Command` and NOT undoable (section 4.1, Law 2). The startup and export-time validation hook from TASK-5.0.6 is wired here. | Lead | An editor smoke test loads the frozen ship profile, renders the panel without throwing, edits a field, persists it, reloads, and reads back the edit; an invalid hand-edited file surfaces the typed error in the panel rather than crashing. |
| TASK-5.0.8 | Lock the Export Profile out of the document contract is verified end to end alongside TASK-5.0.5: a unit test asserts `keyof ExportProfile` and the `SkeletonDocument` top-level field set are DISJOINT. | Lead | The disjoint-fields test is committed and green (shared assertion with TASK-5.0.5). |

**Gate decision (must be recorded before WP-5.1):**

- [ ] DECISION-5.0: The reference game is frozen (assets + `SpinResult` corpus + Export Profile), the deterministic win effects are authored within the mobile particle budget, and the ship targets are web + Unity with Godot conformance-only. Any later change to the frozen game or profile is a reviewed re-freeze, not an ad-hoc edit.

Rationale for risk-first ordering: binary size benchmarks, atlas tuning, mobile perf caps, and the native runtimes are all measured against THIS game and THIS profile. A floating target invalidates every benchmark baseline downstream.

### 4.1 The Export Profile: the third store (defined here)

Handoff section 8.2 defines exactly two stores: the undoable, saved `DocumentModel`, and ephemeral Zustand editor
state (selection, tool, camera, playback position, layout). A reproducible, CI-gated, byte-stable export and a
deterministic mobile playback profile cannot live in either: not the document (it is not skeletal data and must not
trip Law 3), and not ephemeral Zustand (it must persist and be committed). Phase 5 therefore defines a THIRD store,
the **Export Profile**, and pins exactly what it is.

**What it is.** A committed, versioned, schema-validated project artifact holding export and playback knobs only. It
carries NO document data. Concretely (Zod schema is the boundary validator, INV strict, no `any`; both device
profiles are REQUIRED keys via `z.object`, not a partial `z.record`, so a missing profile fails loudly; versions are
semver-pattern-validated):

```ts
// apps/editor/renderer/export/export-profile/export-profile.schema.ts
import { z } from 'zod';

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/, 'must be a semver string');

const deviceParticleProfile = z.object({
  // The Phase 3 per-scene MAX_LIVE_PARTICLES budget (section 8.8) for this profile.
  maxLiveParticles: z.number().int().positive(),
  // Phase 3 quality tier; scales spawn rate + maxParticles for ambient (deterministic:false) ONLY.
  ambientQualityTier: z.enum(['low', 'medium', 'high']),
});

export const exportProfileSchema = z.object({
  // Semver of THIS schema, INDEPENDENT of SkeletonDocument.formatVersion.
  exportProfileVersion: semver,
  atlas: z.object({
    maxPageSize: z.union([z.literal(2048), z.literal(4096)]),
    padding: z.number().int().min(0).max(8),
    allowRotation: z.boolean(),
    blendBinning: z.boolean(),
    // DECISION-5.2.b: 'uastc-ktx2' (single transcodable artifact, preferred) or 'per-target-sidecar' (fallback).
    textureTransport: z.enum(['uastc-ktx2', 'per-target-sidecar']),
    // Transcode/encode targets used by whichever transport is chosen.
    compressionTargets: z.array(z.enum(['astc6x6', 'bc7', 'etc2'])).nonempty(),
  }),
  // Both keys REQUIRED. Scales AMBIENT effects only.
  particleProfiles: z.object({
    mobile: deviceParticleProfile,
    desktop: deviceParticleProfile,
  }),
  // Android has no native cold-start budget this phase (no Android native ship build); it is throughput-gated only.
  coldStartBudgets: z.object({
    unityIosNativeMs: z.number().int().positive(),
    webWarmFirstFrameMs: z.number().int().positive(),
    webColdInteractiveMs: z.number().int().positive(),
  }),
});

export type ExportProfile = z.infer<typeof exportProfileSchema>;
```

There is deliberately NO deterministic-particle-count field. Deterministic counts are authored in the effect configs
(the document/asset layer), never in the profile, so the profile has no lever to scale a deterministic effect. This
is what keeps Law 1 clean: the only particle knobs the profile exposes are the ambient tier and the per-scene budget,
both of which the Phase 3 contract already permits.

**Where it persists.**

- Per project: `<project-root>/export-profile.json`, committed alongside the project, NOT inside the JSON document and NOT in Zustand. Loaded and Zod-validated at editor startup and at export time by `loadExportProfile` (TASK-5.0.6); an invalid or missing profile fails loudly with a typed `ExportProfileError`, never a silent default. Persistence is `saveExportProfile` (TASK-5.0.6); the editor surface is the Export Settings panel (TASK-5.0.7).
- Ship target: `packages/conformance/assets/ship/export-profile.json`, frozen and committed in WP-5.0 (TASK-5.0.4). This is the profile every Phase 5 benchmark, device test, and ship-bundle export reads.

**How lint/CI keeps it out of `SkeletonDocument` (Law 3 protection).**

- A `no-restricted-imports` lint rule forbids the export-profile module from importing `@marionette/format` document types, and forbids `packages/format` from importing the export-profile module. A profile field can never reach the document schema, and a document field can never reach the profile.
- A unit test asserts `keyof ExportProfile` and the `SkeletonDocument` top-level field set are DISJOINT (no shared names), so the two stores cannot silently converge into one (TASK-5.0.5/5.0.8).
- The format semver gate (D.11) diffs `packages/format` only. The Export Profile has its OWN `exportProfileVersion` and its OWN CODEOWNERS entry, so changing a profile field is a reviewed act that neither trips D.11 nor is tripped by it. Changing the profile schema bumps `exportProfileVersion`, never `formatVersion`.

**Commands.** None. The Export Profile is project state, not the undoable document; editing it is not a `Command` and is not undoable (it is the same category as Phase 1's hypothetical "app prefs", now made concrete).

### 4.2 Working format vs export format (the `.mrnt` clarification)

The editor's native working and save format remains JSON (handoff section 6: JSON is the working format, binary is an
export optimization). The binary container introduced by WP-5.1 is an EXPORT artifact and the native-runtime shipping
load path; it is NOT the editor's save format. Consequences pinned so no load path goes untasked:

- The editor SAVES and LOADS JSON `SkeletonDocument`s. There is no editor-side binary IMPORT path, so no "rebuild `DocumentModel` + reset `History` from binary" task exists or is needed in this phase.
- The `MRNT` magic names the binary CONTAINER only (Law 4). It is not a document file extension the editor opens. We do not call the working document a ".mrnt document" anywhere; the working document is JSON.
- The binary decode path that DOES exist is in the native runtimes (WP-5.3/5.4) and in `packages/format` (`decodeBinary`, used by the conformance harness and tests). The editor exporter only ENCODES (TASK-5.8.1).

If a future phase wants a binary native save format, that is new scope (a binary import path into the editor with its own `DocumentModel` rebuild + `History` reset + tests); it is an explicit Phase 5 non-goal (section 14).

---

## 5. Work package map and sequencing

Dependencies flow left to right. A package may not start until its prerequisites are GREEN (Law 5 at the WP grain).

| WP | Title | Lands in | Depends on | Sub-milestone |
|---|---|---|---|---|
| WP-5.0 | Ship-target selection, asset freeze, Export Profile freeze + loader | `docs/plan`, `packages/conformance/assets/ship`, `apps/editor/.../export-profile` | Phase 4 green | gate |
| WP-5.1 | Binary export (codec, versioning, round-trip, size/parse bench) | `packages/format`, `packages/conformance` | WP-5.0 | M5.a |
| WP-5.2 | Atlas optimization + compressed-texture pipeline (export + web consumer) | `apps/editor/export`, `apps/editor/main`, `packages/runtime-web` | WP-5.0 (parallel with WP-5.1) | M5.b |
| WP-5.3 | Unity runtime (C# core + Unity Mesh adapter, texture loader, playable frozen-game build, conformance dump) | `runtimes/unity`, shared `Marionette.Runtime.Core` | WP-5.1 + G5.2 conformance harness | M5.c |
| WP-5.4 | Godot runtime (shared C# core + ArrayMesh adapter, texture loader, conformance dump) | `runtimes/godot`, shared `Marionette.Runtime.Core` | WP-5.1 + G5.2 conformance harness | M5.c |
| WP-5.5 | Conformance green across all three runtimes in CI + seed/PRNG cross-language equivalence | `.github/workflows/conformance-native.yml`, `packages/conformance` | WP-5.3, WP-5.4 | M5.d |
| WP-5.6 | Mobile performance profiling (device, caps, budgets, regressions) of the WP-5.3 playable Unity build | `runtime-web`, `runtimes/unity`, particle subsystem | WP-5.3, WP-5.2, WP-5.0 | M5.e |
| WP-5.7 | Build / release pipeline (create release.yml, sign, auto-update, artifact publish, gates) | `.github/workflows/release.yml`, `apps/editor/main` | WP-5.5 (release gates need green conformance) | M5.f |
| WP-5.8 | Reference game integration and ship (DoD) | `packages/conformance/assets/ship`, all runtimes | all above | M5.exit |

Sub-milestones (each is a usable, demonstrable artifact):

- **M5.a** A frozen game document round-trips JSON to binary losslessly and parses faster and smaller than JSON, benchmarked.
- **M5.b** The frozen atlas packs into mobile-tuned, POT, deterministic pages with measured efficiency and a transcodable texture artifact (single UASTC KTX2 per page by default, or per-target sidecars in fallback), byte-stable for JSON+PNG and content-hash-stable for the compressed artifact, and `runtime-web` selects and decodes a compressed variant with a tested PNG fallback.
- **M5.c** A native runtime (Unity or Godot) plays the frozen game and produces a conformance dump. For Unity specifically, this build is the playable frozen-game build that WP-5.6 profiles (TASK-5.3.8).
- **M5.d** All three runtimes are conformance-green in CI; the seed/PRNG path is bit-identical across TS/C#/GDScript; drift is red via `ci-pass`.
- **M5.e** The frozen game holds 60fps within the per-surface budgets on a named device with the mobile particle profile (ambient scaled, deterministic at authored counts).
- **M5.f** A signed, auto-updating editor build plus versioned runtime artifacts are published only when conformance is green.

**Sequencing and parallelism (the load-bearing schedule decision):**

- WP-5.1 (binary) and WP-5.2 (atlas) run in parallel; they touch disjoint code (format codec vs export pipeline + web texture consumer).
- WP-5.3 (Unity) and WP-5.4 (Godot) run IN PARALLEL once WP-5.1 is stable (the binary codec plus committed binary rig twins exist) and the conformance harness from Phase 1 (G5.2) is stable. This is the explicit parallelization the handoff anticipates: the fixtures and tolerance already exist, so each native runtime is an independent track that only needs to load the rigs and match the committed fixtures.
- Per ADR-0001, ONE engine-agnostic C# solve core is shared between Unity and Godot, so the parallel tracks are "render adapter + texture loader per engine" on top of one validated core, not two full reimplementations.
- WP-5.3 (TASK-5.3.8) delivers the PLAYABLE frozen-game Unity build. WP-5.6 PROFILES that exact build on device; it does not build a new one. So the integration order is: WP-5.3 builds and plays the frozen game in Unity, WP-5.6 profiles it on hardware, and WP-5.8 (TASK-5.8.3) is FINAL assembly and side-by-side verification, not first integration. There is no circular dependency: the playable build exists at the end of WP-5.3, before WP-5.6 and WP-5.8.
- WP-5.5 needs both native runtimes; WP-5.6 needs the WP-5.3 Unity build plus the optimized atlas and compressed-texture loaders; WP-5.7 gates on WP-5.5. WP-5.8 is the final integration.

Critical path: WP-5.0 -> WP-5.1 -> {WP-5.3, WP-5.4} -> WP-5.5 -> WP-5.7 -> WP-5.8. WP-5.2 and WP-5.6 attach off the side and merge before WP-5.8 (WP-5.6 specifically attaches after WP-5.3 delivers the playable Unity build).

---

## 6. Work packages in detail

Each WP lists scope, the commands it introduces (Law 2), the law touchpoints, and independently verifiable acceptance criteria. No "etc."; every criterion is testable. Where an acceptance check would otherwise be subjective ("looks right"), it is either tied to the advisory pixel-diff job (WP-V.8) against a committed reference image at a stated threshold, or labelled MANUAL with a written checklist.

### WP-5.1 Binary export

**Scope.** A compact binary encoding of the EXACT logical schema in handoff section 6. The binary is not a new format; it is a second serialization of `SkeletonDocument`. The codec lives in `packages/format` (the contract owner) so the editor, `runtime-web`, the conformance harness, and the native runtimes all share one definition. TypeScript-strict, no `any`, no unjustified `as` (INV-4). The editor uses this codec to ENCODE only; the editor's save format stays JSON (section 4.2).

**Law call-outs.** Law 3 (same logical schema, same `formatVersion`, validated on decode, fail loudly). Law 4 (our own container, not Spine `.skel`, no compatibility claim).

#### 6.1.1 Encoding approach (DECISION-5.1: container layout)

A single-file, little-endian container. Layout:

| Region | Bytes | Field | Notes |
|---|---|---|---|
| Header | 4 | magic = `0x4D 0x52 0x4E 0x54` (`MRNT`) | Our magic. Not Spine. A decoder rejects any other magic loudly (Law 4, Law 3). |
| Header | 1 | `containerVersion` (uint8) | The BINARY LAYOUT revision (section 6.1.2). |
| Header | 1 | `flags` (uint8) | bit0 = lossless float64 marker. It is SET (1) for the default lossless profile and would be CLEARED (0) by a future opt-in float32 transport profile (DECISION-5.2). Bits 1 to 7 are reserved and MUST be 0. |
| Header | varint + bytes | `formatVersion` (UTF-8) | The SAME semver string as `SkeletonDocument.formatVersion` (Law 3). Read before sections. |
| String table | varint count, then per string: varint length + UTF-8 bytes | deduplicated strings | All names, paths, attachment keys, animation keys, event names, and string event values are varint indices into this table. This is where binary crushes JSON: repeated bone/slot/attachment names are stored once. Ordering rule below. |
| Sections | length-prefixed blocks in fixed order | bones, slots, skins, ikConstraints, transformConstraints, events, animations, atlas | One block per top-level field of `SkeletonDocument`. Each block is `varint byteLength` then its payload, so an unknown future block can be skipped by a forward-compatible reader. |
| Trailer | 4 | `crc32` (uint32 LE) of all preceding bytes | Integrity check; a corrupt file fails loudly before schema validation. CRC variant pinned in 6.1.5. |

**String-table ordering rule (determinism, suggestion 11).** Strings are emitted in FIRST-ENCOUNTER order under a
fixed document traversal: the section-6 top-level field order (bones, slots, skins, ikConstraints,
transformConstraints, events, animations, atlas), and within each section the array index order, and within an
element its declared field order, depth-first. The reserved null sentinel occupies index 0 before any document
string. This makes "encode the same document twice yields byte-identical output" implementable and reviewable, not
assumed.

Numeric encoding rules (one table, no per-field ambiguity):

| Logical kind | Encoding | Rationale |
|---|---|---|
| Counts, array lengths, string-table indices, bone/slot indices | LEB128 unsigned varint | Small magnitudes dominate; varint removes the 8-byte tax of JSON numbers. |
| Signed small integers (`intValue` of an event payload) | zig-zag LEB128 varint | Compact for small signed values. |
| `DrawOrderKeyframe.order` | `varint count`, then one unsigned varint string-table index per slot name | `order` is the FULL `string[]` of slot names in draw order (section 6), encoded as an array of string-table indices. We do NOT delta-encode it; storing the full index array guarantees the decoded array deep-equals the original (suggestion 9). |
| All `number` float fields (coords, rotation, weights, times, colors) | IEEE-754 float64, 8 bytes LE | LOSSLESS (DECISION-5.2). The JSON contract stores f64; storing f64 guarantees an exact JSON to binary deep-equal round-trip (section 6.1.3). We do NOT downcast to float32 in the default profile. |
| Booleans | 1 byte (0/1) | Trivial. |
| `null` (e.g. `Bone.parent`, `Slot.attachment`) | reserved string-table index 0 = the null sentinel | One canonical null encoding. |
| Enums (`BlendMode`, `transformMode`, `CurveType` tag) | uint8 tag from a fixed, versioned enum table | Stable across runtimes; the enum table is part of `containerVersion`. |
| `CurveType` bezier control points | tag byte + four float64 | Mirrors the section 6 union. |

#### 6.1.2 Versioning alignment with the JSON format (Law 3)

Two independent version numbers, with a clear contract for each:

- `formatVersion` (semver string in the header) is the LOGICAL schema version, identical to the JSON `formatVersion`. A change to the logical schema (a new field, a changed type) bumps BOTH the JSON and the binary in the same reviewed change and trips the format semver gate (D.11). A decoder REJECTS an unknown MAJOR `formatVersion` loudly (no silent best-effort parse).
- `containerVersion` (uint8) is the BINARY LAYOUT revision only. It bumps when the byte packing changes (a new section, a reordered enum table, a varint scheme change) while the logical schema is unchanged. A decoder rejects an unknown `containerVersion` loudly. This separation lets us improve packing without faking a logical-contract break, and lets us break the logical contract without conflating it with a packing tweak.

After byte-level decode, the produced object is handed to the SAME validator used for JSON import (the section 6 JSON Schema / Zod validator). A document that decodes structurally but violates an invariant (parent-after-child, bad weighted-encoding length, unknown attachment type) fails loudly with the same typed error as a malformed JSON import (Law 3). There is exactly one validator; the binary path does not get a weaker one.

#### 6.1.3 Round-trip and parity tests

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.1.1 | `encodeBinary(doc) -> Uint8Array` and `decodeBinary(bytes) -> SkeletonDocument` in `packages/format`, pure and deterministic (string-table in first-encounter order per 6.1.1, fixed section ordering). | Encoding the same document twice yields byte-identical output (determinism, needed for committed binary twins). |
| TASK-5.1.2 | JSON to binary to JSON deep-equal round-trip (DECISION-5.2 float64 losslessness). | For every committed rig and the frozen game document, `decodeBinary(encodeBinary(doc))` deep-equals `doc` EXACTLY. Not epsilon; deep-equal. |
| TASK-5.1.3 | Binary to decode to re-encode byte-identity. | For committed binary twins, `encodeBinary(decodeBinary(bytes))` equals `bytes` byte-for-byte (decoder fidelity + encoder determinism). |
| TASK-5.1.4 | Cross-loader solve parity. | Loading each rig from JSON and from its binary twin into `runtime-web`, then sampling at the sample-spec times, produces identical solve output (same code path, same fixtures; binary loader proven not to perturb the solve). |
| TASK-5.1.5 | Property-based fuzz. | A generator produces random VALID `SkeletonDocument`s (bounded sizes, valid weighted encodings); each round-trips losslessly. Malformed bytes (bad magic, truncated section, bad crc, unknown major) fail with a typed `BinaryDecodeError` discriminated union, never a bare throw or a silent partial document. |
| TASK-5.1.6 | Committed binary rig twins. | `generate.ts` (or a sibling) emits `packages/conformance/src/rigs/<rigId>.bin` for every rig from the committed JSON rig via the codec, deterministically, and records them in `.fixtures.lock`. These are the files the native runtimes load (WP-5.3/5.4). Regenerating twice yields zero diff. |
| TASK-5.1.7 | Size and parse benchmark (DECISION-5.2, committed baseline). See 6.1.4. | The six numbers in 6.1.4 are produced and gated against the committed relative baseline. |
| TASK-5.1.8 | CRC golden vector (6.1.5). | The pinned CRC-32 produces the published check value over the ASCII string `123456789`, and over each committed binary twin the trailer CRC verifies; the C# and GDScript decoders compute the identical CRC (cross-checked in TASK-5.5.7). |

#### 6.1.4 Size and parse benchmark (DECISION-5.2: float64 lossless, committed baseline)

DECISION-5.2 (the load-bearing call of this WP): the default binary uses IEEE-754 float64 for every float field so the
JSON to binary round-trip is deep-equal (section 6.1.3), not epsilon. A lossy float32 transport profile is explicitly
a SEPARATE, opt-in, non-default profile (`flags` bit0 cleared, future `containerVersion`) that would be validated
against the conformance epsilon rather than by deep-equal, and is OUT of scope for the Phase 5 default. The default
binary is the canonical, lossless re-encoding so "the data format is the contract" stays literally true.

TASK-5.1.7 runs a benchmark in `packages/format/bench` (or `packages/conformance/perf`) that measures the frozen game's
largest document and reports six numbers, committed to a baseline JSON gated by CODEOWNERS (mirrors WP-V.8 / D.8
discipline):

| Metric | Reported | Acceptance target |
|---|---|---|
| Raw size | JSON bytes, binary bytes | binary raw <= 60% of raw JSON |
| Transport size | gzip(JSON), gzip(binary) | binary gzip <= JSON gzip (binary must not lose after compression, since JSON is usually gzipped on the wire) |
| Parse + validate wall time | `JSON.parse` + validate vs `decodeBinary` + validate, median of N runs | binary parse+validate <= 50% of JSON parse+validate |

A regression beyond the committed relative threshold fails the bench gate. The gzip comparison is mandatory because comparing raw binary to raw JSON alone would overstate the win; the honest comparison includes transport compression.

#### 6.1.5 CRC-32 variant (pinned, normative)

The trailer integrity check is CRC-32/ISO-HDLC (the variant used by zlib, gzip, and PNG), pinned bit-exactly so the
TS encoder and the shared C# / GDScript decoders compute an identical value. Without pinning, a correct document could
fail to load in C# for a reason unrelated to the solve.

| Parameter | Value |
|---|---|
| Width | 32 |
| Polynomial | `0x04C11DB7` (reflected form `0xEDB88320`) |
| Init | `0xFFFFFFFF` |
| RefIn | true |
| RefOut | true |
| XorOut | `0xFFFFFFFF` |
| Check (`"123456789"`) | `0xCBF43926` |

The CRC covers all bytes preceding the trailer and is stored as uint32 little-endian. TASK-5.1.8 commits the check
vector; TASK-5.3.3 and TASK-5.5.7 prove the C# and GDScript decoders match it byte for byte. A wrong CRC fails decode
with `BinaryDecodeError.crcMismatch` before schema validation runs.

**Commands introduced:** none. Binary export is an exporter concern; it reads the document, it does not mutate it (Law 2 surface unchanged).

**runtime-core / format additions:** `encodeBinary`, `decodeBinary`, `BinaryDecodeError`, the pinned CRC-32, the binary rig-twin generator. No PixiJS, no `any`, no unjustified `as`. Byte access via `DataView` with explicit typed reads.

**Verification:** `pnpm --filter @marionette/format test` green (round-trip, fuzz, error cases, CRC check vector); `pnpm --filter @marionette/format bench` produces the committed baseline (TASK-5.1.7); the binary twins regenerate with zero diff.

---

### WP-5.2 Atlas optimization and compressed-texture pipeline

**Scope.** Tune the Phase 1 atlas pipeline (handoff section 8.9, WP-1.3) for mobile shipping: page-size profiles, trim and rotate efficiency, deterministic multi-page packing, mip plus GPU-compression handling, AND the runtime consumer that selects/decodes compressed variants in `runtime-web` (the reference consumer of the selection convention). The format contract (`AtlasRef`/`AtlasPage`/`AtlasRegion`, section 6) does NOT change by default (Law 3).

**Law call-outs.** Law 3 (no format change by default; compression and mip handling are kept out of the contract via a sidecar manifest; any need to put per-target page references INTO the contract is a STOP-and-ADR `formatVersion` bump). Law 2 (page size, padding, rotation, blend-binning, transport, and compression targets are EXPORT-PROFILE config in the section 4.1 store, not undoable document fields, so no new commands; the only document mutation remains the existing `SetAtlasRef`).

**DECISION-5.2.b (texture transport: single UASTC KTX2 by default, per-target sidecars as fallback).** The default
`atlas.textureTransport` is `uastc-ktx2`: ONE Basis Universal UASTC KTX2 file per page, transcoded AT LOAD to the
device's GPU format (ASTC, BC7, or ETC2) or decoded to RGBA for the PNG-equivalent fallback. This produces one
compressed artifact per page (not three), and it sidesteps most of the multi-encoder determinism problem because the
committed artifact is a single transcodable container rather than three independently pre-baked target binaries. The
documented FALLBACK is `per-target-sidecar`: pre-baked `<page>@astc.ktx2` + `<page>@bc7.ktx2` (+ `@etc2`) sidecars,
used only if transcode-at-load is unavailable on a target runtime. TASK-5.2.0 gates this decision by confirming Pixi
v8 actually transcodes UASTC KTX2 to native GPU formats before it is locked. The canonical PNG always remains
`AtlasPage.file` (the contract reference) under either transport.

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.2.0 | Confirm-before-lock: verify Pixi v8 (and the Unity/Godot KTX2 loaders) transcode UASTC KTX2 to native ASTC/BC7/ETC2 (vs only Basis ETC1S), and that the transcoder is available in the web build. If confirmed, lock `textureTransport: 'uastc-ktx2'` as default; if any shipping runtime cannot transcode UASTC, lock `per-target-sidecar` instead and record why. | A short committed note (`docs/plan/phase-5-texture-transport.md`) records the Pixi v8 + Unity + Godot KTX2 capability check and the locked transport; the frozen Export Profile (TASK-5.0.4) matches it. |
| TASK-5.2.1 | Page-size profiles: the Export Profile (`atlas.maxPageSize`, section 4.1) selects {2048, 4096}; default 2048 (guaranteed on GLES2/older mobile, 4096 is widely but not universally supported). Pages are power-of-two (square or rect POT) to enable mipmaps and broad GPU compatibility. | Exporting the frozen atlas at 2048 yields only POT pages no larger than 2048; switching the profile to 4096 reduces page count for the same content; both are deterministic (re-export of atlas JSON + PNG is byte-identical, WP-1.3 determinism preserved). |
| TASK-5.2.2 | Trim efficiency: tight alpha-trim (Phase 1) plus an occupancy report (packed pixels / page pixels) per page. | The packer reports occupancy; for the frozen atlas, mean occupancy is >= 75% at the chosen page size, or the report names the oversized sprites that prevent it. The report is a committed artifact. |
| TASK-5.2.3 | Rotate efficiency: 90-degree rotation (`atlas.allowRotation`) in maxrects (Phase 1) with a before/after page-count measurement. | The export logs page count with rotation on vs off for the frozen atlas; rotation does not increase page count and the `rotated` flag round-trips (region de-rotation reproduces the source, WP-1.3 criterion preserved). |
| TASK-5.2.4 | Multi-page determinism: when content exceeds one page, packing is deterministic (fixed sort + seed) and pairwise-non-overlapping per page. Optionally bin sprites by slot blend mode (`atlas.blendBinning`) to reduce runtime batch breaks, still deterministic. | Re-running the pack on identical input yields byte-identical atlas JSON + PNG pages and an identical `AtlasRef`; pairwise non-overlap asserted per page; with blend-binning on, sprites of one blend mode are not split across more pages than necessary. |
| TASK-5.2.5 | Mip handling: pages are POT so runtimes can generate mipmaps at load (PixiJS mipmap on, Unity `GenerateMips` import setting, Godot mipmap flag). No mip data is baked into the format. Premultiplied-alpha policy is FIXED and documented so additive/screen blends (particles) match across runtimes; the texture epsilon used by TASK-5.2.6/5.2.8 decode checks is PMA-aware. | A documented note states POT + runtime mip generation + the PMA policy. Minification quality is checked two ways, neither subjective: (a) the advisory pixel-diff job (WP-V.8) compares a minified-sprite render against a committed reference image at the stated SSIM/per-pixel threshold; (b) MANUAL checklist item M5.2-a "minified hero sprite shows no visible shimmer at 25% scale in web and Unity" with a captured screenshot pair committed. |
| TASK-5.2.6 | Compressed-texture export (no format change): under the locked transport (TASK-5.2.0), emit either the single `<page>.ktx2` (UASTC) OR the per-target sidecars, plus a NON-contract `atlas-targets.json` manifest mapping page file -> compressed artifact(s), each recording its source PNG sha256 and the encoder fingerprint (determinism note below). The canonical PNG stays `AtlasPage.file`. | The manifest validates against its own schema; the format package is unchanged (`git diff packages/format` empty for this WP); the determinism guarantee in the note below holds in CI. |
| TASK-5.2.7 | STOP-and-ADR guard: if a runtime genuinely cannot resolve the compressed artifact by convention and per-target references MUST enter `AtlasPage`, halt, file `docs/adr/NNNN-*.md`, bump `formatVersion` under review, update the validator and fixtures together (Law 3). | Either the default (no format change) ships, OR a single reviewed ADR + `formatVersion` bump + validator + fixture update lands as one logical change. No ad-hoc field addition. |
| TASK-5.2.8 | runtime-web compressed-texture loader (the reference consumer of the selection convention): in `packages/runtime-web`, implement the NORMATIVE variant-selection algorithm below, transcode/decode the UASTC KTX2 (or select the sidecar) via PixiJS v8 KTX2 support, and fall back to the canonical PNG when no compressed path is supported or the artifact is absent. Selection reads ONLY the static GPU capability set, never frame rate or wall-clock. | Unit: given a mocked capability set, the selector returns the EXPECTED GPU target for each of the branches (ASTC, BC7, ETC2, PNG). Decode: a committed known-pixel reference page decodes/transcodes to within the PMA-aware texture epsilon of the PNG decode. Fallback: with the compressed artifact absent, the loader selects and renders the PNG. None of these acceptance checks is "loads on device" (that is the WP-5.6 confirmation layered on top). |

**Compressed-artifact determinism (R4, normative).** The byte-identity guarantee (TASK-5.2.1/5.2.4) covers the atlas
JSON and the PNG pages ONLY; those are byte-stable via WP-1.3. GPU/UASTC encoders are commonly multithreaded and not
bit-reproducible by default, so the compressed artifact is governed by a two-level rule (it applies to the single
UASTC KTX2 in the default transport and to each sidecar in the fallback transport):

- Primary (byte-stable): pin the encoder and run it single-threaded with fixed settings. UASTC via a pinned `basisu`/`toktx` version, single-thread, fixed UASTC quality + RDO settings; ASTC (sidecar fallback) via `astcenc` pinned to an exact version, `-j 1`, block size `6x6`, fixed quality, deterministic mode; BC7 via a pinned encoder version (single-thread, RDO off or a fixed lambda, fixed quality). The KTX2 container is written with a pinned `libktx`/`toktx` version and non-deterministic fields (writer string, timestamps) stripped/normalized. With these pins the artifact is byte-identical across runs and the encoder fingerprint in `atlas-targets.json` is `<encoder>@<version>+<settings-hash>`.
- Fallback (content-hash equivalence): if an encoder cannot promise bit-identity across the CI matrix, the manifest records the source PNG sha256 plus the encoder fingerprint, and CI asserts that re-encoding produces an artifact whose DECODED/transcoded texels match the committed artifact's decoded texels within the PMA-aware texture epsilon (TASK-5.2.5), with an unchanged fingerprint. Raw-byte identity is NOT claimed for the compressed artifact in this mode; the format/atlas JSON + PNG remain strictly byte-identical regardless.

**NORMATIVE variant-selection algorithm (shared by web/Unity/Godot, deterministic).** Given the platform's static GPU
capability set, the loader selects the transcode/sidecar target:

1. If ASTC is supported (`WEBGL_compressed_texture_astc` on web; ASTC on iOS/Metal, Android GLES3+/Vulkan): target ASTC.
2. Else if BC7 is supported (`EXT_texture_compression_bptc` on desktop WebGL; BC7 on desktop DX/Vulkan/Metal): target BC7.
3. Else if ETC2 is supported (mobile GLES3 without ASTC): target ETC2.
4. Else: decode/select the canonical PNG (`AtlasPage.file`).

Under `uastc-ktx2` transport the loader transcodes the single committed KTX2 to the selected target at load; under
`per-target-sidecar` it selects the matching pre-baked sidecar. Either way the selector reads only the capability set,
so the same device yields the same variant every run (a presentation property, not an outcome property; Law 1 is
untouched because textures are not solve inputs).

**Commands introduced:** none new (atlas + compression config is Export Profile state, section 4.1). `SetAtlasRef` (existing) is the only document mutation.

**Verification:** `pnpm --filter @marionette/editor test export` green (occupancy, determinism, non-overlap, manifest schema, artifact determinism rule); `pnpm --filter @marionette/runtime-web test` green (variant selection branches, decode/transcode correctness, PNG fallback); MANUAL: export the frozen atlas at 2048 and 4096, inspect page count and occupancy report, capture the minified-sprite screenshot pair for M5.2-a.

---

### WP-5.3 Unity runtime

**Scope.** A C# runtime under `runtimes/unity` that reproduces the `runtime-core` solve EXACTLY (within the A.5 tolerance) and renders via dynamic `Mesh`/`MeshRenderer`. It consumes `SpinResult` from the existing certified C# math engine (handoff section 1.3, already ported with parity) and is pure presentation (Law 1). It also produces the PLAYABLE frozen-game Unity build that WP-5.6 profiles (TASK-5.3.8).

**Law call-outs.** Law 1 (pure presentation, no outcome logic). Law 4 (first-principles port of `runtime-core`, comments cite the math, not Spine). INV (the solve is engine-agnostic; rendering is the adapter's job).

**DECISION-5.3 (shared C# core, recorded in ADR-0001).** The solve is implemented once as an engine-agnostic C# library `Marionette.Runtime.Core` (no UnityEngine, no Godot types), mirroring `runtime-core` function-for-function and solve-step-for-solve-step. Unity is a thin rendering adapter over it. This same core is reused by Godot (WP-5.4). Trade-off, recorded in ADR-0001: Unity and Godot then cannot drift from EACH OTHER (a feature for product correctness), at the cost of one fewer fully-independent reimplementation. The TS `runtime-core` remains the independent oracle, and the C# core is validated against the TS-generated fixtures, so cross-language parity (TS-vs-C#) is still proven. The compensating control is A.2 coverage (section 1, ADR-0001): the shared-core claim is only valid while the A.2 coverage meta-test is green (asserted by TASK-5.5.8). Fallback if a reviewer requires three fully-independent solves: split the core, accepting double maintenance and higher drift risk (ADR-0001).

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.3.1 | Port the solve to `Marionette.Runtime.Core` (C#): 2x3 affine, setup-pose reset, timeline sampling (linear/stepped/bezier with the SAME fixed-segment bezier sampling as `runtime-core`), IK one-bone and two-bone (law of cosines, both `bendPositive`), transform constraints, LBS skinning, deform-after-skin, draw-order resolution, event firing. Same six-step solve order. | C# unit tests mirror the `runtime-core` unit suite (affine, timeline, IK, LBS, deform) and pass; bezier sampling uses the same `BEZIER_SEGMENTS` constant as Phase 1. |
| TASK-5.3.2 | Binary + JSON loader: parse the WP-5.1 binary document (and JSON) into the C# document model. Floats are read with `BinaryPrimitives.ReadDoubleLittleEndian` / `ReadUInt32LittleEndian` (NOT host-endian `BitConverter`), so the loader is endian-independent on any host. The CRC is the pinned CRC-32/ISO-HDLC (6.1.5). Reject bad magic/version/crc loudly with a typed error mirroring `BinaryDecodeError`. | The C# loader loads the committed binary rig twins and the frozen game; corrupt input throws a typed decode error, not a generic exception; an endianness unit test (decode a fixed little-endian buffer) passes regardless of host; the CRC check vector matches the TS value. |
| TASK-5.3.3 | Decoder equivalence (C# vs TS): assert the C# `decodeBinary(twin)` produces a document STRUCTURALLY equal, field by field, to a committed snapshot of the TS `decodeBinary(twin)` (counts, names, indices, enums exact; floats bit-exact since float64), AND that the C# CRC over each twin equals the TS CRC (6.1.5). | A field-level equivalence test passes for every binary rig twin; a deliberately corrupted field count, enum tag, or CRC makes it red. This catches decoder bugs that happen not to perturb the sampled solve times. |
| TASK-5.3.4 | Unity rendering adapter: one dynamic `Mesh` per slot attachment (or a combined mesh rebuilt in draw order). UVs and triangles set once (static); skinned/deformed vertex positions written each frame into REUSED arrays via `Mesh.MarkDynamic()` + `Mesh.SetVertices(List<Vector3>)` (or `NativeArray`), no per-frame GC allocation. Draw order via per-slot `sortingOrder` or submesh order. | A profiler capture during playback shows zero per-frame managed allocation in the solve/render loop (INV-5); the hero rig renders with correct skinning and deform. |
| TASK-5.3.5 | Blend modes and color: four material variants (or one shader with a blend keyword) covering `normal`, `additive`, `multiply`, `screen`; per-slot color and optional `darkColor` (two-color tint) applied via vertex color or `MaterialPropertyBlock`. PMA policy matches WP-5.2 and the web runtime. | A rig exercising all four blend modes is captured and compared against the committed `runtime-web` reference image by the advisory pixel-diff job (WP-V.8) at the stated threshold; the two-color tint matches. MANUAL checklist item M5.3-a confirms the four-blend-mode capture pair side by side. Not a bare "looks the same". |
| TASK-5.3.6 | Particles in Unity: a CPU/GPU emitter driven by the SAME emitter config as the web runtime (handoff section 8.8), matching spawn shape, lifetime, velocity, acceleration, scale/color/alpha-over-life, rotation, blend, and trails, with pooling. The seed is the Phase 3 trigger-supplied seed (`hash32(spinSeed(spinId), effectInstanceIndex)`, Phase 3 section 7.3 / 8.3 seed provenance, with `spinSeed` the pinned string-to-uint32 derivation from G5.8), NEVER a host RNG or wall-clock; the same seed/provenance is identical across web/Unity/Godot and is proven bit-identical by TASK-5.5.7. Particle visuals are NOT in the numeric fixture suite (conformance compares solve output, not pixels, B.2); particle parity is validated by config + seed determinism (TASK-5.5.7) + visual review. | The coin-shower and ray-burst presets play in Unity with the same emitter parameters; a determinism test shows the emitter is a pure function of (config, trigger seed, profile) and uses the Phase 3 seed provenance, so the same `SpinResult` yields the same emission (Law 1). A planted reseed-from-`UnityEngine.Random` makes the determinism test red. |
| TASK-5.3.7 | Texture-variant loader (R3): implement the NORMATIVE selection algorithm (WP-5.2) in Unity, transcoding/decoding the UASTC KTX2 (or the per-target sidecar) via the pinned KTX2 import/runtime loader and per-platform `TextureFormat`, and falling back to PNG when unsupported or absent. Selection reads only the static device capability set. | Unit/editor test: given a mocked capability set, the selector returns the EXPECTED target for ASTC/BC7/ETC2/PNG; a known-pixel page decodes from each path within the PMA-aware texture epsilon; with the compressed artifact absent the PNG path renders. Acceptance does NOT collapse to "loads on device". |
| TASK-5.3.8 | Math boundary + PLAYABLE frozen-game build: the Unity runtime takes a `SpinResult` from the certified C# engine and plays the authored slot scene of the FROZEN game deterministically; it contains no symbol-placement or win-amount logic. This task produces the playable frozen-game Unity build that WP-5.6 profiles on device and that WP-5.8 (TASK-5.8.3) verifies side by side. | A reviewer confirms no outcome logic in `runtimes/unity`; WP-V.5-style determinism: the same `SpinResult` drives identical presentation twice; the frozen game (hero rig + slot scene + win sequence) plays end to end in a Unity player build. |
| TASK-5.3.9 | Conformance dump (cross-ref WP-V.13 / B.3): `runtimes/unity/Conformance/ConformanceDump.cs` runs in batchmode, reads the shared rigs (binary twins) + sample-spec, runs the solve via the shared C# core, samples at the spec times and event steps, and writes `unity-dump-<rigId>.json` in the canonical fixture schema (A.3). It must NOT read the fixtures. | The dump validates against `fixture.schema.json`; `mc-conformance compare unity-dump-*.json` passes within the A.5 tolerance for all rigs locally. |

**Commands introduced:** none (runtimes do not edit documents).

**Verification:** the Unity batchmode dump compares green locally; the frozen-game Unity player build (TASK-5.3.8) plays end to end; a deliberately planted bug (wrong `bendPositive`, degrees/radians swap, deform-before-skin, host-endian decode, wrong CRC, or RNG reseed) makes the compare or the relevant determinism test red.

---

### WP-5.4 Godot runtime

**Scope.** A Godot 4 runtime under `runtimes/godot` reproducing the same solve within the same tolerance, rendering via `MeshInstance2D`/`ArrayMesh`. Same conformance discipline as Unity (handoff section 8.11).

**Law call-outs.** Identical to WP-5.3 (Law 1 pure presentation, Law 4 first-principles, INV solve/render split).

**DECISION-5.4 (Godot language and conformance path, recorded in ADR-0001).** Recommended: implement Godot in C# (Godot 4 supports C#) and REUSE `Marionette.Runtime.Core` from WP-5.3, with a Godot-specific `ArrayMesh` adapter. This minimizes drift (one C# core, two engine adapters) and is the lowest-maintenance path. Because the solve is shared C#, the Godot conformance dump MUST run through the actual Godot engine load + render path (`godot --headless` executing the shipped Godot runtime entry that loads the binary twins via the Godot loader and the ArrayMesh adapter), NOT a bare C# console entry. This way `conformance-godot` exercises the shipped Godot load path even though the solve code is shared, so the independence proven is TS-vs-C# AND the Godot integration is exercised end to end. A bare C# headless entry is a documented fallback ONLY if the engine headless path is unavailable on a CI runner, and that fallback is flagged in the perf/conformance report. Fallback language: a GDScript reimplementation of the solve, accepted only if the C# export template is unavailable on a target; that path doubles the solve maintenance and must independently pass the same fixtures.

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.4.1 | Wire the Godot runtime to `Marionette.Runtime.Core` (C#) so the solve is the SAME validated code as Unity. If the GDScript fallback is taken, port the solve to GDScript and add a parallel unit suite. | The Godot project references the shared core (or, in fallback, has its own solve with mirrored unit tests passing). |
| TASK-5.4.2 | Binary + JSON loader in Godot, loud typed errors on bad magic/version/crc, little-endian reads via `BinaryPrimitives`, CRC-32/ISO-HDLC per 6.1.5 (reuse the C# decoder on the shared core). | Godot loads the committed binary rig twins and the frozen game; corrupt input fails loudly; the C#-vs-TS decoder equivalence (TASK-5.3.3) and the CRC equivalence (TASK-5.5.7) cover this shared decoder. |
| TASK-5.4.3 | ArrayMesh rendering adapter: per-slot `ArrayMesh` (or one ArrayMesh with surfaces in draw order); vertices written each frame; UVs/indices set once. The zero-allocation path is PROTOTYPED FIRST: confirm whether Godot 4's dynamic 2D API (`surface_update_vertex_region` into a reused `PackedVector2Array`, vs `RenderingServer.canvas_item_add_triangle_array` / `ArrayMesh.surface_set_arrays`) actually avoids per-frame allocation. If it does, assert zero per-frame allocation; if Godot's 2D path forces an allocation, hold to a MEASURED per-frame allocation ceiling (a committed bytes/frame number) rather than asserting zero. | A profiler capture shows the solve/render loop within the committed allocation ceiling (zero if the prototype proves it achievable); the hero rig skins and deforms correctly. The chosen path and its allocation number are recorded in the perf report. |
| TASK-5.4.4 | Blend modes and color: `CanvasItemMaterial` blend modes for `normal`/`additive`/`multiply`, a custom shader for `screen`; per-slot color and `darkColor`; PMA policy matching WP-5.2 and web/Unity. | A four-blend-mode rig capture is compared against the committed `runtime-web` reference image by the advisory pixel-diff job (WP-V.8) at the stated threshold; MANUAL checklist item M5.4-a confirms the side-by-side capture. Not a bare "looks the same". |
| TASK-5.4.5 | Particles in Godot driven by the SAME emitter config (handoff section 8.8), pooled, deterministic, using the Phase 3 trigger-supplied seed provenance (`hash32(spinSeed(spinId), effectInstanceIndex)`, sections 7.3 / 8.3, with `spinSeed` the pinned derivation from G5.8), NEVER a Godot RNG or wall-clock; identical seed/provenance to web/Unity and proven bit-identical by TASK-5.5.7. Pixels not in the numeric suite (B.2); validated by config + seed determinism + visual review. | The coin-shower and ray-burst presets play; the emitter is a pure function of (config, trigger seed, profile) and uses the Phase 3 seed provenance; a planted reseed from `RandomNumberGenerator` makes the determinism test red. |
| TASK-5.4.6 | Texture-variant loader (R3): implement the NORMATIVE selection algorithm (WP-5.2) in Godot, transcoding/decoding UASTC KTX2 (or the per-target sidecar) via `CompressedTexture2D`/`Image` KTX2 support and falling back to PNG when unsupported or absent. Selection reads only the static device capability set. | Test: given a mocked capability set, the selector returns the EXPECTED target for ASTC/BC7/ETC2/PNG; a known-pixel page decodes from each path within the PMA-aware texture epsilon; with the compressed artifact absent the PNG path renders. Acceptance does NOT collapse to "loads on device". |
| TASK-5.4.7 | Conformance dump (cross-ref WP-V.14 / B.4): `runtimes/godot/conformance/dump.gd` (or the shared-core entry invoked through the Godot headless engine path per DECISION-5.4) reads shared rigs (binary twins) + sample-spec, runs the solve via the actual Godot runtime entry, dumps canonical JSON; must NOT read fixtures. | The dump validates against `fixture.schema.json`; it runs through `godot --headless` (not a bare C# console); `mc-conformance compare godot-dump-*.json` passes within A.5 locally; a planted degrees/radians bug makes it red. |

**Commands introduced:** none.

**Verification:** the Godot headless dump compares green locally through the engine path; planted bugs go red; the chosen ArrayMesh allocation path is within its committed ceiling.

---

### WP-5.5 Conformance green across all three runtimes in CI

**Scope.** Wire the Unity and Godot conformance jobs into CI headless, comparing native dumps against the SAME committed fixtures with the SINGLE tolerance policy, add the seed/PRNG cross-language equivalence job, and make drift fail a required check. This WP is the CI integration; the harness internals (fixtures, schema, compare engine, tolerance, drift semantics) are owned by `docs/plan/cross-cutting/conformance-and-ci.md` and are referenced, not duplicated.

**Law call-outs.** INV-3 (identical solve order across runtimes), INV-2 (one fixture set generated from `runtime-core`), Law 3 (binary twins are the same logical schema), Law 1 (the seed/PRNG path is what makes particle emission identical across runtimes).

**Required-check topology (R5, explicit).** The single required status check in branch protection is `ci-pass`, the
final aggregation job (D.3/D.13). Its dependency set splits into two classes:

- ALWAYS-ON per PR: `conformance-web` (D.7), the fast pure-C#-core dump job (TASK-5.5.3), and the seed/PRNG equivalence job (TASK-5.5.7). These run on every PR and are the real per-PR gate.
- PATH-FILTERED / nightly: `conformance-unity` and `conformance-godot` (D.9). These run on PRs touching the paths listed below, and nightly, because GameCI licenses + native runners are slow.

The engine-job path filter is EXPLICIT and includes the transitive solve/codec owners, so a core or codec change
cannot skip the engine jobs through a missed transitive trigger: `runtimes/**`, `packages/conformance/**`,
`packages/format/**` (binary codec + container), and `packages/runtime-core/**` (the solve oracle the C# core mirrors).

`ci-pass` depends on all jobs but with explicit SKIPPED-AS-SUCCESS semantics: it uses `if: always()` and fails only if
a dependency's result is `failure` or `cancelled`, treating `skipped` as pass. So an unrelated PR that touches none of
the filtered paths skips the engine jobs and still merges through `ci-pass`; a PR that touches the runtimes, the
format codec, or `runtime-core` (or any nightly run on `main`) actually runs them, and a red engine job turns
`ci-pass` red and blocks merge. This is the mechanism that reconciles "engine jobs are path-filtered/nightly" with
"engine jobs are required": the requirement is carried by the always-running `ci-pass` aggregator, not by making the
slow jobs themselves always-on required checks.

| ID | Task | Acceptance / cross-ref |
|---|---|---|
| TASK-5.5.1 | Enable `.github/workflows/conformance-native.yml` (D.9). The Unity job runs via GameCI (`game-ci/unity-test-runner` or batchmode `unity-builder`) with a license secret, `-batchmode -nographics`, executes `ConformanceDump.Run`, validates dumps against `fixture.schema.json`, then runs `mc-conformance compare`. | Unity job is green for all rigs; cross-ref WP-V.13, B.3, D.9. |
| TASK-5.5.2 | The Godot job runs a pinned headless Godot container, executes the dump through the Godot engine path (DECISION-5.4), then `mc-conformance compare`. | Godot job is green for all rigs; cross-ref WP-V.14, B.4, D.9. |
| TASK-5.5.3 | Add a FAST headless pure-C#-core dump job (no Unity/Godot engine) that runs on EVERY PR (always-on, an explicit `ci-pass` dependency), so the slow engine jobs can stay path-filtered + nightly while core parity is checked cheaply per PR. It loads the binary twins via the shared decoder and dumps via `Marionette.Runtime.Core`. | The fast core job runs on every PR under the CI budget and gates merge via `ci-pass`; engine jobs run only on the filtered paths and nightly (D.9). |
| TASK-5.5.4 | Native runtimes load the committed BINARY rig twins (WP-5.1) in conformance, proving the shipping load path, not just JSON. | The dumps are produced from the binary twins; a corrupted twin would fail loudly at load. |
| TASK-5.5.5 | Drift fails the build: a non-empty compare failure list is a nonzero exit and turns `ci-pass` red; the compare engine prints the first 20 failures and uploads `drift-report.json` (B.6, WP-V.15). The single tolerance (A.5, B.5) is never loosened to make a runtime pass. | A planted bug in either native runtime turns its job red and `ci-pass` red; the triage runbook (`docs/runbooks/conformance-drift.md`) covers the failure shape. |
| TASK-5.5.6 | Add `conformance-unity` and `conformance-godot` as path-filtered/nightly dependencies of `ci-pass` with skipped-as-success semantics (per the topology above, with the path filter including `packages/format/**` and `packages/runtime-core/**`, WP-V.16, D.13), so all three runtimes gate merges from Phase 5 onward without wedging unrelated PRs (handoff section 8.11, E). | On a PR touching `runtimes/**`, `packages/format/**`, `packages/runtime-core/**`, or conformance paths (or nightly), a red native job blocks merge via `ci-pass`; on an unrelated PR the engine jobs skip and `ci-pass` still passes; a planted codec change to `packages/format` triggers the engine jobs. |
| TASK-5.5.7 | Seed/PRNG cross-language equivalence (Law 1 particle-parity guard): a job asserts that `runtime-core` (TS), `Marionette.Runtime.Core` (C#), and the GDScript fallback path (if present) produce BIT-IDENTICAL outputs, from committed golden vectors generated by `runtime-core` (INV-2), for: the pinned `spinSeed(spinId)` string-to-uint32 derivation (G5.8); `hash32(a,b)` (Phase 3 section 8.3); the per-emitter stream seed `instanceSeed = hash32(triggerSeed, layerIndex)`; the `nextU32`/`nextUnit`/`drawRange` sequence; the Phase 3 NORMATIVE per-particle draw order; and the pinned CRC-32 (6.1.5). Particle parity across runtimes rests entirely on this path (conformance compares solve, not pixels, B.2), so it gets its OWN equivalence test, not just visual review. | Golden vectors committed; TS, C#, and (if present) GDScript outputs match the goldens bit for bit; a planted off-by-one in any draw order, a wrong `spinSeed`, or a CRC variant mismatch makes the job red. Runs on every PR (always-on `ci-pass` dependency). |
| TASK-5.5.8 | Shared-core coverage assertion (ADR-0001 compensating control): a meta-test asserts the A.2 coverage checklist is GREEN for every solve branch (IK both bend directions, every non-`normal` transformMode observable, stepped + bezier, deform-after-skin, draw-order reorders, all four blend modes) and FAILS if any branch is unexercised by a committed fixture. This is the gate that makes the shared C# core safe (any unexercised path has zero cross-implementation verification). | The coverage meta-test is a required `ci-pass` dependency; removing a fixture that exercises a branch makes it red; it is referenced from ADR-0001 as the compensating control. |

**Verification:** all three conformance jobs green in CI on `main`; the seed/PRNG equivalence job is bit-identical across languages; the A.2 coverage meta-test is green; a runtime-touching PR with a planted solve bug in Unity or Godot blocks merge via `ci-pass`; a `packages/format` codec change triggers the engine jobs; an unrelated PR is not wedged by skipped engine jobs; loosening tolerance is rejected in review (A.5 is single-sourced).

---

### WP-5.6 Mobile performance profiling

**Scope.** Profile the PLAYABLE frozen-game Unity build from WP-5.3 (TASK-5.3.8) and the frozen-game web build on a NAMED real mobile device, apply the mobile particle PROFILE deterministically, validate 60fps and the per-surface cold-start and main-thread budgets, and fix regressions. WP-5.6 does NOT create a new Unity build; it profiles the one WP-5.3 already produced. CI catches relative regressions (WP-V.8 / D.8); this WP validates the ABSOLUTE budgets on hardware (the handoff explicitly defers strict device budgets to Phase 5).

**Prerequisites (device deployment).** Beyond WP-5.3/5.2/5.0 being green: Apple provisioning for the Unity iOS runtime is required to deploy the WP-5.3 build to the iPhone 12-class device (an Apple Developer account, a development provisioning profile, and a device UDID registration). This is distinct from the editor's Developer ID signing in WP-5.7 (that signs the macOS/Windows editor, not the iOS device build). Record the provisioning setup in the perf report so the device run is reproducible.

**Law call-outs.** Law 1 (the mobile particle profile scales AMBIENT effects only and relies on the Phase 3 NORMATIVE deterministic eviction; it is a STATIC function of the device profile, NEVER of measured frame rate; deterministic win effects run at authored counts; the same `SpinResult` on the same profile yields identical visuals every run). INV-5 (pooling, no per-frame allocation).

**Particle-cap reconciliation with the Phase 3 contract (R1, normative).** Phase 3 (sections 7.3, 8.8) is the
authoritative particle contract and Phase 5 does NOT amend it. The mobile profile therefore uses only the levers Phase
3 already provides, applied to the categories Phase 3 permits:

- Ambient effects (`deterministic: false`): scaled by the Export Profile `ambientQualityTier` (Phase 3 quality tier, AMBIENT ONLY). This is the only spawn-rate LOD; it never touches deterministic effects.
- Deterministic win effects (`deterministic: true`, the big/mega coin shower): ALWAYS run at authored counts. They are fit into the mobile budget at AUTHORING time in WP-5.0 (TASK-5.0.1/5.0.2), never clipped at runtime.
- Global per-scene budget: the Export Profile `maxLiveParticles` (the Phase 3 section 8.8 `MAX_LIVE_PARTICLES`) per device profile. When a spawn would exceed it, the Phase 3 NORMATIVE eviction runs (evict the oldest live particle of the lowest-priority active effect, ambient before deterministic, deterministic only if no ambient remains and only as a logged budget-overflow warning). Because WP-5.0 authors the deterministic peak to fit the mobile budget with ambient headroom, deterministic eviction never fires on the target device; if it ever did, the fix is a WP-5.0 re-author of counts, not a runtime cap. The conformance reference tier stays `high` (Phase 3 section 8.9); the mobile profile is a playback profile, not the conformance tier.

There is no fps-based culling anywhere. CI's pool/allocation gates (WP-V.8) and the Phase 3 eviction are the only
budget mechanisms, and both are deterministic.

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.6.1 | Name the device matrix: one mid-tier mobile for each ship surface. Web is profiled in mobile Safari / WKWebView on an iPhone 12-class device; the WP-5.3 Unity iOS build is profiled on the same device; a mid-range Android (GLES3/Vulkan, e.g. a 2021 mid-tier) profiles the Android WEB path. Android is throughput-gated (60fps) only this phase, not cold-start-gated, because there is no Android NATIVE ship build (the schema reflects this: `coldStartBudgets` has no Android key; the Android web surface is covered by `webColdInteractiveMs`). Record exact device + OS + build in the perf report. | A committed `docs/plan/phase-5-perf-report.md` names devices, OS, build hashes, and the captured numbers; it states Android is 60fps-gated only. |
| TASK-5.6.2 | Apply the mobile particle profile deterministically: set the device-profile `maxLiveParticles` and `ambientQualityTier` from the Export Profile (section 4.1). Confirm the implementation scales AMBIENT effects only and uses the Phase 3 NORMATIVE eviction for the global budget; dynamic fps-based culling is FORBIDDEN. | A test asserts emission is a pure function of (config, trigger seed, profile, `SpinResult`); two runs on the same profile produce identical particle counts and positions; no code path reads measured fps to drop particles; deterministic win effects are not count-scaled; a planted fps-reading cull or a deterministic-effect scale makes the test red. |
| TASK-5.6.3 | 60fps validation on the big-win/mega-win presentation (the heaviest particle moment) of the frozen game. The levers to hit budget are: WP-5.0 authored deterministic counts, ambient tier LOD, atlas page reduction (WP-5.2), batch reduction, compression (WP-5.2), and pooling. NOT clipping the deterministic coin shower. If the deterministic win still misses budget, that is a WP-5.0 re-freeze (re-author counts), not a runtime cap. Capture a trace (Xcode Instruments / Android GPU Inspector / Chrome tracing). | The heaviest win sequence sustains 60fps on the named mobile device with the profile applied; the trace is committed; any miss is resolved through a legal lever above and re-measured. |
| TASK-5.6.4 | Per-surface cold-start budgets (S4, calibrated, NOT the bare native number): each surface has its own definition and budget, sourced from the Export Profile `coldStartBudgets`. Unity iOS native app cold launch < `unityIosNativeMs` (1500) on iPhone 12-class. runtime-web warm/cached (JS + textures cached, first frame) < `webWarmFirstFrameMs` (1500) on the same Safari. runtime-web cold-over-network (first interactive) < `webColdInteractiveMs` on a PINNED throttle profile (Chrome/WebPageTest "Fast 3G": 1.6 Mbps down, 750 Kbps up, 150ms RTT), with a defensible value (default 4000) not the native launch number. Main-thread blocks > 16ms during steady playback are treated as bugs and removed on every surface. | Traces show each surface under its own budget with its definition (cached vs cold-network, first-frame vs first-interactive) stated; no main-thread block > 16ms during steady playback; the throttle profile is recorded; any offender is fixed and re-measured. |
| TASK-5.6.5 | Pooling proof on device: particles, sprites, and mesh buffers are pooled; no per-frame allocation spikes during the win sequence (within the Godot allocation ceiling from TASK-5.4.3 where the engine forces one). Ties to the CI allocation gate (WP-V.8) but confirmed on hardware. | The device memory/allocation trace is flat (or within the committed ceiling) during playback; the CI allocation gate remains green. |
| TASK-5.6.6 | Texture-variant confirmation on device (layered on TASK-5.2.8/5.3.7/5.4.6, NOT a substitute): confirm the mobile build selects and renders the ASTC variant on the iPhone/Android, and the PNG fallback renders on a forced-no-compression run. | The device trace shows the ASTC variant bound on the mobile device and the PNG fallback rendering when compression is forced off; the unit + decode tests from WP-5.2/5.3/5.4 remain the primary proof. |
| TASK-5.6.7 | Regression fixes: any budget miss is fixed (ambient tier, batch reduction, atlas page reduction, texture compression, pooling) and re-profiled; the fix does not change which symbols/outcomes appear and does not count-scale a deterministic effect (Law 1). | Each regression has a before/after number in the perf report; outcomes are unchanged (conformance still green). |

**Commands introduced:** none. The mobile particle profile lives in the Export Profile (section 4.1), not the undoable document.

**Verification:** the committed perf report shows 60fps and per-surface budget compliance on named hardware; the determinism test for the mobile profile passes; conformance stays green after every perf fix.

---

### WP-5.7 Build / release pipeline

**Scope.** Create `.github/workflows/release.yml` (it does not pre-exist; see G5.7 and the corrected WP-V.11 label); package, sign, and auto-update the Electron editor; publish versioned runtime artifacts; and gate every release on green conformance plus the format semver check. Reuses the `electron-builder` config from the editor (G5.7) and the D.10 conventions.

**Law call-outs.** Law 3 (the release asserts a single consistent `formatVersion` across all published artifacts and that committed fixtures are up to date). Law 5 (a release is only cut when all three runtimes are conformance-green).

| ID | Task | Acceptance / cross-ref |
|---|---|---|
| TASK-5.7.1 | Create `release.yml` (Phase 5 owns it; the cross-cutting WP-V.11 label has been corrected from "scaffold in Phase 0" to "created in Phase 5", G5.7). Electron packaging matrix (`os: [macos-latest, windows-latest, ubuntu-latest]`) via `electron-builder`, on tag `v*` (D.10). The `--smoke` launch loads a reference rig and renders one frame without throwing. | The workflow exists; per-OS artifacts upload; the smoke check passes on all three OSes (WP-V.11). |
| TASK-5.7.2 | Code signing: macOS Developer ID with hardened runtime + `notarytool` notarization + staple; Windows code signing (OV/EV cert via Azure Trusted Signing or `signtool`). Signing secrets are scoped to the release workflow ONLY, never exposed to fork PR workflows (D.10). | A signed macOS build passes Gatekeeper and notarization; a signed Windows build verifies; fork PRs have no access to signing secrets (verified by secret scoping). |
| TASK-5.7.3 | Auto-update: `electron-updater` against a release feed (GitHub Releases or S3), stable + beta channels, signature-verified updates only, with a documented rollback path. | An older build auto-updates to a newer signed release on macOS and Windows; an unsigned/tampered update is rejected; the rollback procedure is documented in `docs/runbooks/release.md`. |
| TASK-5.7.4 | Runtime artifact publishing, each carrying the format version it targets: `runtime-web` as a versioned npm package (or CDN bundle); the Unity runtime as a versioned UPM package (tarball/git URL); the Godot runtime as a versioned addon zip. | Each artifact publishes with a semver tag and embeds the `formatVersion` it supports; consumers can pin a version. |
| TASK-5.7.5 | Release gates wired (Law 3, Law 5): the tag build `needs: [ci-pass]` and `ci-pass` includes conformance-native (per WP-5.5 topology), so a release cannot be cut while any conformance job is red. A release-time check asserts the `formatVersion` embedded in `runtime-web`, Unity, and Godot artifacts all EQUAL the `packages/format` version, the fixtures-lock is clean (A.6), and the format semver gate (D.11) passed. | A planted version mismatch (one runtime targets an older `formatVersion`) fails the release; a red conformance-native blocks the release; a dirty fixtures-lock blocks the release. |
| TASK-5.7.6 | Ship bundle as a release artifact: the frozen game's binary document + optimized atlas pages + compressed artifact(s) + `atlas-targets.json` + the frozen `export-profile.json`, versioned and attached to the release, reproducible from the frozen assets. Reproducibility is byte-identical for the binary doc + atlas JSON + PNG pages and content-hash-equivalent for the compressed artifact (per WP-5.2 determinism rule). | The attached game bundle loads and plays in `runtime-web` and Unity from the published artifacts (feeds WP-5.8); a re-export reproduces the binary/JSON/PNG byte-identically and the compressed artifact to within the content-hash equivalence. |

**Commands introduced:** none.

**Verification:** a dry-run tag produces signed, notarized artifacts and published runtime packages with a consistent `formatVersion`, only when `ci-pass` (including conformance-native) is green; release gates block on planted version drift or red conformance.

---

### WP-5.8 Reference game integration and ship (Definition of Done)

**Scope.** Final assembly and verification of the milestone: the frozen reference game exported to binary + optimized atlas, played to web AND Unity, with conformance parity proven across all three runtimes. The playable web and Unity builds already exist (WP-5.2/5.3); WP-5.8 assembles them into the shipped artifact and verifies the milestone end to end. It is NOT first integration.

| ID | Task | Acceptance |
|---|---|---|
| TASK-5.8.1 | Export the frozen game (WP-5.0) to the binary document (WP-5.1) and the optimized atlas (WP-5.2) through the editor exporter under the frozen Export Profile; validate the exported document with the same validator on the way out (fail loudly). The editor ENCODES binary here; its working save format stays JSON (section 4.2). | A reproducible export produces a binary doc that validates and a POT mobile atlas with the committed occupancy/compression artifacts. |
| TASK-5.8.2 | Play the exported game in `runtime-web` driven by the real math engine's `SpinResult` stream: animated symbols, a win sequence with big/mega escalation, a free-spin trigger, and a tumble cascade. | The web build plays the full presentation from the real engine; the same `SpinResult` corpus yields identical visuals on repeat (Law 1, WP-V.5). |
| TASK-5.8.3 | Final assembly + verification of the Unity build: take the PLAYABLE frozen-game Unity build delivered by WP-5.3 (TASK-5.3.8) and profiled by WP-5.6, drive it from the certified C# engine's `SpinResult`, and verify it plays the full presentation. This is verification of an existing build, not first integration. | The Unity build plays the full presentation; a side-by-side with web is verified by the advisory pixel-diff job (WP-V.8) against the committed web reference at the stated threshold PLUS a MANUAL checklist (M5.8-a: skinning, deform, blend modes, color, particles with the mobile profile applied), each item captured and committed. Not a bare "looks consistent". |
| TASK-5.8.4 | Prove conformance parity: all three conformance jobs (web, Unity, Godot) are green on the full fixture set within A.5 in CI, and the seed/PRNG equivalence job (TASK-5.5.7) and the A.2 coverage meta-test (TASK-5.5.8) are green. | `ci-pass` is green with conformance-native required per WP-5.5 (WP-V.16). |
| TASK-5.8.5 | Cut a release through WP-5.7: signed editor builds, published runtime artifacts, and the attached game bundle, gated on green conformance and a consistent `formatVersion`. | A release is produced only because the gates passed; the published web + Unity artifacts play the attached game bundle. |

**Verification:** the section 13 acceptance script passes end to end.

---

## 7. Native runtime parity surface (consolidated)

Each native runtime reproduces this exact six-step solve order (handoff section 6, INV-3), step for step with `runtime-core`:

1. Reset all bones to setup pose.
2. Apply animation timelines (bone transforms; slot colors/attachments; sampled IK/transform-constraint params; sampled deform offsets; draw order; events).
3. Solve constraints in order: IK (one-bone, two-bone law of cosines), then transform constraints.
4. Compute world transforms (single forward pass; parents precede children).
5. Skin meshes (LBS), then apply deform offsets.
6. Render in draw order with per-slot blend mode and color.

The oracle column below is the SOLVE oracle (TS `runtime-core`), which is PixiJS-free. Rendering is NOT part of the
solve and is NOT done by `runtime-core`; the web renderer is `runtime-web` (PixiJS). The Unity and Godot columns share
ONE C# solve core (ADR-0001), so their entries are the same code with different render adapters.

| Surface | Solve oracle: runtime-core (TS) | Unity (WP-5.3) | Godot (WP-5.4) | Validated by |
|---|---|---|---|---|
| Affine 2x3, timeline sampling (linear/stepped/bezier, fixed segments) | reference | `Marionette.Runtime.Core` (C#) | shared C# core (or GDScript fallback) | fixtures FIX-2.* + rig-2bone |
| IK one-bone, two-bone, both bend directions | reference | shared C# core | shared C# core | rig-ik-2bone (A.2 coverage, TASK-5.5.8) |
| Transform constraint (per-channel mix + offset, after IK) | reference | shared C# core | shared C# core | rig-transform-constraint, rig-ik-into-transform |
| LBS skinning + deform-after-skin | reference | shared C# core | shared C# core | rig-weighted-mesh, rig-deform, rig-weighted-deform |
| Draw order, blend mode, color, events | reference | shared C# core + adapter | shared C# core + adapter | rig-events-draworder, rig-blendmodes |
| Binary loader (WP-5.1) | `decodeBinary` (TS) | C# decoder (LE via `BinaryPrimitives`, CRC-32/ISO-HDLC) | C# decoder (shared) or GDScript | binary rig twins, decoder-equivalence (TASK-5.3.3), CRC equivalence (TASK-5.5.7), WP-5.5 |
| Particle seed/PRNG + per-particle draw order | `runtime-core` PRNG (TS) | shared C# core | shared C# core (or GDScript) | seed/PRNG golden vectors, cross-language equivalence (TASK-5.5.7); pixels NOT compared (B.2) |
| Texture-variant load + PNG fallback (WP-5.2) | n/a (not a solve input) | UASTC KTX2 transcode (or sidecar) + PNG fallback | UASTC KTX2 transcode (or sidecar) + PNG fallback | selection/decode unit tests (TASK-5.2.8/5.3.7/5.4.6) + device confirm (TASK-5.6.6) |
| Rendering (NOT in numeric fixtures) | runtime-web (PixiJS); runtime-core is PixiJS-free | dynamic `Mesh` | `ArrayMesh`/`MeshInstance2D` | advisory pixel-diff (WP-V.8) vs committed reference + MANUAL checklist |

Rendering differences across engines cannot break solve parity because conformance compares solve output, not pixels (B.2). This is why a shared solve core plus per-engine render adapters is safe, GIVEN the A.2 coverage compensating control (ADR-0001, TASK-5.5.8). The renderer row deliberately attributes PixiJS to `runtime-web`, NOT `runtime-core`, because the no-Pixi lint rule (D.5) keeps `runtime-core` PixiJS-free.

---

## 8. Format-contract touchpoints (Law 3 ledger)

Phase 5 default: **no logical schema change.** The binary is a re-encoding of the SAME section 6 schema.

| Capability | section 6 type used | New logical field? |
|---|---|---|
| Binary document (EXPORT artifact; editor save stays JSON, section 4.2) | entire `SkeletonDocument` (re-encoded, same `formatVersion`) | No. New SERIALIZATION, same schema. `containerVersion` is binary-layout-only. |
| Atlas page tuning | `AtlasRef`/`AtlasPage`/`AtlasRegion` | No. Page size, padding, rotation, blend-binning are Export Profile config (section 4.1). |
| Texture compression + mips | none (sidecar `atlas-targets.json`, non-contract) | No, by design (TASK-5.2.6). |
| Export / playback knobs (page size, transport, compression targets, particle profiles, cold-start budgets) | none (Export Profile store, section 4.1, own `exportProfileVersion`) | No. Separate store, fenced from `SkeletonDocument` by lint + disjoint-fields test. |
| Per-target page references (only if a runtime cannot resolve the compressed artifact) | would extend `AtlasPage` | STOP-and-ADR + `formatVersion` bump (TASK-5.2.7). Default avoids it. |

The only ways the format can change in Phase 5 are (a) a deliberate ADR + `formatVersion` bump for per-target atlas references, executed as one reviewed change with validator + fixtures updated together, or (b) none, which is the default and expected outcome. No ad-hoc field additions (handoff section 10 format-churn risk). The format semver gate (D.11) enforces this. The Export Profile is explicitly NOT part of `packages/format`: it has its own version and CODEOWNERS, so it can never be a silent format change. ADR-0001 (shared C# core) does not touch the format contract; it is a runtime-architecture decision only.

---

## 9. Command inventory (Law 2)

Phase 5 introduces **no new commands**. Binary export, atlas optimization, native runtimes, the mobile particle profile, and the release pipeline are exporter, runtime, and infrastructure concerns; none mutate the `DocumentModel`. The only document mutation in the atlas path is the pre-existing `SetAtlasRef` (Phase 1, WP-1.3), which already has a do/undo round-trip test.

Reviewer rule (handoff section 11): if any Phase 5 work is found mutating `DocumentModel` outside a Command (for example, an export step writing back into the document), it is rejected. Export reads the document; it does not edit it. Export and playback settings (page size, transport, compression targets, particle profiles, cold-start budgets) live in the Export Profile store (section 4.1, the defined third store), NOT in the undoable document and NOT in ephemeral Zustand. The Export Profile loader/persist (TASK-5.0.6/5.0.7) writes that store, never the document. The handoff section 8.2 wall stands: document state is undoable/saved JSON, Zustand is ephemeral UI state, and the Export Profile is the committed-but-non-undoable project store defined here.

---

## 10. Phase 5 risks and mitigations

| ID | Risk | Severity | Mitigation (concrete) |
|---|---|---|---|
| R5.1 | Native runtime drift (Unity/Godot diverge from `runtime-core`), and the shared-core blind spot (a bug on an unexercised path passes identically in both engines) | High | One shared, fixture-validated C# core (ADR-0001) so engines cannot drift from each other; the TS reference is the independent oracle; the COMPENSATING CONTROL is the A.2 coverage meta-test (TASK-5.5.8), which makes any unexercised solve branch a build failure (the only guard now that Unity and Godot do not cross-check); the C#-vs-TS decoder-equivalence test (TASK-5.3.3); the seed/PRNG cross-language equivalence (TASK-5.5.7); WP-5.5 makes any drift a red required check via `ci-pass` with the single tolerance (A.5, never loosened). |
| R5.2 | Mobile particle perf misses 60fps | High | Phase 3-compliant levers only: ambient quality-tier LOD (ambient only), authored deterministic counts fit to the mobile budget at freeze time (WP-5.0), Phase 3 NORMATIVE deterministic eviction for the global budget, pooling (INV-5), on-device profiling on a named device (WP-5.6), atlas page/compression reduction (WP-5.2). No fps-based culling and no deterministic-count scaling (would break Law 1 / the Phase 3 contract). |
| R5.3 | Binary format churn (the codec keeps changing) | Medium | Two-axis versioning: `formatVersion` (logical, shared with JSON) vs `containerVersion` (layout). Logical changes go through the ADR + semver gate; layout improvements bump only `containerVersion`. Committed binary twins + deterministic encoder (first-encounter string-table order) make churn visible in diffs. |
| R5.4 | Float precision: temptation to use float32 in binary breaks lossless round-trip | Medium | Default binary is float64 (DECISION-5.2), deep-equal round-trip (TASK-5.1.2), `flags` bit0 marks the lossless profile. A lossy float32 transport profile is explicitly separate, opt-in, epsilon-validated, and OUT of scope here. |
| R5.5 | GameCI license / native runner flakiness or slowness | Medium | Engine jobs run on path-filter + nightly; a fast pure-C#-core dump job (TASK-5.5.3) and the seed/PRNG equivalence job (TASK-5.5.7) gate every PR cheaply via `ci-pass` so the slow jobs are not on the per-PR critical path. License secret scoped to the release/conformance-native workflows. |
| R5.6 | Cross-target texture compression inconsistency or non-reproducible artifact (ASTC vs BC7 vs ETC2 vs PNG fallback) | Medium | Default single UASTC KTX2 transcoded at load (DECISION-5.2.b) reduces three pre-baked binaries to one transcodable artifact; canonical PNG stays the contract reference; a PNG fallback path is implemented in web + Unity + Godot (TASK-5.2.8/5.3.7/5.4.6) and confirmed on device (TASK-5.6.6); pinned single-thread encoders give byte-stable artifacts, with a content-hash/decoded-equivalence fallback (WP-5.2 determinism rule); Pixi v8 KTX2 transcode capability confirmed before lock (TASK-5.2.0); PMA policy fixed across runtimes (TASK-5.2.5). |
| R5.7 | Signing / notarization breakage blocks release | Medium | Signing scoped to the release workflow; a nightly unsigned build catches packaging breakage early (D.10); the rollback procedure is documented (TASK-5.7.3). |
| R5.8 | Version skew across published artifacts (a runtime targets an old `formatVersion`) | Medium | Release-time check asserts a single consistent `formatVersion` across web/Unity/Godot artifacts and a clean fixtures-lock (TASK-5.7.5); mismatch fails the release. |
| R5.9 | Export Profile mistaken for a format field (silent Law 3 break) | Medium | Defined as a separate committed store (section 4.1) with its own `exportProfileVersion` + CODEOWNERS; lint forbids cross-imports with `packages/format`; a disjoint-fields test prevents convergence; D.11 covers only `packages/format`. |
| R5.10 | Particle parity not covered by numeric fixtures | Medium | The ONLY guarantee of particle parity across runtimes is identical trigger seeds + identical PRNG draw order (conformance compares solve, not pixels, B.2). That path now has its OWN cross-language equivalence test (TASK-5.5.7) over committed golden vectors for `spinSeed`, `hash32`, stream seeding, the `nextU32`/`drawRange` sequence, and the NORMATIVE per-particle draw order, in addition to emitter-config determinism (TASK-5.3.6/5.4.5) and the advisory visual-regression job (WP-V.8). Documented, not hidden. |
| R5.11 | Native binary decoder is silently host-endian-dependent or computes a different CRC | Medium | C# decoder uses `BinaryPrimitives.Read*LittleEndian`, an explicit endianness unit test (TASK-5.3.2), the pinned CRC-32/ISO-HDLC (6.1.5), and the C#-vs-TS decoder + CRC equivalence tests (TASK-5.3.3, TASK-5.5.7). |
| R5.12 | Scope creep into a Godot game build, or into a binary editor save format | Low | DECISION-5.0: Godot is conformance-only this phase; ship targets are web + Unity. Section 4.2: the editor save format stays JSON; a binary editor import path is explicit non-goal (section 14). |
| R5.13 | Particle seed string-to-uint32 derivation unpinned across languages | Medium | G5.8 makes pinning `spinSeed(spinId)` (in `runtime-core`, with a committed golden vector) a Phase 3/4 dependency that BLOCKS the particle-determinism claim; TASK-5.5.7 then locks it bit-identical across TS/C#/GDScript. Phase 5 does not invent the derivation (no Phase 3 amendment); it locks whatever Phase 3/4 pins. |
| R5.14 | Godot 4 dynamic 2D mesh API may allocate per frame, making the zero-alloc claim false | Low-Medium | TASK-5.4.3 prototypes the true path first and EITHER proves zero allocation OR commits a measured per-frame allocation ceiling; the perf report records the chosen path and number; the CI allocation gate (WP-V.8) and device trace (TASK-5.6.5) enforce the ceiling. |

(The earlier "release.yml superseded label" risk is resolved at the source: the WP-V.11 label in `conformance-and-ci.md` is corrected to Phase 5, so there is no standing contradiction to mitigate.)

---

## 11. Performance budgets (Phase 5 specific)

| Budget | Target | Verified by |
|---|---|---|
| Binary raw size vs JSON raw | <= 60% on the frozen game's largest document | WP-5.1 bench (TASK-5.1.7), committed baseline |
| Binary parse+validate vs JSON parse+validate | <= 50% wall time | WP-5.1 bench (TASK-5.1.7) |
| Binary gzip vs JSON gzip | binary not larger after gzip | WP-5.1 bench (TASK-5.1.7) |
| Atlas occupancy (frozen atlas, chosen page size) | >= 75% mean per page (or named oversized sprites) | WP-5.2 occupancy report |
| Native solve per frame, Unity | within the 16.6ms frame budget; zero per-frame managed allocation | WP-5.3 profiler capture, WP-V.8 allocation gate |
| Native solve per frame, Godot | within the 16.6ms frame budget; per-frame allocation zero, or within the committed ceiling (TASK-5.4.3) | WP-5.4 profiler capture, WP-V.8 allocation gate |
| Mobile win-sequence frame rate (named device) | sustained 60fps with the mobile particle profile (ambient scaled, deterministic at authored counts) | WP-5.6 device trace |
| Cold start, Unity iOS native app launch | < 1500ms on iPhone 12-class (Export Profile `unityIosNativeMs`) | WP-5.6 device trace |
| Cold start, runtime-web warm/cached (assets cached, first frame) | < 1500ms on iPhone 12-class Safari (`webWarmFirstFrameMs`) | WP-5.6 device trace |
| Cold start, runtime-web cold-over-network (first interactive) | < 4000ms on the pinned "Fast 3G" throttle (1.6 Mbps down, 150ms RTT) (`webColdInteractiveMs`) | WP-5.6 device trace |
| Android | 60fps throughput-gated only (no native cold-start budget this phase); web surface uses the web cold-over-network budget | WP-5.6 device trace |
| Main-thread block during steady playback (every surface) | none > 16ms | WP-5.6 device trace |
| Global live particles per scene | <= profile `maxLiveParticles`, deterministic via Phase 3 eviction | WP-5.6 profile determinism test |

Pooling requirements (INV-5): native runtimes reuse vertex arrays (Unity `MarkDynamic` + `SetVertices`; Godot `PackedVector2Array` + `surface_update_vertex_region`, held to its measured ceiling per TASK-5.4.3); particles, sprites, and mesh buffers are pooled; no unbounded per-frame allocation in any solve/render loop.

The cold-start budgets are calibrated PER SURFACE, not transplanted from the native iOS launch number: the < 1.5s
native budget applies to the Unity iOS app launch and to a warm/cached web first-frame; cold-over-network web load
(JS parse + WebGL context + texture upload) gets its own defensible budget on a pinned network profile. Android has
no native cold-start budget this phase because there is no Android native ship build; it is throughput-gated only.

---

## 12. Conformance and CI cross-references (do not duplicate)

This phase consumes the harness defined in `docs/plan/cross-cutting/conformance-and-ci.md` and the architecture decision in `docs/adr/0001-shared-csharp-runtime-core.md`. The relevant anchors:

| Need | Owned by |
|---|---|
| Shared C# core + amended independence model + compensating control | `docs/adr/0001-shared-csharp-runtime-core.md` |
| Reference rig catalog + coverage checklist (the compensating control) | A.2, WP-V.1 |
| Canonical fixture schema (affine, vertices, draw order, events) | A.3, WP-V.2 |
| Sample-spec (the shared times every runtime reads) | A.4, WP-V.0 |
| The single tolerance policy (atol/rtol, discrete exact) | A.5, WP-V.3 (never loosened) |
| Compare engine | B.5, WP-V.0/.3 |
| Drift report + triage runbook | B.6, WP-V.15, `docs/runbooks/conformance-drift.md` |
| Unity batchmode harness | B.3, WP-V.13 |
| Godot headless harness | B.4, WP-V.14 |
| `conformance-native.yml` job graph, path filters (incl. `packages/format/**`, `packages/runtime-core/**`), nightly | D.9 |
| `ci-pass` aggregator (skipped-as-success required-check pattern) | D.3, D.13 |
| Electron release matrix + signing scoping | D.10, WP-V.11 |
| Perf + allocation + advisory pixel-diff gates | C.4, D.8, WP-V.8 |
| Required-checks promotion at Phase 5 | D.13, WP-V.16, E |
| Particle determinism, seed provenance, quality tiers, eviction | phase-3-vfx-particles.md sections 7.3, 8.3, 8.8 |

Phase 5 ADDS: the binary rig twins (WP-5.1), the Export Profile store + loader (section 4.1, WP-5.0), the native runtimes (WP-5.3/5.4) with their compressed-texture loaders, the fast pure-C#-core dump job and the seed/PRNG + A.2-coverage assertion jobs (WP-5.5), the promotion of `conformance-unity`/`conformance-godot` to `ci-pass` dependencies with skipped-as-success semantics (WP-5.5, WP-V.16), and the creation of `release.yml` (WP-5.7). The WP-V.11 "scaffold in Phase 0" wording has been corrected at the source: the cross-cutting doc now labels WP-V.11 "created in Phase 5", and `phase-0-foundations.md` does not produce a `release.yml`, so there is no longer a standing contradiction. The independence model in `conformance-and-ci.md` (top of the document and Section B) has been amended to match ADR-0001.

---

## 13. Definition of Done acceptance script (concrete, runnable)

Phase 5 is DONE when this entire script passes. Steps marked CI are automated; steps marked MANUAL/DEVICE are human walkthroughs.

```bash
# 0. Entry gate still green (regression guard)
pnpm -w turbo run test --filter=@marionette/format --filter=@marionette/runtime-core --filter=@marionette/conformance
# expect: PASS (all prior phases plus Phase 5 unit/conformance tests)

# 1. Binary codec round-trip + fuzz + errors + CRC (CI), Law 3
pnpm --filter @marionette/format test
# expect: PASS for decodeBinary(encodeBinary(doc)) deep-equal (lossless, float64, DECISION-5.2),
#         encodeBinary(decodeBinary(bytes)) byte-identical, fuzz round-trip,
#         CRC-32/ISO-HDLC check vector 0xCBF43926 over "123456789",
#         and typed BinaryDecodeError on bad magic/version/crc/truncation.

# 2. Binary twins regenerate deterministically (CI)
pnpm --filter @marionette/conformance run generate \
  && git diff --exit-code packages/conformance/src/rigs packages/conformance/src/fixtures
# expect: no diff (JSON rigs, binary twins, seed/PRNG goldens, and fixtures all stable).

# 3. Size/parse benchmark within targets (CI), against committed baseline (TASK-5.1.7)
pnpm --filter @marionette/format bench
# expect: binary raw <= 60% JSON raw; binary parse+validate <= 50% JSON; binary gzip <= JSON gzip.

# 4. Atlas optimization + Export Profile + artifact determinism (CI)
pnpm --filter @marionette/editor test export
# expect: POT pages, occupancy report >= 75% (or named oversized sprites),
#         deterministic re-export of atlas JSON + PNG (byte-identical),
#         compressed artifact byte-stable (pinned encoders) or content-hash-equivalent,
#         atlas-targets.json schema valid, export-profile.json validates against exportProfileSchema,
#         loadExportProfile rejects an invalid file with a typed ExportProfileError,
#         ExportProfile vs SkeletonDocument disjoint-fields test green,
#         packages/format unchanged by this WP (git diff empty for the contract).

# 4b. runtime-web compressed-texture selection + decode + PNG fallback (CI)
pnpm --filter @marionette/runtime-web test
# expect: selector returns ASTC/BC7/ETC2/PNG for each mocked capability set;
#         known-pixel page transcodes/decodes within the texture epsilon;
#         PNG fallback renders when the compressed artifact is absent.

# 5. Conformance + seed/PRNG equivalence + coverage across ALL THREE runtimes (CI), INV-3 + Law 1 + Law 3
#    web:
pnpm --filter @marionette/conformance test
#    seed/PRNG + CRC cross-language equivalence (TASK-5.5.7) and A.2 coverage meta-test (TASK-5.5.8): green
#    native (headless, conformance-native.yml, surfaced through ci-pass):
#      Unity:  Unity -batchmode -nographics -projectPath runtimes/unity \
#                    -executeMethod Conformance.Dump.Run -quit  &&  mc-conformance compare unity-dump-*.json
#      Godot:  godot --headless --path runtimes/godot --script res://conformance/dump.gd -- --out godot-dump \
#                                                       &&  mc-conformance compare godot-dump-*.json
# expect: all rigs pass within the A.5 tolerance for web, Unity, and Godot;
#         seed/PRNG goldens bit-identical across TS/C#/GDScript; A.2 coverage meta-test green;
#         a planted bend/degrees/skin-order bug in any runtime turns its job (and ci-pass) red;
#         a packages/format codec change triggers the engine jobs (path filter);
#         an unrelated PR skips the engine jobs and ci-pass still passes (skipped-as-success).

# 6. Format unchanged unless ADR (Law 3) and version consistency (release gate)
git diff --name-only origin/main -- packages/format
# expect: empty, OR every changed file pairs with docs/adr/*.md + a formatVersion bump.
mc-release verify-versions
# expect: runtime-web, Unity, and Godot artifacts all target the same formatVersion as packages/format;
#         fixtures-lock clean.

# 7. Lint / type strictness (CI)
pnpm -w turbo run lint typecheck
# expect: PASS; zero 'any', zero unjustified 'as' in packages/format (binary codec) and runtime-core;
#         zero em-dashes; no PixiJS import in runtime-core/format;
#         no cross-import between the export-profile module and packages/format.
```

MANUAL / DEVICE walkthrough (the milestone, section 1 exit):

- [ ] D5.1 Export the frozen reference game (WP-5.0) to the binary document + optimized mobile atlas under the frozen Export Profile through the editor; the export validates the document on the way out. The editor's own save format stayed JSON (section 4.2).
- [ ] D5.2 Open the exported game in `runtime-web`, drive it with the REAL math engine's `SpinResult` stream: animated symbols, a win sequence with big/mega escalation, a free-spin trigger, and a tumble cascade all play.
- [ ] D5.3 Open the SAME exported game in the Unity build delivered by WP-5.3 driven by the certified C# engine; the side-by-side with web passes the advisory pixel-diff threshold and the M5.8-a checklist (skinning, deform, blend modes, color, particles with the mobile profile applied).
- [ ] D5.4 Determinism: replay the same `SpinResult` corpus twice in web and twice in Unity; the visuals are identical each time (Law 1). Particle emission uses the Phase 3 trigger-supplied seed provenance (`spinSeed`/`hash32`), proven bit-identical across runtimes by TASK-5.5.7, not a host RNG.
- [ ] D5.5 On the named mobile device (WP-5.6), the WP-5.3 Unity build's heaviest win sequence sustains 60fps with the mobile profile (ambient scaled, deterministic at authored counts); per-surface cold start is under its budget; no main-thread block exceeds 16ms; the ASTC variant binds on device and the PNG fallback renders when compression is forced off; iOS provisioning for the device deploy is recorded; the trace is committed.
- [ ] D5.6 CI shows all three conformance jobs green and required via `ci-pass`; the seed/PRNG equivalence and A.2 coverage meta-tests are green; a deliberate one-line solve bug in Unity or Godot turns its job (and `ci-pass`) red and blocks merge on a runtime-touching PR.
- [ ] D5.7 A release is cut through WP-5.7: signed, notarized editor builds on macOS and Windows; published versioned runtime-web (npm), Unity (UPM), and Godot (addon) artifacts; the game bundle attached; the release was permitted ONLY because conformance was green and the formatVersion was consistent across artifacts.
- [ ] D5.8 Auto-update: an older signed editor build updates to the new signed release; an unsigned/tampered update is rejected.

When CI steps 0 to 7 are green AND D5.1 to D5.8 pass, Phase 5 is DONE: one full game is shipped through Marionette to web + Unity with conformance parity proven across all three runtimes (Law 5 terminal milestone).

---

## 14. Non-goals and explicit deferrals (Phase 5)

- **A Godot game build.** Godot is a conformance-green runtime this phase, not a ship target (DECISION-5.0). Shipping a Godot game is future work.
- **A binary editor save format.** The editor saves/loads JSON (section 4.2). Binary is export-only; a binary IMPORT path into the editor (rebuild `DocumentModel`, reset `History`, with its own tests) is future scope, not built here.
- **Lossy float32 binary transport profile.** The default binary is lossless float64 (DECISION-5.2). A float32 profile is a separate, opt-in, epsilon-validated future `containerVersion` (with `flags` bit0 cleared), not built here.
- **Per-target atlas references inside the format.** Compression and mips stay out of the contract via the sidecar manifest; putting them in `AtlasPage` is only via the TASK-5.2.7 ADR path if forced.
- **Amending the Phase 3 particle contract.** Phase 5 does NOT change Phase 3 sections 7.3/8.3/8.8; it consumes them. Deterministic effects are never count-scaled; the mobile fit is an authoring decision in WP-5.0. The `spinSeed` derivation is pinned by Phase 3/4 (G5.8), not invented here.
- **GPU skinning in native runtimes.** CPU LBS (mirroring `runtime-core`) is used to guarantee parity; GPU skinning is a later optimization that must still match the fixtures.
- **A third fully-independent C# solve.** ADR-0001 shares one C# core across Unity and Godot; a second independent C# solve is the documented fallback, not the plan.
- **Live-ops / CDN delivery infrastructure for games.** Out of scope; the phase ships artifacts, not a content-delivery service.

---

## 15. Reviewer sign-off checklist

A senior reviewer signs off on this plan only if all of the following are true:

- [ ] S1 WP-5.0 freezes ONE reference game, its `SpinResult` corpus, AND the Export Profile before any hardening; the deterministic win effects are authored within the mobile particle budget; ship targets are web + Unity with Godot conformance-only (DECISION-5.0); the Export Profile loader/persist/typed-error is a concrete owned task (TASK-5.0.6/5.0.7).
- [ ] S2 The binary is the SAME logical schema, carries the SAME `formatVersion`, validates on decode with the SAME validator, and round-trips JSON to binary deep-equal (lossless float64, DECISION-5.2). `containerVersion` is layout-only; the string-table order, `flags` bit0, `DrawOrderKeyframe.order` index encoding, and the CRC-32/ISO-HDLC variant are all pinned (WP-5.1, Law 3).
- [ ] S3 The binary container is our own (`MRNT`), not Spine `.skel`, with no compatibility claim; the editor save format stays JSON and binary is export-only (WP-5.1, section 4.2, Law 4).
- [ ] S4 Atlas optimization changes NO format field by default; compression/mips are sidecar; the texture transport is decided (single UASTC KTX2 by default, sidecars fallback, confirmed against Pixi v8) and the compressed artifact is byte-stable or content-hash-equivalent; any contract change is an ADR + semver bump (WP-5.2, Law 3).
- [ ] S5 The Export Profile is a defined third store (section 4.1): committed, `exportProfileVersion`-versioned (semver-validated), Zod-validated with both device profiles required, persisted outside the document and outside Zustand by an owned loader, fenced from `SkeletonDocument` by lint + a disjoint-fields test, and frozen in WP-5.0.
- [ ] S6 Compressed-texture variant selection + decode/transcode + PNG fallback is OWNED and implemented in runtime-web AND Unity (and Godot), with acceptance that is not "loads on device" (TASK-5.2.8/5.3.7/5.4.6); on-device is a confirmation layer (TASK-5.6.6).
- [ ] S7 Unity and Godot share one fixture-validated C# solve core with per-engine render adapters and an endian-safe, CRC-pinned, TS-equivalence-checked decoder (ADR-0001); the TS `runtime-core` remains the independent oracle; the Godot dump runs through the engine path; the compensating control (A.2 coverage meta-test, TASK-5.5.8) is in place and the conformance doc is amended to match.
- [ ] S8 All three runtimes are conformance-green in CI headless; drift is red via the `ci-pass` aggregator; the always-on gate is `conformance-web` + the fast core job + the seed/PRNG equivalence job; engine jobs are path-filtered (incl. `packages/format/**` and `packages/runtime-core/**`)/nightly with skipped-as-success; the single A.5 tolerance is never loosened; binary twins are the native load path (WP-5.5, cross-ref WP-V.13/14/16, D.3/D.13).
- [ ] S9 The mobile particle profile scales AMBIENT effects only and uses the Phase 3 NORMATIVE eviction; deterministic effects run at authored counts; no fps-based culling; particle seeds use the Phase 3 trigger-supplied provenance with the pinned `spinSeed` derivation proven bit-identical across runtimes (TASK-5.5.7, G5.8); 60fps and per-surface cold-start/main-thread budgets are validated on a NAMED device with recorded iOS provisioning (WP-5.6, Law 1, INV-5, phase-3 7.3/8.3/8.8).
- [ ] S10 The release pipeline creates `release.yml` (Phase 5 owns it; WP-V.11 label corrected at source), signs, notarizes, and auto-updates the editor, publishes versioned runtime artifacts, and gates releases on green conformance + a consistent `formatVersion` (WP-5.7, Law 3, Law 5).
- [ ] S11 Phase 5 introduces no new document-mutating command outside the existing `SetAtlasRef`; export reads, never mutates, the document; export/playback settings live in the Export Profile store (section 9, section 4.1, Law 2).
- [ ] S12 Section 7 attributes PixiJS to `runtime-web`, not `runtime-core`; the no-Pixi invariant holds; the WP-5.6/WP-5.8 ordering is non-circular (WP-5.3 delivers the playable Unity build, WP-5.6 profiles it, WP-5.8 verifies it); the DoD script is concrete and runnable; the manual/device walkthrough proves one game shipped to web + Unity with three-runtime conformance parity.
- [ ] S13 No em-dashes and no en-dashes anywhere in the deliverables (this plan, the ADR, and the corrective edits to the conformance doc).
