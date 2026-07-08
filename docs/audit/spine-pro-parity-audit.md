# Spine Pro parity audit: what remains for a fully functional Spine 2D Pro alternative

> Date: 2026-07-02. Audited at commit `a256320` on a fully green tree
> (2,130 tests passing across all 10 workspaces, 4 `it.todo` coverage gaps in
> `packages/conformance/test/a2-coverage.test.ts`). This document records the
> verified current state, the gap analysis against Esoteric Software's Spine Pro
> 4.2 feature surface, and a prioritized completion roadmap. It is an audit, not
> a plan of record; the plan of record remains `docs/plan/` and `docs/DEV_PLAN.md`.
> Law 4 note: "parity" here means equivalent capability implemented from first
> principles. No Spine source, no Spine binary-format compatibility, ever.

---

## 1. Executive summary

The project is in an unusual and specific shape: **the deterministic solve core,
the format contract, the command system, and the conformance machinery are
production-grade, while the authoring UI and the playback renderer trail the
backend by roughly one full phase.** Phases 0 to 4 are complete in
CI-verifiable form and several Phase 5 headless slices have landed (binary
codec, export profiles, cross-language vectors, texture-variant selector,
`transformMode` in the solve).

The five headline gaps, in order of how much they block "usable as a Spine Pro
alternative":

1. **The Phase 2 rigging UI does not exist.** Mesh editing, weight painting,
   and IK/transform-constraint authoring are backend-complete in
   `packages/document-core` (commands, triangulation, auto-trace, brush model,
   auto-weights, round-trip tests) but have zero panels, zero viewport tools,
   and the viewport does not even render mesh attachments. Today a user can
   author a bone puppet, not a rigged character.
2. **There is no animation mixing.** No AnimationState, no tracks, no
   crossfade, no additive layering anywhere in `runtime-core` or `runtime-web`.
   The runtime API is "sample one animation at time t". Every Spine runtime's
   central game-facing feature is absent.
3. **The web player cannot render half the format.** Mesh attachments, clipping
   masks, per-slot blend modes (mapped but never assigned to sprites), tint
   black, and rotated atlas regions are unrendered or rejected. There is no
   asset loader and no packaged player API.
4. **Format 0.3.0 features are still deferred.** Draw-order timelines, event
   definitions and event timelines (the error codes are already reserved), plus
   path constraints, physics constraints, linked meshes, and sequences have no
   format representation at all.
5. **The native runtimes do not exist.** `runtimes/` is absent; the
   `conformance-native.yml` workflow is a self-described scaffold whose
   Unity/Godot jobs skip. Three-runtime parity is declared (Phase 5) but
   unstarted.

Where the project already **exceeds** Spine Pro: the headless MCP authoring
server (88 tools driving the same commands as the GUI), the byte-locked
determinism and conformance harness with an independent analytic oracle, the
content-hash document integrity, the deterministic MRNT binary codec, and the
entire VFX + slot-composition product layer, which Spine does not have at all.

Documentation drift found: `CLAUDE.md` says Phase 5 is "NOT started" while
`docs/DEV_PLAN.md` section 9 correctly records the landed Phase 5 headless
slices. Per the standing rule the plan wins; `CLAUDE.md` is stale.

---

## 2. Verified current state

- `pnpm -r test`: 10 of 10 workspaces green. Counts: format 270, runtime-core
  264, conformance 189 (+4 todo), runtime-web 74, document-core 996,
  math-bridge 29, mcp-server 30, editor 250, lint-checks 28.
- Zero `TODO`/`FIXME` markers in shipped source. The only tracked debt is the
  four explicit `it.todo` entries in the A.2 coverage meta-test: non-normal
  transform modes, draw-order timeline, event firing across a loop boundary,
  and the four slot blend modes.
- Conformance locks 7 skeleton rigs, 4 effects fixtures, and 6 slot
  golden-playback pairs, generated from `runtime-core` behind the
  `.fixtures.lock` sha tripwire, with binary rig twins per rig.
- `transformMode` is now honored in the world solve
  (`packages/runtime-core/src/skeleton/transform-mode.ts`) but has unit-test
  coverage only; the `rig-transform-modes` fixture is not in `RIG_IDS`.

