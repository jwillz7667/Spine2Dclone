# Pro Parity Execution Plan (the five-lane program)

> Status: PLAN OF RECORD for closing every gap recorded in
> `docs/audit/spine-pro-parity-audit.md` (sections 3 and 5). Owner of the `PP-*` work-package IDs
> defined below; if any other document disagrees with this one about a `PP-*` item, this document
> wins. It composes with, and does not replace, `docs/plan/phase-5-production-hardening.md`: where
> a PP item overlaps a WP-5.x package, the PP item is the execution vehicle and the WP-5.x document
> remains the design authority.
>
> Execution model: five parallel agents (lanes A to E), each with an exclusive ownership map, a
> mission brief, and staged work packages. Every line of code is reviewed and approved by the
> senior engineer running the program (the orchestrator) before merge. No corner-cutting clauses
> exist in this plan on purpose: the Definition of Done in `CLAUDE.md` applies to every item with
> zero exceptions.

---

## 1. Objective and exit criteria

**Objective.** Armature 2D reaches full capability parity with Spine Pro 4.2 (implemented from
first principles, LAW 4: no Spine source, no Spine binary compatibility), while keeping every
existing invariant green: the five laws, the conformance locks, determinism, and the
machine-enforced boundaries.

**Program exit criteria (all must hold):**

1. Every row marked Missing, Backend-only, Format-only, or Partial in audit section 3 is
   Implemented, or has a signed ADR recording a deliberate product decision not to build it.