---

## 3. Gap analysis against Spine Pro 4.2

Legend: **Implemented** (works end to end), **Backend-only** (commands/solve
exist, no UI or no render), **Format-only** (schema exists, no behavior),
**Missing** (no trace).

### 3.1 Data format (`packages/format`, formatVersion 0.2.0)

| Spine Pro concept | Status | Notes |
|---|---|---|
| Bones: transform, shear, all 5 inherit modes | Implemented | `schema/bone.ts` |
| Slots: blend modes, color, setup dark color | Implemented | `schema/slot.ts`; darkColor is setup-only, not keyable |
| Region / mesh / boundingbox / point / clipping attachments | Implemented | closed union of 5 kinds, `schema/attachment.ts` |
| Weighted meshes (4-influence cap), hull/edges | Implemented | `mesh/weighted.ts`, deep validation |
| Linked meshes | Missing | no parent/skin/timelines fields on mesh |
| Path attachments + path constraints | Missing | union closes without them |
| Physics constraints (Spine 4.2 headline) | Missing | zero hits repo-wide |
| Sequences (frame-sequence attachments) | Missing | skeleton side; the effects format has an analogous animated texture |
| Skins (default required, per-skin attachments) | Implemented | `schema/skin.ts` |
| Skin-scoped bones/constraints (Spine 4.x) | Missing | skin = name + attachments only |
| IK constraint: chain, target, mix, bend direction | Implemented | bendPositive boolean instead of signed int |
| IK softness / stretch / compress / uniform | Missing | |
| Transform constraint: 6-channel mix + offsets | Implemented | `schema/constraint.ts` |
| Transform constraint local/relative variants | Missing | world-space only per ADR-0003 |
| Bone timelines rotate/translate/scale/shear | Implemented | joint x/y values; no per-component timelines |
| Per-component bezier curves | Missing | one curve per keyframe |
| Slot color timeline | Implemented | single RGBA; no rgb/alpha split, no two-color timeline |
| Attachment-swap timeline | Implemented | |
| Deform timeline | Implemented | absolute offsets, no sparse-vertex compression |
| Draw-order timeline | Missing (staged) | deferral comments + reserved error code `DRAWORDER_INCOMPLETE` |
| Events + event timeline + audio fields | Missing (staged) | reserved codes `EVENT_NAME_DUPLICATE`, `ANIM_EVENT_UNKNOWN` |
| IK / transform constraint timelines | Implemented | for the fields that exist |
| Skeleton metadata (fps, images/audio paths) | Missing | root is formatVersion/name/hash |
| Versioned migrations | Implemented | 0.1.x to 0.2.0 migration, tested |
| Binary serialization | Implemented | MRNT codec: deterministic, CRC-32 trailer, lossless float64 |

### 3.2 Solve runtime (`packages/runtime-core`)

| Capability | Status | Notes |
|---|---|---|
| World pass, all 5 transform modes, zero steady-state allocation | Implemented | allocation probe test enforces it |
| Timeline application, linear/stepped/bezier | Implemented | bezier via 10-segment piecewise-linear table |
| One-bone + two-bone IK (bend, mix, unreachable handling) | Implemented | |
| Transform constraint (6-channel mix + offsets) | Implemented | plain-lerp rotation, no shortest-path blend |
| Weighted skinning + deform offsets | Implemented | fixed accumulation order, reusable scratch |
| AnimationState: tracks, mixing, crossfade, additive, hold-previous | Missing | single-animation `sampleSkeleton` only; looping lives in the transport |
| Path constraints, physics constraints | Missing | |
| Clipping evaluation, bounding-box hit testing, point-attachment resolve | Missing | format shapes only |
| Draw-order animation, events (incl. loop-crossing fire) | Missing | format-deferred |
| Skin switching API | Partial | per-skin mesh sampling exists; no runtime skin state |
| Constraint ordering | Partial | fixed IK-then-transform; no arbitrary interleaving or `order` field |

### 3.3 Playback renderer (`packages/runtime-web`)