2. The four `it.todo` entries in `packages/conformance/test/a2-coverage.test.ts` are real tests.
3. Three-runtime conformance (TS, Unity C#, Godot) is green in CI on every fixture track.
4. A rigger who knows Spine can rig, skin, constrain, animate, and export a production character
   end to end in the GUI without touching MCP, and the exported document plays identically in the
   web player, Unity, and Godot.
5. `pnpm ci:local` plus the native conformance workflow pass on a signed, packaged build.

**Product requirements (owner directives, 2026-07-08; these bind every lane):**

- **Standalone and local-only.** The finished product is a desktop application that runs entirely
  locally and saves projects to the user's device. NO user data is stored, collected, or
  transmitted: no telemetry, no accounts, no cloud dependency. The only permissible network touch
  is an opt-in update check in the packaged app.
- **Installers for macOS (Apple Silicon and Intel), Windows, and Linux.** PP-E5 covers all three
  platforms; Linux is a first-class target, not an afterthought.
- **Free product.** Armature 2D ships free. The Essentials/Pro edition split in
  `docs/plan/product-editions.md` is superseded: no edition gating, no licensing mechanism, ever.
- **Export breadth.** The user exports a finished project in the format they need: portable JSON,
  MRNT binary, packed atlases (done), engine playback (web done; Unity/Godot per Lane E), and
  rendered media (PNG sequence, animated GIF/APNG, video) per PP-C10.
- **Format expressive parity.** OUR format must be able to express everything Spine's format can
  express: every concept in the audit's section 3.1 table gets a first-principles representation
  of our own design (the F1 to F4 staging is exactly this). Capability mirror, original encoding,
  original code. The product never WRITES Spine's formats and never claims Spine compatibility as
  a specification promise.
- **Spine project import, migration path (owner directive, 2026-07-08).** To let Spine users
  switch, the product IMPORTS user-owned projects exported from Spine (JSON first, `.skel` binary
  second) and converts them to our format immediately on import. Non-negotiable guardrails, which
  refine but do not repeal LAW 4: (1) import-only, never export; (2) strict clean-room:
  implemented exclusively from Esoteric's PUBLISHED format documentation and inspection of
  user-owned exported files, NEVER from Spine runtime or editor source code, which no contributor
  or agent may open while working on this repo; (3) the importer lives in its own quarantined
  package (`packages/import-spine`, enters the allowlist through the normal process) that only
  PRODUCES our validated format, so the core never grows a second dialect; (4) unsupported or
  ambiguous constructs fail loudly with typed errors and a written import report, never silent
  approximation; (5) product copy uses nominative, factual wording pending counsel review. This
  is work package **PP-A5** (owned by Lane A once F-stages allow, GUI surface via Lane D).

## 2. Non-negotiables (read before any code)

These bind every lane and every PR. They restate nothing new; they are the existing repo law
applied to this program.

1. **The five laws** (`CLAUDE.md`). LAW 2 especially: every new document capability ships as
   commands with do/undo round-trip tests; LAW 3: every format change is staged, versioned,
   migrated, and CHANGELOG'd; LAW 4: design every feature from the published behavior of the
   concept, never from Spine's source or serialization.
2. **The Definition of Done checklist in `CLAUDE.md`** applies per PR, verbatim.
3. **Senior review is mandatory.** No agent merges its own work. The orchestrator reviews every PR
   against the checklist in section 8 and either approves, requests changes, or rejects. Format
   and fixture changes additionally require the behavior-change gate
   (`docs/plan/cross-cutting/conformance-and-ci.md`).
4. **Determinism is a feature requirement, not a test afterthought.** Anything that steps over
   time (physics constraints included) uses fixed timesteps and integer or fixed-point
   accumulators exactly like `effects/emitter-solve.ts` does, and lands with a determinism test
   and an allocation probe.
5. **The dependency graph is frozen.** No new workspace packages except the two native runtimes
   (`runtimes/unity`, `runtimes/godot`) and, if Lane C needs it, a `packages/player-web` packaging
   shell; each enters through `tools/check-packages.mjs` and the ESLint boundaries config in the
   same PR that creates it.
6. **No dashes** (em or en) in any file; Conventional Commits; one logical change per commit;
   never merge red CI.

## 3. Format staging (the spine of the sequencing)

All format work belongs to Lane A and lands in strictly ordered stages. Nothing downstream of a
format stage starts before that stage merges. Each stage is one MINOR bump with a tested
migration, an ADR, negative fixtures per new error code, and a CHANGELOG entry.

| Stage | Version | Contents |
|---|---|---|
| F1 | `0.3.0` | Draw-order timelines; event definitions (name, int/float/string payloads, audio path + volume + balance) and event timelines. The reserved error codes (`DRAWORDER_INCOMPLETE`, `EVENT_NAME_DUPLICATE`, `ANIM_EVENT_UNKNOWN`) become live validators. Skeleton metadata block (fps, images path, audio path). |
| F2 | `0.4.0` | Constraint depth: IK softness/stretch/compress/uniform and signed bend direction; transform-constraint local and relative variants; explicit constraint `order`. Linked meshes; sequence attachments. Per-component bone timelines with per-component bezier curves; slot color rgb/alpha split; keyable dark color (two-color tint). Skin-scoped bones and constraints. |
| F3 | `0.5.0` | Path attachments (closed/open, constant-speed parametrization data) and path constraints (position/spacing/rotate modes, percent and fixed spacing, mix per channel). |
| F4 | `0.6.0` | Physics constraints, first-principles design: per-bone spring/damper on selected channels (x, y, rotate, scaleX, shearX), inertia, strength, damping, mass distribution, wind and gravity inputs, mix, and a reset semantics; fixed-timestep deterministic integration defined in the ADR before any code. |

Rules: one stage per PR series; a stage's ADR merges before its schema PR; downstream lanes pin to
a merged stage only (never to a format branch). Pre-1.0 breaking changes bump MINOR per
`format-contract.md` section 10.

## 4. The five lanes

Each lane is one agent, one long-lived focus, many small PRs. Ownership maps are exclusive: an
agent edits outside its map only via a handoff request through the orchestrator (never directly),
which is what makes five-way parallelism safe.

### Lane A: Contracts (format and migrations)

- **Ownership:** `packages/format/**`, format ADRs in `docs/adr/`, `packages/format/CHANGELOG.md`.
- **Mission:** land stages F1 to F4 flawlessly. The format is the one expensive-to-change
  artifact; this lane trades speed for exactness.
- **Work packages:**
  - **PP-A1 (F1, 0.3.0):** draw-order timeline schema (per-key slot offsets), event definitions +
    event timeline schema, skeleton metadata; validators with the three reserved codes plus any
    new ones; migration 0.2.x to 0.3.0 (empty events/drawOrder, hash recompute); golden corpus +
    negative fixtures; `barrel.surface` update.
  - **PP-A2 (F2, 0.4.0):** everything in stage F2, one schema PR per coherent group (constraints;
    linked meshes + sequences; timeline granularity + two-color; skin scoping), single version
    bump at the end of the series with the migration covering all of it.
  - **PP-A3 (F3, 0.5.0):** path attachment and path constraint schemas + validators (chain
    continuity, target-slot path-kind check, mode enums).
  - **PP-A4 (F4, 0.6.0):** physics constraint schema per the ADR; validator rules (channel set
    nonempty, damping/strength ranges, deterministic-step declaration).
- **Acceptance per package:** validators reject every malformed shape with an exact code and a
  committed negative fixture; migration round-trips a pre-bump corpus document; `check:format-semver`
  and `check:format-version-stable` green; zero `any`.

### Lane B: Core solve and conformance (runtime-core, conformance)

- **Ownership:** `packages/runtime-core/**`, `packages/conformance/**`, solve ADRs.
- **Mission:** implement every new behavior in the one behavioral source of truth, lock it with
  fixtures and (where integer) cross-language vectors, and keep the solve allocation-free.
- **Stage 0 (start immediately, no format dependency):**
  - **PP-B1:** land the `rig-transform-modes` fixture into `RIG_IDS` (the solve already supports
    it) and the `rig-blendmodes` fixture; convert the corresponding `it.todo` entries.
  - **PP-B2:** clipping evaluation (Sutherland-Hodgman or equivalent convex/concave clip of
    triangle streams against the clipping polygon, defined in an ADR), bounding-box hit-test API,
    point-attachment world resolve; fixtures for each.
  - **PP-B3:** runtime skin state (an explicit skin-selection API over the existing per-skin
    sampling, so renderers and games switch skins without re-building the pose).
- **Stage F1:** **PP-B4:** draw-order application in the solve (a draw-order lane in `Pose`,
  reset each frame per the canonical order) and event firing with exact loop-boundary semantics in
  both `sampleSkeleton` and the AnimationState queue; `rig-events-draworder` and
  `rig-events-loop` fixtures; the last two `it.todo` entries become real.
- **Stage F2:** **PP-B5:** constraint depth (IK softness/stretch/compress/uniform, signed bend;
  transform local/relative variants; ordered constraint solving honoring `order` while keeping
  the IK-before-transform default for documents that omit it, per an ADR-0003 amendment);
  per-component timeline application; two-color lane in `Pose` + skinning; linked-mesh and
  sequence sampling. Fixtures per family.
- **Stage F3:** **PP-B6:** path solve: constant-speed arc-length parametrization (precomputed
  tables, no per-frame allocation), position/spacing/rotate modes, conformance fixtures with an
  independent analytic oracle for at least one closed-form case (straight-line path).
- **Stage F4:** **PP-B7:** physics solve: fixed-dt semi-implicit integration exactly as the ADR
  pins it, integer step clock, seedless (physics is deterministic, not random), pose-reset
  semantics, fixtures sampling long runs, allocation probe, and cross-language vectors for the
  integrator's arithmetic.
- **Standing orders:** every behavior change regenerates fixtures on Node 22.13.1 in the same PR
  behind the behavior-change gate; every new integer primitive is added to
  `cross-language/seed-prng-crc-vectors.json`; nothing in this lane may import PixiJS, Zod, DOM,
  or Node built-ins.

### Lane C: Playback and packaging (runtime-web, render-preview, atlas-pack, player)

- **Ownership:** `packages/runtime-web/**`, `packages/render-preview/**`,
  `packages/atlas-pack/**`, the future `packages/player-web` if created.
- **Mission:** the web player renders one hundred percent of the format, ships as a documented
  API, and render-preview keeps pixel-parity for headless feedback.
- **Stage 0:**
  - **PP-C1:** apply trim offsets in the region slicer (close the documented gap in
    `region-textures.ts`) with placement-parity tests against render-preview.
  - **PP-C2:** rotated atlas regions end to end: rotation packing in atlas-pack (deterministic),
    rotated-region slicing and UV mapping in runtime-web and render-preview, retire
    `RotatedRegionUnsupportedError`.
  - **PP-C3:** GL particle rendering (the WP-3.5 remainder): pooled sprite batch fed by
    `fillEmitterBatch`, MeshRope ribbons, screen-cover quads, zero per-frame allocation, quality
    tiers respected.
  - **PP-C4:** GL slot renderer (the WP-4.11 remainder) consuming the timeline cursor directives,
    plus a scene preview surface the editor can mount.
  - **PP-C5:** the packaged player API: an asset loader (JSON + `.mrnt` + atlas pages),
    `createPlayer(canvas, urls)` level ergonomics, documented public surface, no host-injected
    texture plumbing required; premultiplied-alpha support through atlas-pack and the blend
    mapping.
  - **PP-C6:** runtime skin switching in `SkeletonView` on top of PP-B3.
- **Stage F1:** **PP-C7:** render draw-order changes per frame; surface fired events on the
  player API.
- **Stage F2:** **PP-C8:** two-color tint (dark color) render path; clipping mask rendering (stencil
  or geometry clip, matching PP-B2 evaluation exactly); linked meshes and sequences; per-component
  curve playback comes free from core but gets playback tests.
- **Stage F3/F4:** **PP-C9:** path and physics rendering support (mostly free via core; verify
  with playback parity tests) and the export-pipeline GPU remainder (WP-5.2: scale variants,
  mips, KTX2/UASTC transcode, blend binning) behind the frozen export profile.
- **Any stage:** **PP-C10 (rendered-media export):** deterministic PNG-sequence export from
  render-preview frames (an animation sampled at a chosen fps), animated GIF and APNG encoding
  (pure-JS encoders, same determinism bar as pngjs), and video export (WebM/MP4) via a bundled
  encoder at the editor edge only (never a runtime dependency). The editor export dialog surface
  belongs to Lane D (PP-D6); the frame pipeline and encoders are Lane C. This is the "export a
  finished cartoon or clip in whatever format the user wants" requirement.
- **Standing orders:** every render feature lands in BOTH runtime-web and render-preview (or an
  ADR records why not), with a shared-math parity test, because `render_frame` is how the AI
  authoring loop sees its work.

### Lane D: Authoring surface (document-core, mcp-server, editor)

- **Ownership:** `packages/document-core/**`, `packages/mcp-server/**`, `apps/editor/**` (except
  packaging config, which is Lane E's).
- **Mission:** everything a Spine rigger's hands expect, powered by commands, mirrored over MCP.
  The triple rule: a new capability is not done until it exists as (1) commands with round-trip
  tests, (2) MCP tools with family tests, (3) GUI surface. No capability ships GUI-only or
  MCP-only.
- **Stage 0:**
  - **PP-D1:** gizmo completion: scale handles, shear editing, numeric bone transform entry in
    the inspector, multi-select (selection store, marquee, gizmo on the selection centroid,
    composite drag as one interaction session).
  - **PP-D2:** dopesheet completion: rows for attachment/deform/IK/transform-constraint
    timelines, keyframe deletion via Delete key and context UI, playback speed control, manual
    key buttons.
  - **PP-D3:** the value-vs-time graph editor (a real curve view over the existing per-key easing
    model) and onion skinning (ghost renders at configurable frame offsets; render-only, zero
    document state).
  - **PP-D4:** skins panel (create/duplicate/switch/assign over the five existing commands) and
    runtime-skin preview wiring (PP-C6).
  - **PP-D5:** asset pipeline UX: atlas-texture restore on document load (persist page references
    and reload pixels), drag-and-drop and single-file import, pre-made atlas import, layered
    (PSD/ORA) import behind a pure decode module, asset thumbnails.
  - **PP-D6:** export UX: binary `.mrnt` export action, packer settings UI over `PackConfig`,
    export-profile panel over the WP-5.0 loader.
  - **PP-D7:** editor ergonomics debt: bone copy/paste/duplicate, find/filter in hierarchy and
    dopesheet; hierarchy tree grows slot/constraint/skin nodes with sibling reorder.
  - **PP-D8:** effects and slot panel completion: emitter field + life-curve editing, layer
    reorder, bundle editing, live VFX preview (mounts PP-C3), win-sequence/feature-flow/tumble
    full editing, slot scene preview (mounts PP-C4).
- **Stage F1:** **PP-D9:** event and draw-order authoring: commands, MCP tools, dopesheet event
  row and draw-order keys, event audio preview.
- **Stage F2:** **PP-D10:** constraint-depth inspectors, linked-mesh and sequence authoring,
  per-component key editing, two-color pickers, skin-scoped bone/constraint management.
- **Stage F3/F4:** **PP-D11:** path tooling (draw/edit path attachments, constraint creation and
  gizmos) and **PP-D12:** physics tooling (constraint inspector, live preview toggle, reset).
- **Standing orders:** commands stay renderer-agnostic in document-core; panels never mutate
  directly; every drag is an interaction session (one undo step); every new command family gets
  MCP tools in the same PR series and manual-chapter updates before the package closes.

### Lane E: Native runtimes and production (Unity, Godot, CI, release)

- **Ownership:** `runtimes/**`, `.github/workflows/**`, `packages/math-bridge/src/real/**`,
  editor packaging config (electron-builder), `tools/check-packages.mjs` allowlist updates for
  the runtimes.
- **Mission:** three-runtime parity and a shippable product.
- **Work packages:**
  - **PP-E1:** `runtimes/unity` (C#, per ADR-0001-shared-csharp-runtime-core): mirror
    runtime-core module by module (affine, pose, sampling, AnimationState, constraints, skinning,
    deform, effects PRNG chain, slot sequencer), consuming the SAME conformance fixtures and
    cross-language vectors; a thin MonoBehaviour view layer; GameCI batchmode conformance job.
  - **PP-E2:** `runtimes/godot` (GDScript or C# per its ADR): same contract, headless Godot
    conformance job.
  - **PP-E3:** activate `conformance-native.yml` for real (replace the TODO jobs, wire
    `conformance-native-pass` into `ci-pass` per TASK-5.5.6), nightly full-matrix run.
  - **PP-E4:** the live certified-engine transport for `RealEngineAdapter` (WP-5.8): concrete
    non-transacting resolve client with timeouts, typed failures, and a contract test against the
    mock's vocabulary; still lint-unreachable from presentation.
  - **PP-E5:** release pipeline (WP-5.7): electron-builder packaging for macOS arm64+x64,
    Windows, and Linux (AppImage plus deb/rpm), signing and notarization where the platform
    supports it, an integrity-checked and strictly OPT-IN auto-update feed (the local-only
    privacy directive: the app makes no other network request), and a tag-triggered release
    workflow gated on `ci-pass` + `conformance-native-pass`.
  - **PP-E6:** mobile device profiling (WP-5.6): the profiling harness, budget assertions from
    the phase plan, and a written report per reference device.
  - **Chase work:** after every merged F-stage, port the new solve behavior and turn the new
    fixtures green natively before the next stage merges (the lag between TS-green and
    native-green may never exceed one stage).
- **Standing orders:** natives read fixtures and vectors from `packages/conformance` verbatim
  (single source); no native-only behavior; tolerance policy is the shared one and is never
  loosened.

## 5. Stage sequencing across lanes

```
Stage 0  (now, fully parallel):  A: PP-A1 draft ADR   B: PP-B1..B3   C: PP-C1..C6   D: PP-D1..D8   E: PP-E1..E2 scaffold + port current solve
Gate G1: PP-A1 merged (format 0.3.0)
Stage 1:                         A: PP-A2 series      B: PP-B4       C: PP-C7       D: PP-D9       E: chase F1
Gate G2: PP-A2 merged (0.4.0)
Stage 2:                         A: PP-A3             B: PP-B5       C: PP-C8       D: PP-D10      E: chase F2 + PP-E3
Gate G3: PP-A3 merged (0.5.0)
Stage 3:                         A: PP-A4             B: PP-B6       C: PP-C9       D: PP-D11      E: chase F3 + PP-E4
Gate G4: PP-A4 merged (0.6.0)
Stage 4:                         A: support           B: PP-B7       C: parity fill D: PP-D12      E: chase F4 + PP-E5..E6
Exit: section 1 criteria, reference character + reference game shipped through the pipeline.
```

A lane that finishes its stage early pulls forward its own next-stage design work (ADR drafts,
test plans) rather than crossing into another lane's map.

## 6. Common agent operating protocol (verbatim instructions to each agent)

Every agent receives its lane brief (section 4) plus these standing instructions:

1. **Read first, in order:** `CLAUDE.md`; `docs/dev/architecture.md`; this plan's sections 2, 3,
   and your lane; the cross-cutting contract(s) your lane touches; your owned packages' READMEs.
2. **Work in your own worktree on lane branches** named `feat/pp-<id>-<slug>`, one work package
   (or one coherent slice of it) per branch. Rebase on `main` at least daily; never let a branch
   live longer than a stage.
3. **Never edit outside your ownership map.** If you need a change in another lane's files, write
   the need as a short interface request (what, why, proposed signature) and hand it to the
   orchestrator. Consume other lanes' work only after it merges to `main`.
4. **TDD the contracts:** for solve work, write the fixture/oracle expectation first; for
   commands, the round-trip case first; for format, the negative fixture first; for UI, the
   panel-logic unit test first. UI pixel polish may iterate, contracts may not.
5. **Before requesting review, run** `pnpm ci:local` and your package suites, and self-check
   against section 8. State in the PR description: what changed, why, the test evidence, and any
   deviation you are asking the reviewer to accept (deviations default to rejected).
6. **Stop and escalate instead of guessing** when: a contract is ambiguous, a change would touch
   a frozen surface (solve order, tolerance policy, format without a stage), a dependency you
   need is unmerged, or a test can only pass by weakening it. Escalations go to the orchestrator
   with a one-paragraph statement of the blocker and your recommendation.
7. **No placeholder code.** No stubs, no `TODO` markers, no commented-out blocks, no mock data in
   product paths. If a slice cannot be completed whole, cut the slice smaller, not shallower.
8. **Docs ride along:** update the owned package README, the relevant manual chapter, and (for
   behavior) the conformance docs in the same PR series that changes them.

## 7. Orchestrator (senior dev) responsibilities

1. Dispatch the five agents with their briefs; re-dispatch per stage.
2. Sequence merges: format stage PRs first, then core, then renderers/authoring, natives chasing.
3. Review every PR (section 8) and approve or reject; run an independent `/code-review` pass and
   targeted verification (drive the affected flow, not just the tests) on every approval.
4. Own the behavior-change gate sign-offs and the ADR approvals.
5. Keep the integration branch healthy: any red `main` freezes all merges until green.
6. Maintain a stage board (which PP items are open/in-review/merged) and publish it at each gate.

## 8. Senior review checklist (applied to every PR, no exceptions)

- [ ] Correctness: I can state what the change does and construct the failure it prevents; edge
      cases (empty, loop boundary, zero-length, degenerate geometry, max influences) are tested.
- [ ] Laws: no mutation outside commands; no presentation-decides-outcome path; format discipline
      followed; no Spine-derived code or naming; phase/stage gate respected.
- [ ] Tests: round-trip for commands (merged-sequence for coalescing), negative fixture for
      validators, fixtures regenerated on the pin for solve changes, determinism + allocation
      probes for stepped systems, parity tests for dual render paths.
- [ ] Quality: TS strict, no `any`/unjustified `as` in the protected packages, barrel-only
      imports, no per-frame allocation in hot loops, typed errors at boundaries, naming and
      comment discipline match the surrounding code.
- [ ] Scope: one logical change; refactor and behavior separated; ownership map respected.
- [ ] Docs: READMEs, manual, ADR/CHANGELOG updated where the change makes them stale.
- [ ] Evidence: CI green, `pnpm ci:local` claimed and spot-verified, PR description honest about
      limitations.

Reject on any unchecked box. Two rejections of the same issue trigger a design conversation, not a
third attempt at the same diff.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Physics determinism across languages | ADR pins integrator, dt, and arithmetic order BEFORE code; cross-language vectors for the integrator; fixtures sample long horizons. |
| Five agents collide in shared files | Exclusive ownership maps; interface requests through the orchestrator; document-core and mcp-server owned by exactly one lane (D). |
| Format stages become mega-PRs | Each stage is a PR series (schema, validator, migration, fixtures) with the version bump last; ADR merges first. |
| Native runtimes drift behind TS | The one-stage-lag rule (Lane E chase work) enforced at every gate. |
| GUI work outruns render capability | Stage 0 ordering puts PP-C3/C4 (GL particles/slot) ahead of the panels that preview them (PP-D8 mounts them). |
| Review becomes the bottleneck | Small PRs by construction (slices, series); the checklist is mechanical; agents self-check before requesting review. |
| Scope creep past Spine parity | Anything not traceable to an audit row or a WP-5.x package needs a new ADR and orchestrator approval before code. |