| Capability | Status | Notes |
|---|---|---|
| Region attachments: pooled sprites, tint, attachment swap | Implemented | |
| Mesh attachment rendering (skinned + deformed) | Missing | solve is parity-tested headlessly; renderer filters to regions |
| Per-slot blend modes | Backend-only | mapping table exists; `renderFromPose` never sets `sprite.blendMode` |
| Clipping masks | Missing | |
| Tint black / two-color | Missing | pose has no dark-color lane |
| Draw-order changes at runtime | Missing | setup order only |
| Rotated atlas regions | Missing | throws `RotatedRegionUnsupportedError` |
| Trim offsets applied when slicing | Missing | atlas pipeline trims but the slicer ignores offsets |
| Asset/atlas loader, `.mrnt` loading, packaged player API | Missing | host must inject a texture resolver |
| Animation mixing API | Missing | see 3.2 |
| GL particle rendering (ParticleContainer / ribbon) | Missing | headless render-batch bridge only |
| Headless parity sampler, transport, variant selector | Implemented | |

### 3.4 Editor (`apps/editor`)

Authoring surface today is roughly Phase 1 (bone puppet), on top of a
Phase 2/3/4-complete command layer.

| Area | Status | Notes |
|---|---|---|
| Bone create/select/move/rotate, setup vs animation mode, auto-key | Implemented | single-select only |
| Scale gizmo | Backend-only | `ScaleBoneCommand` + dispatcher ready; no handle |
| Shear editing | Missing | dispatcher explicitly excludes it |
| Numeric bone transform entry | Missing | attachments have a numeric grid; bones do not |
| Hierarchy tree | Partial | bones only, drag-reparent with cycle rejection; no slots/constraints/skins in tree, no sibling reorder |
| Mesh editing (create, vertices, hull, auto-trace, grid fill) | Backend-only | `mesh-tool.ts` glue imported by nothing; meshes not rendered in viewport |
| Weight painting + auto-weights + weight table | Backend-only | brush model + stroke session have zero call sites |
| IK / transform constraint authoring | Backend-only | commands complete; `ik-gizmo.ts` is pure math, the gizmo component was never written |
| Skins UI (create/duplicate/switch) | Backend-only | five skin commands, zero editor call sites |
| Dopesheet: tracks, marquee, drag-offset, copy/paste, snap | Implemented | bone + slot-color tracks only; no attachment/deform/IK/constraint rows |
| Keyframe deletion via UI | Missing | delete commands exist; no Delete-key handler or button |
| Curve editor | Partial | per-key normalized easing editor with exact runtime preview; no value-vs-time graph view |
| Playback speed control | Missing | |
| Onion skinning / ghosting | Missing | |
| Events + draw-order authoring | Missing | blocked on format 0.3.0 |
| Asset import | Partial | folder-of-PNGs to trimmed packed atlas, deterministic; no single-file, no drag-drop, no PSD, no pre-made atlas import, no thumbnails |
| Atlas textures restored on document load | Missing | placeholder until re-import |
| Texture packer settings UI, export dialog, binary export action | Missing | export profile loader exists with no caller; Ctrl+S JSON save only |
| Undo/redo, coalescing, keybindings | Implemented | airtight, Law 2 enforced, 996 document-core tests |
| Bone copy/paste/duplicate, find/filter in panels | Missing | |
| Effects (VFX) panel | Partial | create/delete effects and layers, blend mode; emitter field editing, life-curve editing, reorder, bundles, atlas binding all unexposed; no live particle preview |
| Slot composer panel | Partial | grid presets + symbol mapping; win-sequence/feature-flow/tumble editing mostly read-only; no scene preview |

### 3.5 Export and packaging

| Capability | Status | Notes |
|---|---|---|
| JSON export with validation + content hash | Implemented | editor and MCP |
| MRNT binary export from the editor | Backend-only | codec landed; nothing in the app calls `encodeBinary` |
| Atlas: trim, deterministic maxrects pack, PNG pages | Implemented | |
| Rotation packing | Missing | explicitly rejected (`ATLAS_ROTATION_UNSUPPORTED`) |
| Premultiplied alpha | Missing | zero hits |
| Scale variants, mips, KTX2/UASTC, blend binning | Missing | Export Profile schema knobs only (WP-5.2 remainder) |
| App packaging (electron-builder), release pipeline, auto-update | Missing | gate G5.7 / WP-5.7 |

### 3.6 Runtimes and conformance breadth

| Capability | Status | Notes |
|---|---|---|
| TS conformance (skeleton + effects + slot tracks) | Implemented | byte-locked, oracle-checked |
| Unity runtime (WP-5.3) | Missing | no `runtimes/` directory, zero C# |
| Godot runtime (WP-5.4) | Missing | zero GDScript/C# |
| Native conformance CI | Missing | scaffold workflow, jobs skip |
| Fixtures for transform modes, blend modes, events, draw order | Missing | the four `it.todo` entries; extended rig catalog blocked on format 0.3.0 |
| Live certified math engine | Missing | mock engine + adapter and typed money boundary exist; `NonTransactingResolveClient` has no concrete transport (WP-5.8) |
| Mobile device profiling (WP-5.6) | Missing | |

---

## 4. Prioritized completion roadmap

Ordering respects Law 5 (each tier leaves a usable artifact) and the existing
Phase 5 plan; tier 1 is the shortest path to "a person can rig and ship a
character with this instead of Spine."

### Tier 1: close the authoring/playback gap (the Spine-alternative blocker)

1. **Mesh rendering in `runtime-web` and the editor viewport.** PixiJS Mesh
   path fed by `sampleMeshVertices`; without this every Phase 2 backend feature
   is invisible. Includes applying trim offsets in the region slicer and
   honoring per-slot blend modes (one-line assignment plus the `rig-blendmodes`
   fixture to clear an existing `it.todo`).
2. **Rigging UI wave 1: mesh tool.** Viewport vertex/edge/hull editing wired to
   the existing `GenerateMeshFromRegion` / `AddMeshVertex` / auto-trace /
   grid-fill commands; a mesh mode on the toolbar.
3. **Rigging UI wave 2: weights.** Weight-paint brush tool driving the existing
   stroke session (one undo per stroke), bone-color overlay, a weight table in
   the inspector, auto-weights button.
4. **Rigging UI wave 3: constraints.** IK target gizmo (the math module already
   exists), constraint creation from selection, inspector sections for mix /
   bendPositive / transform-constraint channels, constraint rows in the
   hierarchy tree.
5. **Gizmo completion.** Scale handle (command is ready), shear entry, numeric
   bone transform fields, multi-select.
6. **Format 0.3.0 (MINOR bump, migration, ADR).** Draw-order timeline, event
   definitions + event timeline (audio fields included). This unblocks the
   extended conformance rig catalog (`rig-events-draworder`, `rig-events-loop`,
   `rig-transform-modes`, `rig-blendmodes`), the remaining `it.todo` entries,
   and the corresponding dopesheet rows and runtime-core application.
7. **AnimationState in `runtime-core`.** Tracks, mix durations, crossfade,
   additive layering, event queue with loop-crossing semantics; mirrored in
   `runtime-web` as the game-facing API and covered by new conformance
   fixtures. This is the single largest missing runtime feature.
8. **Editor quality-of-life debt.** Keyframe deletion UI, dopesheet rows for
   attachment/deform/IK/constraint timelines, playback speed, skins panel
   (commands exist), atlas texture restore on document load.

### Tier 2: parity depth (what makes it "Pro")

9. **Constraint depth.** IK softness/stretch/compress/uniform; transform
   constraint local/relative variants; an explicit constraint `order`.
10. **Path attachments + path constraints** (format, solve, conformance, UI).
11. **Physics constraints** (the Spine 4.2 flagship; format + solve +
    conformance + inspector).
12. **Clipping evaluation and rendering**, bounding-box hit-test API,
    point-attachment world resolve.
13. **Linked meshes and sequences**; per-component timelines and
    per-component bezier curves; rgb/alpha split and two-color (tint-black)
    timeline with the dark-color pose lane and render path.
14. **Animation polish tools.** Value-vs-time graph editor, onion skinning,
    manual key buttons, bone copy/paste/duplicate, find/filter.
15. **Import breadth.** Single-file and drag-drop import, PSD/layered import,
    pre-made atlas import, asset thumbnails.
16. **Runtime packaging.** Atlas/`.mrnt` loader and a documented player API for
    `runtime-web` (today the host must hand-inject textures); GL particle
    rendering (WP-3.5 remainder) and the GL slot renderer (WP-4.11 remainder).
17. **Editor coverage of the effects/slot command surface.** Emitter field and
    life-curve editing, layer reorder, bundles, live VFX preview; win-sequence
    and feature-flow editing, slot scene preview; MCP tools for the effects and
    slot composers (skeleton authoring is covered, these are not).

### Tier 3: production hardening (the existing Phase 5 plan)

18. Editor export pipeline: binary export action, packer settings UI, rotation
    packing, premultiplied alpha, scale variants, KTX2/UASTC + blend binning
    (WP-5.2 remainder).
19. Unity runtime (WP-5.3) and Godot runtime (WP-5.4) mirroring
    `runtime-core`, activating the native conformance jobs (WP-5.5) so all
    three runtimes gate on the same fixtures.
20. Live certified math engine transport for `RealEngineAdapter` (WP-5.8),
    mobile profiling (WP-5.6), electron-builder packaging + release pipeline
    with signing and auto-update (G5.7 / WP-5.7), reference game ship.

### Cross-cutting fixes surfaced by this audit

- Update `CLAUDE.md` status to match `docs/DEV_PLAN.md` (Phase 5 in progress).
- Land the `rig-transform-modes` fixture now that `transformMode` is in the
  solve (it needs no format bump, unlike the event/draw-order rigs).
- Decide whether the deferred deep package rename (Marionette to Armature 2D)
  happens before the first public runtime API, since the npm package names are
  about to become user-facing in Tier 2 item 16.

---

## 5. Addendum: verified deltas since the 2026-07-02 audit (recorded 2026-07-08)

Re-verified against the working tree. The following audit findings are now CLOSED:

- **Tier 1 item 1 (mesh rendering), most of it.** `runtime-web` renders mesh
  attachments (`src/scene/mesh-display.ts`; geometry built once, positions
  rewritten in place from the skinned vertices) and the editor viewport renders
  through the same `SkeletonView`. Per-slot blend modes are now assigned
  (`test/blend-assignment.test.ts`). Still open from item 1: trim offsets are
  still not applied in the region slicer (documented in
  `src/scene/region-textures.ts`), and rotated regions still throw.
- **Tier 1 items 2 and 3 (mesh tool and weights UI).** The viewport now has
  four wired tools including `mesh-tool.ts` and `weight-paint-tool.ts`
  (toolbar keys V/B/M/W), with mesh-edit and weight-paint overlays and stores.
- **Tier 1 item 7 (AnimationState).** Landed per ADR-0005:
  `runtime-core/src/skeleton/animation-state.ts` (tracks, crossfade, additive,
  queue), mirrored as `SkeletonView.syncState`, locked by four committed
  anim-state conformance fixtures.
- **Section 3.4 panel gaps, partially.** Nine panels now exist and are mounted
  (hierarchy, assets, slot, viewport, inspector, effects, animations,
  dopesheet, curve editor); the effects and slot panels expose substantially
  more than the audit's "partial" rows recorded.
- **Tier 2 item 17, the MCP half.** The MCP surface grew from 88 to 142 tools
  and now covers the effects and slot composers, plus headless render feedback
  (`render_frame` over the ADR-0006 CPU rasterizer) and deterministic atlas
  packing (`atlas.pack`, ADR-0007).
- **The CLAUDE.md staleness note in section 1** was fixed (status and repo map
  now match `docs/DEV_PLAN.md`).

Still open and unchanged in kind: format 0.3.0 (draw-order and event
timelines) and everything behind it, path and physics constraints, linked
meshes and sequences, clipping/tint-black rendering, runtime skin switching
beyond the default skin, GL particle and slot rendering, the packaged player
API and asset loader, gizmo completion (scale handle, shear, numeric entry,
multi-select), onion skinning and the graph view, import/export breadth,
atlas-texture restore on document load, the Unity and Godot runtimes, the live
engine transport, device profiling, and the release pipeline. The
`rig-transform-modes` fixture is still not in `RIG_IDS`.
