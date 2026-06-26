# Phase 1: Bone puppet

- Plan ID: PHASE-1
- Status: Plan of record, awaiting senior reviewer sign-off
- Owner: Editor core
- Predecessor gate: PHASE-0 milestone green (see Entry gate below)
- Successor: PHASE-2 (Rigging) must not start until the Phase 1 Definition of Done passes

This umbrella plan does NOT re-derive the command system, the format validator, or the conformance suite. Those are
owned by three decision-of-record cross-cutting documents. This plan references them, conforms to them, and carries a
small set of explicit, same-PR amendments to them (section 0.2). Where this plan once forked their names, IDs, error
codes, epsilon policy, or fixture design, those forks are removed. Two sources of truth is the failure mode this
revision exists to eliminate.

---

## 0. Source of authority

### 0.1 Cross-cutting decisions of record (referenced, never duplicated)

Phase 0 established the house pattern (`phase-0-foundations.md` section 3, "Cross-cutting documents, referenced not
duplicated"). Phase 1 follows it. The authoritative specs and the exact anchors this plan binds to:

| Doc | Anchors this plan binds to | What it owns (Phase 1 does not re-specify it) |
|---|---|---|
| `docs/plan/cross-cutting/command-history.md` | section 2 (identity model), section 11 (command catalog), WP-C.7 (round-trip + discovery harness), WP-C.11 (Phase 1 command rollout) | The Command/History contract, branded internal IDs, the command catalog with canonical `kind` strings and phase tags, the auto-discovery round-trip harness. |
| `docs/plan/cross-cutting/format-contract.md` | section 8.2 (`FormatErrorCode`), section 8.4 (semantic + animation check list), section 9 (content hash), WP-F.4 / WP-F.6 (the complete semantic + animation validator) | The format types, the validator, the typed error codes, the content hash and its single owner (`computeContentHash` in `packages/format`). |
| `docs/plan/cross-cutting/conformance-and-ci.md` | A.2 (rig catalog), A.3 (fixture format), A.4 (sample-spec), A.5 (tolerance policy), A.6 (generator + drift gate), B.2 (runtime-web harness), C.4 (perf/alloc technique), WP-V.0 to WP-V.4 | The conformance package, rig ids, the committed sample-spec, the single tolerance policy (`compare/tolerance.ts`), the generator, the fixtures-lock gate, the runtime-web harness, the formal perf/alloc job (WP-V.8). |

Source handoff sections remain useful background (handoff section 6 format, 7 math boundary, 8.1 commands, 8.3 viewport,
8.4 skeleton, 8.7 timeline, 8.9 atlas, 8.11 conformance, 9 roadmap), but where a cross-cutting doc and the handoff
disagree, the cross-cutting doc is the decision of record and wins. Throughout this plan, a bare "section X" means a
section of THIS plan; cross-document references are always named ("handoff section X", "format section X",
"command-history section X", "conformance A.x / WP-V.x").

### 0.2 Same-PR amendments this plan carries to the decisions of record

This Phase 1 plan cannot land without conflicts being resolved in the OWNING docs in the same PR. They are not
re-decided here; they are amendments to the owning docs, listed so the reviewer approves them together with this plan.

- AMEND-CH-1 (command-history section 11 and WP-C.10 / WP-C.11). Three docs currently give three answers for the bone
  commands `RotateBone`, `ScaleBone`, `SetBoneLength`, `RenameBone`, `DeleteBone`: section 11 tags them Phase 0,
  WP-C.10 lists only a subset, and `phase-0-foundations.md` WP-0.7 ships only `CreateBone` + `MoveBone`. DECISION:
  Phase 0 ships exactly `CreateBone` + `MoveBone` (its actual artifact and milestone: create by drag, move by gizmo,
  undo/redo, save/reload). All other bone commands are Phase 1, owned by WP-1.1. The amendment retags those five rows
  from Phase 0 to Phase 1 in section 11, reduces WP-C.10's set to `CreateBone` + `MoveBone`, and folds the five into
  WP-C.11. `phase-0-foundations.md` already ships only the two, so it needs no change.
- AMEND-CH-2 (command-history section 11). Retag `CreateSkin`, `SetDrawOrderKeyframe`, `SetEventKeyframe`,
  `DefineEvent` from Phase 1 to Phase 2 (move from WP-C.11 to WP-C.12). Rationale: the idle-loop milestone needs none
  of them, and the conformance rig that exercises events and draw-order timelines (`rig-events-draworder`) is a
  Phase 2 catalog member (conformance section E). The default skin is created at document construction, not via a
  command, so `CreateSkin` (the NAMED-skin command, paired with the Phase 2 `AddSkinAttachment`) belongs with skin
  switching in Phase 2. Add five catalog rows that Phase 1 genuinely needs and the catalog lacks: `RenameSlot`
  (`slot.rename`), `SetAtlasRef` (`atlas.set`), `SetRegionAttachmentTransform` (`attach.region.transform`),
  `DuplicateAnimation` (`anim.duplicate`, composite), `PasteKeyframes` (`kf.paste`, composite). Justifications are in
  section 8.1.
- AMEND-V-1 (conformance-and-ci.md A.2). Phase 1 introduces bezier sampling (WP-1.4, WP-1.7) and ships scale-channel
  and slot-color sampling, but A.2 currently gives `rig-2bone` "rotate on both bones, translate on root", "linear +
  stepped" coverage and states bezier first appears in `rig-ik-2bone` (a Phase 2 rig). Shipping bezier and scale solve
  with no committed fixture covering them would violate the invariant that introducing solve behavior is a reviewed,
  fixture-backed act. The amendment (a) adds a bezier-eased segment to `rig-2bone`, (b) adds a `scale` channel on the
  child bone so the multiply-onto-setup-scale path is locked, (c) changes its A.2 "Timelines exercised" cell to
  `rotate` (both) + `translate` (root) + `scale` (child) and its "Curve coverage" cell to "linear + stepped + bezier",
  and (d) updates the A.2 coverage-checklist note so `rig-2bone` (not `rig-ik-2bone`) is the first appearance of bezier.
  Slot-color sampling is locked by a `runtime-core` unit suite (WP-1.4) in Phase 1; its cross-runtime fixture-lock
  lands with the first slotted Phase 2 rig (color is a per-component lerp, the lowest cross-runtime divergence risk).
  The rig itself stays owned by conformance WP-V.1; this plan does not redefine its exact keyframes.

No amendment to `format-contract.md` is required: the complete semantic and animation validator (WP-F.4 + WP-F.6) is
scheduled to be green in the Phase 0 to Phase 1 transition (format-contract section 13), so Phase 1 consumes a finished
validator and adds only a negative corpus (section 5, WP-1.11).

### 0.3 Numeric comparison policy for this whole phase

Every numeric parity, round-trip, and reproduction assertion in this plan consumes the single tolerance source
`packages/conformance/src/compare/tolerance.ts` (conformance A.5). This plan invents NO epsilon. The relevant classes:
world translation `tx, ty` (atol 1e-4, rtol 1e-6), world basis `a, b, c, d` (atol 1e-6, rtol 1e-6), skinned/deformed
vertex (atol 1e-4, rtol 1e-6), color (atol 1e-5), and discrete quantities (draw order, attachment name, blend mode)
compared with exact equality. There is no per-runtime tolerance and no blanket `1e-6`. A blanket `1e-6` absolute on a
translation near coordinate 1e3 sits below f64 reorder noise and would be the wrong gate; the combined atol+rtol band
is the decision of record. Bit-identity across runtimes is NOT claimed anywhere in this plan (section 8.3 explains the
float-op hazards that make the A.5 band, not bit-equality, the contract).

---

## 1. Milestone (the one sentence that gates the phase)

> Rig a sprite character (bones + region attachments + a packed atlas), author a looping idle animation in the
> dopesheet, export it as a valid format document, and play that idle loop SEAMLESSLY in `runtime-web`, with the editor
> viewport and `runtime-web` agreeing on every sampled bone transform within the A.5 tolerance on a committed
> acceptance fixture.

If the acceptance script in section 11 does not pass, Phase 1 is not done. There is no partial credit.

Honesty about what this milestone proves (and does not). The editor viewport and `runtime-web` call the SAME
`sampleSkeleton` symbol from `runtime-core` (section 8.1, TASK-1.10.3). Their transform agreement therefore proves
determinism and non-perturbation across the web integration boundary, NOT cross-implementation correctness. The real
cross-implementation gate (Unity and Godot reproducing the committed fixtures) is the conformance suite and lands in
Phase 5 (conformance B.3 / B.4). Phase 1's cross-runtime contribution is the committed `rig-2bone` fixture itself,
which those runtimes must later meet without rework.

A note on "Tier 0". Other docs use informal tier shorthand (`phase-2-rigging.md` calls Phase 2 "Tier 2" and Phase 1
"Tier-0/1"). There is no formally defined tier axis. This plan drops the tier number from its title to avoid implying
one. Read "bone puppet" as the scope definition; section 4 is authoritative on scope.

---

## 2. Entry gate: Phase 0 must be green before any WP-1.x starts

Verify all of the following before opening the first Phase 1 branch. This is a checklist, not a vibe.

- [ ] `packages/format` exports the handoff section 6 types, the generated JSON Schema, and the COMPLETE validator
      (WP-F.1, WP-F.3, WP-F.4, WP-F.6 green): bone/slot/skin/atlas/constraint/animation semantic checks are already
      implemented, not deferred. (This is what lets WP-1.2 rely on `ATTACHMENT_REGION_MISSING` immediately.)
- [ ] `packages/runtime-core` has the 2x3 affine lib and the world-transform forward pass (solve order steps 1 and 4);
      the parent-rotation-transforms-child unit test passes.
- [ ] `packages/runtime-web` loads a `SkeletonDocument`, draws tapered-diamond bones and region attachments at
      setup-pose world transforms.
- [ ] Editor viewport imports `runtime-web` to render the document; pan and zoom work (Phase 0 WP-0.6).
- [ ] `DocumentModel` + `History` exist; `CreateBone` and `MoveBone` (coalescing) exist and are registered in
      `commandRegistry` (Phase 0 WP-0.7); undo/redo keybindings work.
- [ ] Save serializes to format JSON; load validates, rebuilds, and resets `History`.
- [ ] CI is green: typecheck (strict, no `any` / unjustified `as` in `format` and `runtime-core`), the boundary and
      no-Pixi lint, unit tests, and the format semver gate (conformance WP-V.9, WP-V.10, WP-V.12).

If any box is unchecked, fix Phase 0 first. Phase 1 builds directly on every one of these.

---

## 3. Non-negotiable laws this phase touches (and where)

| Law / Invariant | Where it bites in Phase 1 | Enforcing WP |
|---|---|---|
| LAW 1 Math/presentation boundary | Not exercised yet (no `SpinResult` until Phase 4). Phase 1 still keeps presentation a pure function of document + time `t`: `sampleSkeleton` is deterministic, single-period, no wall-clock and no randomness in the solve. | WP-1.4, WP-1.10 |
| LAW 2 All mutations are commands | Every bone/slot/attachment/atlas/animation/keyframe change is a `Command` executed by `History`, registered in `commandRegistry`, and covered by the WP-C.7 round-trip harness. Auto-key routes bone edits through `SetKeyframe`, never direct mutation. Internal targets are addressed by branded IDs (command-history section 2), never by name or array index. The derived content `hash` is NOT a mutation (section 5). | WP-1.1, WP-1.2, WP-1.3, WP-1.5, WP-1.8, WP-1.9 |
| LAW 3 Format is the contract | Phase 1 ships ZERO format changes. All handoff section 6 animation/atlas types already exist; the validator is already complete (WP-F.4 / WP-F.6). `formatVersion` is unchanged. Authored animations serialize the REQUIRED empty collections (`ik`, `transform`, `deform`, `drawOrder`, `events`) so they pass the validator (section 5). The exporter computes `hash` exactly once via `computeContentHash` (format section 9). | WP-1.10, WP-1.11, all |
| LAW 4 Spine legal boundary | Bone solve, dopesheet, and curve evaluation are implemented from first principles. No Spine runtime source, no Spine binary-format claims. Bezier easing uses our own fixed-segment sampling (section 8.3), deterministic within the A.5 tolerance, locked by the `rig-2bone` fixture. | WP-1.4, WP-1.7 |
| LAW 5 Phase independence, build in order | Phase 1 ends with a usable bone-puppet tool. No Phase 2 mesh/skin/IK/deform work, no named skins, no event or draw-order timelines leak in. Region attachments only. | All |
| INV runtime-core is PixiJS-free | Animation sampling lives in `runtime-core` with no renderer imports. `runtime-web` renders; it never re-implements the solve. Lint + CI grep guard (conformance WP-V.10). | WP-1.4 |
| INV Conformance generated from runtime-core | The `rig-2bone` fixture is generated from `runtime-core` by `generate.ts` and committed; regeneration is the reviewed ceremony in conformance A.6. Phase 1 lands the rig into the existing suite, it does not build a parallel one. | WP-1.12 |
| INV Editor state vs document state | Mode, active animation, playhead, transport, auto-key, and selection live in Zustand keyed by branded IDs. They are NOT in the document and are NOT undoable. | WP-1.6, WP-1.8, WP-1.9 |
| INV 60fps, no per-frame allocation | `sampleSkeleton` writes into a caller-owned pose buffer (section 8.1) and pools matrices/scratch; the render loop pools sprites. Phase-1-local allocation and frame-budget probes gate it (section 8.5); the formal conformance perf/alloc job WP-V.8 lands in Phase 2/3. | WP-1.4, WP-1.10 |
| INV No em-dashes | All copy, comments, docs in this phase. | All |

---

## 4. Scope

### 4.1 In scope

- Bone hierarchy CRUD + reparenting (cycle-safe, world-transform-stable).
- Region attachment authoring and setup-pose slot draw order (the `slots[]` array order, not an animated draw-order
  timeline).
- Atlas import + maxrects pack pipeline (trim/offset, multi-page, max page size), emitting `AtlasRef` + PNG pages.
  Rotation is DISABLED for Phase 1 (section 4.2). Background removal (`rembg`) is an import/asset-prep step, kept
  strictly out of the deterministic pack step.
- Dopesheet: tracks per bone/slot, keyframes, single/box/multi selection, drag-to-move-in-time, copy/paste, transport
  (play/pause/loop, scrub), frame/seconds display.
- Curve editor: per-keyframe bezier easing (two control points), plus `linear` and `stepped`.
- `runtime-core` animation sampling at time `t` with correct interpolation per `CurveType` across the shipped channels
  (bone `rotate/translate/scale/shear`, slot `color`), with normative loop-boundary semantics (section 8.3, TASK-1.4.7).
- Setup mode vs animation mode; auto-key (delta capture, TASK-1.8.2).
- Multiple named animations, switchable from editor state.
- `runtime-web` plays an exported animation, seamlessly looped.
- The Phase 1 conformance contribution: the `rig-2bone` rotate/translate/scale rig (now including a bezier segment)
  landed into the existing conformance suite.

### 4.2 Explicitly out of scope (deferred, do not build)

| Deferred item | Reason | Lands in |
|---|---|---|
| Meshes, skinning, weight painting | Tier 2 subsystem | Phase 2 |
| IK and transform constraints (solve + timelines) | Tier 2 | Phase 2 |
| Deform timelines | Requires meshes | Phase 2 |
| Animated `drawOrder` timeline (`SetDrawOrderKeyframe`) | Idle loops do not need it; setup-pose reorder is enough | Phase 2 (AMEND-CH-2) |
| Animated slot `attachment` swap timeline authoring | Not required for the idle milestone; the format field stays, editor authoring is deferred (the general solve still SAMPLES it, stepped, and is unit-tested in WP-1.4) | Phase 2 |
| Events: `DefineEvent`, `SetEventKeyframe`, `EventDef` authoring | No event needs in the idle milestone; `rig-events-draworder` is a Phase 2 rig | Phase 2 (AMEND-CH-2) |
| Named (non-default) skins: `CreateSkin`, `AddSkinAttachment` | Skin switching is a Phase 2 concept; the default skin is created at document construction | Phase 2 (AMEND-CH-2) |
| Atlas rotated-region packing and rotated-UV rendering | The rotated render path has no parity test yet; `allowRotation=false` in Phase 1 keeps the pack fully testable | Phase 2 (with a rotated-region render parity test) |
| Particles / VFX | Layer B | Phase 3 |
| Slot composition, `SpinResult`, math-bridge | Layer C | Phase 4 |
| Onion-skinning, ripple-edit, full graph editor | Risk control (section 12): build the minimum | Later polish pass |
| Binary export | Optimization | Phase 5 |

Anything in 4.2 appearing in a Phase 1 PR is grounds for rejection under LAW 5. Note that `runtime-core` sampling
(WP-1.4) may implement the GENERAL timeline solve (so the engine stays whole), but Phase 1 only AUTHORS bone transform
channels and slot color, and only the `rig-2bone` fixture locks cross-runtime behavior. Attachment-swap, draw-order, and
event timelines are neither authored nor cross-runtime fixture-locked until Phase 2.

---

## 5. Format posture (LAW 3)

Phase 1 consumes the already-defined handoff section 6 types and the already-complete validator. The decisions of
record:

- `formatVersion` does NOT change in Phase 1. State this in the PR description of WP-1.10.
- Types exercised for the first time at export: `Animation`, `BoneTimelines`, `SlotTimelines` (`color` only),
  `Keyframe<T>`, `CurveType`, `AtlasRef`, `AtlasPage`, `AtlasRegion`, `RegionAttachment`, and the `default` `Skin`.
- Animation serialization completeness (the format `Animation` type is TOTAL). Handoff section 6 (lines 316 to 325)
  defines `Animation` with `bones`, `slots`, `ik`, `transform`, `deform`, `drawOrder`, and `events` as NON-optional
  fields. A Phase 1 animation authors only `bones` (rotate/translate/scale/shear) and `slots.color`, but
  `CreateAnimation` and the exporter MUST still emit the empty collections the type requires:
  `ik: {}`, `transform: {}`, `deform: {}`, `drawOrder: []`, `events: []`. The already-complete validator accepts these
  empties (format section 4.x: `events` may be empty; an empty `drawOrder`, and empty `ik`/`transform`/`deform` records
  have nothing to resolve and pass). Omitting any of them fails the structural (Zod) layer with `SCHEMA_SHAPE`, so the
  empty fields are the EXPORTER's responsibility, not the validator's. WP-1.11's positive test asserts a Phase 1
  animation with exactly these empties validates with zero errors.
- The content `hash` is a DERIVED export-time field, not part of the editable `DocumentModel`. It is computed exactly
  once by `computeContentHash` (format section 9) in the exporter (WP-1.10), never mutated by a command, and never
  present in the command round-trip snapshot. The do/undo deep-equal (WP-C.7) compares `model.snapshot()`, which
  excludes `hash`; save/load identity likewise excludes it (it is recomputed on export and checked on import via
  `verifyContentHash` / `HASH_MISMATCH`). This keeps `hash` outside LAW 2 (it is not a document mutation) and outside
  the round-trip identity. There is exactly one hash owner; the atlas pipeline computes no hash (TASK-1.3.6).
- The validator is NOT extended in Phase 1. Every check Phase 1 relies on is already implemented by format-contract
  WP-F.4 (semantic) and WP-F.6 (animation), using the existing `FormatErrorCode` union (format section 8.2). The
  Phase 1 checks that matter, by their OWNED codes (format section 8.4), are:
  - `BONE_ORDER_VIOLATION`, `BONE_PARENT_MISSING`, `BONE_NO_ROOT`, `BONE_NAME_DUPLICATE` (bone graph + ordering; a
    reparent cycle surfaces on import as `BONE_ORDER_VIOLATION` or `BONE_PARENT_MISSING`, since a cycle cannot be
    topologically ordered).
  - `SLOT_NAME_DUPLICATE`, `SLOT_BONE_MISSING`, `SLOT_ATTACHMENT_MISSING`, `SKIN_DEFAULT_MISSING`, `SKIN_SLOT_UNKNOWN`.
  - `ATLAS_REGION_DUPLICATE`, `ATTACHMENT_REGION_MISSING`.
  - `ANIM_BONE_UNKNOWN`, `ANIM_SLOT_UNKNOWN`, `ANIM_TIME_ORDER`, `ANIM_TIME_RANGE`, `ANIM_DURATION`, `COLOR_RANGE`.
  - `CURVE_BEZIER_X_RANGE` for bezier `cx1, cx2` outside `[0, 1]` on import of hand-edited documents.
- Bezier control-point domain: `cx1, cx2` in `[0, 1]` is the format constraint (`CURVE_BEZIER_X_RANGE`, format section
  4.8), and it is exactly what makes the easing a single-valued function of time. Section 8.3 proves WHY (the x-curve is
  monotonic non-decreasing over that domain) so the eval is well-defined; this plan does not re-decide the constraint.
- Name uniqueness is NOT enforced at the command boundary. Per command-history section 2, internal code addresses
  entities by branded IDs and never depends on name uniqueness; rename is a single-field change. Uniqueness is a
  validator concern at the export/import boundary (`BONE_NAME_DUPLICATE`, `SLOT_NAME_DUPLICATE`). The on-disk format is
  name-keyed (handoff section 6), so validator and fixture JSON-Pointer paths legitimately use names; that is the
  boundary, not the internal model.
- Per LAW 3, any format change (even an additive field) is a deliberate, versioned, reviewed change: it bumps
  `formatVersion`, updates the validator, and regenerates all affected fixtures in the SAME PR, following the
  format-contract section 11 checklist. There is no "small additive field" shortcut. Default expectation: no format
  change happens in Phase 1.

---

## 6. Editor state additions (Zustand, ephemeral, NOT the document)

Declared here so reviewers can reject any attempt to put these in `DocumentModel`. Per command-history section 2 and
section 8, all selection is keyed by stable branded internal IDs, never by name or array index, so it survives renames,
reorders, and keyframe insert/delete. None of these (including the clipboard) is a module-level global; they live in the
editor-state Zustand store and are passed by explicit dependency, honoring no-hidden-globals.

| State | Type | Notes |
|---|---|---|
| `mode` | `'setup' \| 'animation'` | Drives whether bone edits write setup pose or keyframes. |
| `activeAnimation` | `AnimationId \| null` | Which named animation is being edited/played. Branded ID, not a name. |
| `playhead` | `number` (seconds) | Scrub/playback position. Never mutates the document. |
| `isPlaying` | `boolean` | Transport state. |
| `loop` | `boolean` | Loop toggle. |
| `workingFps` | `30 \| 60` (default 30) | Display rate only; the document stores seconds. |
| `autoKey` | `boolean` (default true in animation mode) | Whether edits create/update keyframes. |
| `boneSelection` | `BoneId[]` | Selected bones, by branded ID (command-history section 2). NOT names. |
| `keySelection` | `KeyframeId[]` | Selected keyframes, by branded `KeyframeId`. NOT `(animation, target, channel, index)`: an index goes stale the instant `SetKeyframe` / `MoveKeyframe` / `DeleteKeyframe` mutates the array. |
| `keyClipboard` | `CopiedKeyframe[]` | Copy snapshot held in the editor-state store (NOT a module global): `{ targetRef, channel, relTime, value, curve }` records captured by resolving the current `keySelection` at copy time. Paste creates NEW keyframes (new `KeyframeId`s) at an offset, so the clipboard holds values, not live IDs. |
| `dopesheetView` | `{ scrollX, zoomX, scrollY }` | Pan/zoom of the dopesheet. |

Round-trip rule: serializing then loading a document restores none of the above. `workingFps` may later persist as an
app preference (outside the document), but for Phase 1 nothing here is saved in the document. The derived content `hash`
is likewise not editor state and not in the document model (section 5). Editor-state reconciliation (pruning a selected
ID that no longer resolves after an undo) lives in editor-state, not in any command (command-history section 8).

---

## 7. Work packages

Each WP is independently verifiable, and every acceptance criterion is evaluable when its WP lands in the section 10.2
build order (no criterion silently depends on an entity or fixture built by a later WP; where a cascade grows across
WPs, each WP owns the test for the slice it introduces). Format: Goal, Laws touched, Depends on, Tasks, Deliverables,
Acceptance criteria (all testable). Command names and `kind` strings are the catalog's (command-history section 11).
Every command is registered in `commandRegistry` and is covered by the WP-C.7 round-trip + discovery harness and the
WP-C.10.4 property tests; this plan does not restate "ships with a do/undo test" per command, because the harness
discovers and tests them by construction, and the discovery guard fails CI on any unregistered command (command-history
WP-C.7 TASK-C7.2).

### WP-1.1 Bone hierarchy tools (CRUD + reparenting)

- Goal: Full bone lifecycle as commands, including cycle-safe, world-stable reparenting.
- Laws touched: LAW 2, LAW 5.
- Depends on: Phase 0 (`CreateBone`, `MoveBone`, `DocumentModel`, `History`). Carries AMEND-CH-1.
- Tasks:
  - TASK-1.1.1 Implement and register the catalog commands `RotateBone` (`bone.rotate`), `ScaleBone` (`bone.scale`),
    `SetBoneLength` (`bone.length`), `RenameBone` (`bone.rename`), `DeleteBone` (`bone.delete`), `ReparentBone`
    (`bone.reparent`), `SetBoneTransformMode` (`bone.transformMode`). All target bones by `BoneId`.
  - TASK-1.1.2 `DeleteBone` cascade memento, built INCREMENTALLY as dependent entity types come to exist: deleting a
    bone deletes its child bones (ALWAYS, available now), the slots riding deleted bones and their attachments (once
    WP-1.2 lands), and the animation tracks targeting deleted bones/slots (once WP-1.5 lands). The whole cascade is ONE
    undo step; the memento captures every removed entity for exact restore (command-history section 11 `bone.delete`
    row). Each WP owns the test for the slice it introduces: child-bone cascade here, slot/attachment cascade in WP-1.2,
    track cascade in WP-1.5. This keeps every acceptance criterion evaluable at its own build step.
  - TASK-1.1.3 `ReparentBone` cycle prevention: reject if the new parent is the bone itself or any descendant. The
    rejection is a typed editor command error (an editor-scope `DocumentError` member, surfaced to UI), produces no
    document mutation and no history entry. This is a command-level guard, NOT a `FormatErrorCode`; the import-time
    detector is the format validator's `BONE_ORDER_VIOLATION` / `BONE_PARENT_MISSING` (section 5).
  - TASK-1.1.4 `ReparentBone` world-stable local recompute: after reparenting, the bone's world transform is unchanged;
    its local transform is recomputed as `localNew = inverse(newParentWorld) * oldWorld`. The inverse-compose is a 2x3
    affine op in `runtime-core`, called from the command.
  - TASK-1.1.5 Maintain the bone-ordering invariant (parents precede children) after every create/reparent/delete via a
    stable topological order, asserted by `assertInvariants` in dev/test builds (command-history section 3.5).
  - TASK-1.1.6 `RotateBone` / `ScaleBone` / `SetBoneLength` / `MoveBone` setup-mode gizmo drags collapse to one undo
    step via the PRIMARY coalescing mechanism, explicit interaction sessions (command-history section 5.2), not the
    time-window fallback.
- Deliverables: commands + registry entries; hierarchy panel supports rename, delete, drag-to-reparent.
- Acceptance criteria:
  - [ ] Every command in TASK-1.1.1 is present in `commandRegistry` and passes the WP-C.7 generic round-trip harness
        (do/undo deep-equals prior snapshot; do/undo/redo deep-equals post-do). The discovery guard is green.
  - [ ] Reparenting bone B under its own descendant is rejected with the typed command error; `model.snapshot()` is
        deep-equal before and after the attempt, and `history.canUndo` is unchanged (no empty entry).
  - [ ] After reparenting, the bone world transform matches its pre-reparent world matrix within the A.5 basis and
        translation tolerance.
  - [ ] After any create/reparent/delete, `assertInvariants(model)` passes (parent index < child index for all bones).
  - [ ] Deleting a parent bone then undo restores its CHILD BONES (snapshot deep-equal). The slot/attachment cascade is
        asserted in WP-1.2 and the animation-track cascade in WP-1.5, when those entities exist (TASK-1.1.2).
  - [ ] A 60-step bone-rotate gizmo drag wrapped in one interaction session collapses to one undo entry.

### WP-1.2 Region attachment authoring + slot draw order

- Goal: Author slots, attach region attachments from atlas regions, and order draw.
- Laws touched: LAW 2, LAW 3 (validator already enforces attachment-path resolution).
- Depends on: WP-1.1, WP-1.3 (atlas regions to attach), and the COMPLETE validator from Phase 0 (so
  `ATTACHMENT_REGION_MISSING` is available immediately; there is no later "validator hardening" this WP waits on).
  Carries AMEND-CH-2 catalog additions (`slot.rename`, `attach.region.transform`).
- Tasks:
  - TASK-1.2.1 Implement and register `CreateSlot` (`slot.create`), `DeleteSlot` (`slot.delete`), `RenameSlot`
    (`slot.rename`), `SetSlotBlendMode` (`slot.blend`), `SetSlotColor` (`slot.color`), `ReorderSlot` (`slot.reorder`).
    `RenameSlot` is a single-field change; uniqueness is the validator's `SLOT_NAME_DUPLICATE`, not a command guard.
    `DeleteSlot` cascades its attachments now, and (once WP-1.5 lands) its slot timelines, as one undo step (the WP-1.2
    slice of the cascade memento family in TASK-1.1.2).
  - TASK-1.2.2 Implement and register `AddRegionAttachment` (`attach.region.add`), `RemoveAttachment`
    (`attach.remove`), `SetActiveAttachment` (`slot.activeAttachment`, the setup-pose active attachment),
    `SetRegionAttachmentTransform` (`attach.region.transform`: x, y, rotation, scaleX, scaleY, width, height).
  - TASK-1.2.3 `AddRegionAttachment` writes into `skins.default.attachments[slot][name]`; the attachment `path`
    references an `AtlasRegion.name`. Default width/height/offset from the region's `originalW/originalH/offsetX/offsetY`
    so trimmed sprites land pixel-correct. (The attachment NAME is the map key; `path` is the region name and may
    differ, per format section 4.4.)
  - TASK-1.2.4 Draw order: `ReorderSlot` mutates the document `slots[]` order (setup-pose draw order). The renderer
    draws in `slots[]` order; the overlay layer is excluded from the document.
  - TASK-1.2.5 Inspector UI for slot color (RGBA 0..1), blend mode, attachment transform; all edits go through commands
    and coalesce on drag via interaction sessions.
- Deliverables: slot/attachment commands + registry entries; inspector + draw-order list UI.
- Acceptance criteria:
  - [ ] All TASK-1.2.1 and TASK-1.2.2 commands are registered and pass the WP-C.7 harness.
  - [ ] Adding a region attachment whose `path` is not an atlas region fails import validation with
        `ATTACHMENT_REGION_MISSING` (negative test against the existing validator, available from Phase 0).
  - [ ] Deleting a bone that carries slots, or deleting a slot directly, cascades the slot(s) and their attachments in
        one undo step; undo restores them (snapshot deep-equal). This is the WP-1.2 slice of the cascade from TASK-1.1.2.
  - [ ] A trimmed sprite (non-zero `offsetX/offsetY`) renders at the same on-screen pixel position as its untrimmed
        original (within 1px) at identity attachment transform.
  - [ ] Reordering two slots changes render z-order in the viewport and persists through save/load.
  - [ ] Default skin lookup `slot -> attachment -> Attachment` resolves for every slot with a non-null `attachment`;
        a non-resolving setup attachment is rejected on import with `SLOT_ATTACHMENT_MISSING`.

### WP-1.3 Atlas import + pack pipeline

- Goal: Import sprites, trim, pack into pages, emit `AtlasRef` + PNGs.
- Laws touched: LAW 2 (`SetAtlasRef` is a command), LAW 3 (`AtlasRef`/`AtlasRegion` shape is the contract). Runs in
  Electron main (filesystem, optional `child_process`). Carries AMEND-CH-2 catalog addition (`atlas.set`).
- Depends on: Phase 0 filesystem plumbing.
- Tasks:
  - TASK-1.3.1 Import: read source PNGs from a project asset directory. Bounded concurrency (max 8 concurrent reads;
    never `Promise.all` an unbounded list).
  - TASK-1.3.2 Background removal is an IMPORT/ASSET-PREP step, run before and separate from packing. The default path
    consumes already-cut PNGs (alpha present). Optional `rembg` runs only at asset prep, behind `MARIONETTE_REMBG_BIN`
    (validated at boot, fail fast if requested but missing). The deterministic pack step (TASK-1.3.4) must NEVER shell
    out, so pack determinism never depends on an external binary's version.
  - TASK-1.3.3 Trim: compute the alpha bounding box per sprite; store `offsetX`, `offsetY`, `originalW`, `originalH`,
    and the trimmed `w/h`.
  - TASK-1.3.4 Pack: `maxrects-packer` with configurable max page size (default 2048, allow 4096), padding (default
    2px), and `allowRotation=false` for Phase 1. Multiple pages when content exceeds one page. The `AtlasRegion.rotated`
    field stays in the format but Phase 1 packing never sets it true, because the rotated-UV RENDER path has no parity
    test yet (deferred to Phase 2, section 4.2). Deterministic packing (fixed sort key, area-descending then name-
    ascending, plus fixed seed) so re-export of unchanged input yields IDENTICAL `AtlasRef` coordinates and identical
    DECODED page pixels. Determinism is asserted on (a) exact equality of the `AtlasRef` (region coordinates, offsets,
    page assignment) and (b) a hash of the DECODED page pixels, NOT on byte-identical PNG files: PNG byte-identity
    depends on the zlib/libpng encoder version and OS and is not a guarantee this plan relies on.
  - TASK-1.3.5 Emit: write one PNG per page to the project atlas directory; build the `AtlasRef` (`pages[].file`,
    `width`, `height`, `regions[]` with `name`, `x`, `y`, `w`, `h`, `rotated` (always false in Phase 1), `offsetX`,
    `offsetY`, `originalW`, `originalH`).
  - TASK-1.3.6 `SetAtlasRef` (`atlas.set`) sets the document `atlas` field. This is the only document mutation in the
    pipeline; the PNG files are a filesystem side effect referenced by `file`. The command does NOT compute any content
    hash (the single hash owner is the exporter, WP-1.10).
- Deliverables: main-process atlas service; renderer-side import command + progress UI; `SetAtlasRef` command + registry
  entry.
- Acceptance criteria:
  - [ ] Packing N sprites that fit in one 2048 page yields 1 page; forcing a small max page size yields multiple pages
        with no region overlap (assert pairwise non-overlap per page).
  - [ ] Each emitted `AtlasRegion` round-trips: cropping the page PNG at `(x,y,w,h)` (no rotation in Phase 1) reproduces
        the trimmed source bitmap (decoded-pixel-hash-equal). This is the WP-1.3-local check that conformance C.2 /
        WP-V.7 (atlas pack round-trip, UVs within 1px) later formalizes.
  - [ ] Re-running the pack on identical inputs produces identical `AtlasRef` coordinates and an identical decoded-pixel
        hash per page (NOT byte-identical PNGs; see TASK-1.3.4), with no dependency on `rembg` (it is not invoked in the
        pack step).
  - [ ] `SetAtlasRef` is registered and passes the WP-C.7 harness.
  - [ ] Import of 200 sprites never exceeds the concurrency cap (assert max in-flight <= 8 via instrumentation).
  - [ ] With `rembg` requested but the binary absent, asset prep fails fast with a typed error at boot, not mid-import,
        and the pack step is never reached.

### WP-1.4 runtime-core animation sampling

- Goal: Deterministic timeline sampling at time `t` with correct per-`CurveType` interpolation across all shipped
  channels, PixiJS-free, writing into a caller-owned pose buffer, with normative single-period loop semantics.
- Laws touched: LAW 1 (deterministic), LAW 3 (reads format types only), LAW 4 (our own bezier eval), INV runtime-core
  renderer-free, INV no per-frame allocation.
- Depends on: Phase 0 world-transform pass.
- Tasks:
  - TASK-1.4.1 Timeline lookup: binary search for the segment bracketing `t`. Clamp WITHIN the period: `t <= firstKey.time`
    returns the first value; `t >= lastKey.time` returns the last value. The sampler does not wrap (looping is the
    transport's job, TASK-1.4.7).
  - TASK-1.4.2 Curve evaluation per `CurveType`: `linear` lerps across the segment; `stepped` holds the segment-start
    value until the next keyframe; `bezier` uses fixed-segment sampling (section 8.3). The bezier curve is the easing
    from this keyframe to the next, with implicit endpoints `(0,0)` and `(1,1)` and control points `(cx1,cy1)`,
    `(cx2,cy2)`.
  - TASK-1.4.3 Channel application onto the reset setup pose, the single normative rule that auto-key (WP-1.8) must
    round-trip through: `rotate` ADDS angle to setup rotation, `translate` ADDS x/y to setup translation, `scale`
    MULTIPLIES setup scale (componentwise), `shear` ADDS to setup shear. Slot `color` REPLACES setup color, interpolating
    (per-component RGBA lerp) across the segment per the segment's curve. The general solve also samples slot
    `attachment` (stepped: hold the active attachment until the next key); Phase 1 does not AUTHOR attachment-swap
    timelines (section 4.2) but DOES unit-test this stepped sampling so the shipped code path is covered. Draw-order and
    event timeline application exist in the general solve for Phase 2; Phase 1 neither authors nor fixture-locks them.
  - TASK-1.4.4 Sampling entry point and output contract:
    `sampleSkeleton(doc, animationId, t, outPose: Pose): void`. It writes the solved pose (per-bone local and world
    2x3 affines, per-slot resolved color and active attachment) into the CALLER-OWNED `outPose` buffer and returns
    nothing. It implements the LOCKED solve order, with the constraint stage present as an explicit named step:
    (1) reset to setup pose, (2) apply animation timelines, (3) solve constraints (an EXPLICIT no-op stage in Phase 1,
    kept as a named pipeline step so Phase 2 inserts IK-then-transform exactly here without reordering the locked
    solve), (4) world transforms (single forward pass, parents before children). Steps 5 and 6 (skin/deform, render) are
    not in `runtime-core` for Phase 1 (5 is Phase 2, 6 is the renderer). This resolves the zero-alloc vs referential-
    transparency tension: the function allocates nothing per call (it fills a reused buffer), and the determinism test
    CLONES `outPose` after each call before comparing, so the comparison is meaningful rather than vacuous.
  - TASK-1.4.5 Object pooling: reuse matrix and pose scratch across frames; zero heap allocation inside
    `sampleSkeleton` after warmup (the section 8.5 allocation probe).
  - TASK-1.4.6 Bezier precompute (the LAW 4 design, section 8.3): when a `Keyframe.curve` is bezier, sample the cubic
    at `BEZIER_SEGMENTS` (= 10) equal-parameter `s` steps into `(x,y)` pairs once on load/build, cached on the
    SOLVE-SIDE keyframe representation (NOT serialized into the document). At sample time, bracket by x (monotonic by
    section 8.3) with the documented deterministic tie-break, and linearly interpolate y. This is deterministic and
    avoids iterative root-finding divergence; it is NOT claimed bit-identical across runtimes (see section 8.3 and the
    A.5 tolerance).
  - TASK-1.4.7 Loop boundary semantics (normative, this is a LOOP milestone). `sampleSkeleton` is a pure SINGLE-PERIOD
    function on `[0, duration]` with clamp (TASK-1.4.1); it does NOT wrap. Looping is the transport's job (TASK-1.6.6):
    it maps elapsed time to `t' = ((elapsed % duration) + duration) % duration` and calls
    `sampleSkeleton(doc, anim, t')`. There is NO wrap-interpolation between the last and first keyframe, which keeps the
    locked solve and the conformance fixtures single-period. A SEAMLESS loop therefore REQUIRES MATCHED ENDPOINTS: for
    every authored channel, the first-keyframe value equals the last-keyframe value (with clamp, `pose(0)` is the
    first-key value and `pose(duration)` is the last-key value, so `pose(0) == pose(duration)` iff endpoints match). The
    editor surfaces a non-blocking "loop endpoints differ" advisory (WP-1.6) when any channel's first and last keyframe
    values differ, so a pop is the author's informed choice, not a silent defect. The `idle-sprite` acceptance rig
    (section 8.4) is authored with matched endpoints, and the DoD adds a seamless-loop assertion (section 11.2) that
    `pose(0)` and `pose(duration)` agree within the A.5 tolerance. No-drift alone (TASK-1.13.3) does not prove
    pop-free; this assertion does.
- Deliverables: `runtime-core` sampling module + unit tests; exported `sampleSkeleton`, the `Pose` buffer type, and the
  `BEZIER_SEGMENTS` constant.
- Acceptance criteria:
  - [ ] Unit tests cover EVERY shipped channel and curve type, including clamp-before-first and clamp-after-last: bone
        `rotate` (add), `translate` (add), `scale` (multiply), `shear` (add) with `linear`, `stepped`, and `bezier`;
        slot `color` (per-component RGBA lerp, replacing setup, linear and stepped); and slot `attachment` (stepped
        replace). This is the `runtime-core` timeline-sampling suite (conformance C.1 hosts it).
  - [ ] A flat-spot bezier (for example `cx1=1, cx2=0`, whose x-curve is monotonic with a zero-slope inflection at
        `s=0.5`) evaluates deterministically (the tie-break in section 8.3), never `NaN`, and never depends on iteration
        order; the build-time assertion that the sampled x table is non-decreasing passes.
  - [ ] `sampleSkeleton` produces zero heap allocations per call after warmup (section 8.5 allocation probe).
  - [ ] No import of `pixi.js` or any renderer package in `runtime-core` (lint boundary + CI grep guard).
  - [ ] Bezier and scale eval reproduce the committed `rig-2bone` fixture (WP-1.12, AMEND-V-1) within the A.5 tolerance.
  - [ ] Determinism: for 1000 repeated calls with identical `(doc, animationId, t)`, each CLONE of `outPose` is
        deep-equal to the first (LAW 1). The test clones before comparing.
  - [ ] For a rig with matched first/last keyframe values per channel, `sampleSkeleton` at `t=0` and `t=duration` agree
        within the A.5 tolerance (the seamless-loop precondition, TASK-1.4.7).

### WP-1.5 Animation and keyframe commands

- Goal: All animation-data mutations as commands, by branded ID, emitting format-complete animations.
- Laws touched: LAW 2, LAW 3 (animation serialization completeness).
- Depends on: WP-1.4 (sampling defines value semantics), WP-1.1/1.2 (targets). Carries AMEND-CH-2 catalog additions
  (`anim.duplicate`, `kf.paste`).
- Tasks:
  - TASK-1.5.1 Implement and register `CreateAnimation` (`anim.create`), `DeleteAnimation` (`anim.delete`),
    `RenameAnimation` (`anim.rename`, single-field; no duplicate-name guard at the command, per section 5),
    `SetAnimationDuration` (`anim.duration`). `CreateAnimation` initializes the animation with the REQUIRED empty
    collections `ik: {}`, `transform: {}`, `deform: {}`, `drawOrder: []`, `events: []` plus empty `bones: {}` and
    `slots: {}` (section 5), so the animation is format-valid the instant it exists and on export.
  - TASK-1.5.2 Implement and register `SetKeyframe` (`kf.set`, the single insert-or-update command: inserting at a new
    time inserts, editing at an existing time updates that keyframe by `KeyframeId`), `MoveKeyframe` (`kf.move`, changes
    time), `DeleteKeyframe` (`kf.delete`), `SetCurve` (`kf.curve`, linear/stepped/bezier + control points). There is no
    separate "InsertKeyframe" and "UpdateKeyframeValue"; the catalog defines one `SetKeyframe`.
  - TASK-1.5.3 Composite `DuplicateAnimation` (`anim.duplicate`) and `PasteKeyframes` (`kf.paste`) as
    `CompositeCommand`s over catalog primitives (command-history section 4.3): duplicate is `CreateAnimation` plus
    `SetKeyframe`/`SetCurve` children; paste is `SetKeyframe` children inserted at an offset time. Each pushes exactly
    one undo step and is registered with its own `CommandSpec`.
  - TASK-1.5.4 `SetKeyframe` keeps each channel array strictly time-sorted; inserting at an existing time updates that
    keyframe (the auto-key path, WP-1.8).
  - TASK-1.5.5 `MoveKeyframe` and `SetCurve` (control-point drag) coalesce within an interaction session (one drag =
    one undo step), per command-history section 6.
  - TASK-1.5.6 `SetAnimationDuration` rejects shrinking below the last keyframe time with a typed editor command error
    (no mutation). The format validator independently enforces `ANIM_DURATION` on import; the command guard is the
    author-time equivalent, not a re-coding of the format check.
  - TASK-1.5.7 `DeleteAnimation`, `DeleteBone`, and `DeleteSlot` together close the cascade family: removing a bone or
    slot removes the animation tracks targeting it as part of the same single-undo cascade (the WP-1.5 slice of
    TASK-1.1.2). The memento captures the removed tracks for exact restore.
- Deliverables: commands + registry entries.
- Acceptance criteria:
  - [ ] All TASK-1.5.1 to TASK-1.5.3 commands are registered and pass the WP-C.7 harness (composites included; composite
        reversal verified by the harness, command-history WP-C.7 TASK-C7.6).
  - [ ] A freshly created animation serializes with `ik: {}`, `transform: {}`, `deform: {}`, `drawOrder: []`,
        `events: []` and validates with zero errors (the format-completeness positive test; section 5).
  - [ ] After any `SetKeyframe`/`MoveKeyframe`/`DeleteKeyframe`, the target channel array is strictly increasing in
        `time` (assert).
  - [ ] `PasteKeyframes` then undo removes exactly the pasted keyframes and restores any overwritten ones (snapshot
        deep-equal).
  - [ ] Deleting a bone or slot that has animation tracks removes those tracks in the same single-undo cascade; undo
        restores them (snapshot deep-equal). This is the WP-1.5 slice of the cascade from TASK-1.1.2.
  - [ ] A 40-step control-point drag wrapped in one session collapses to one undo entry.
  - [ ] `RenameAnimation` is a pure document command (single field); any active-animation editor-state fixup happens in
        editor-state via selection reconciliation, never inside the command.

### WP-1.6 Dopesheet panel

- Goal: The minimum viable dopesheet: tracks, keyframes, selection, drag-to-move, copy/paste, transport, loop.
- Laws touched: INV editor state vs document state (selection, playhead, transport are Zustand, keyed by branded IDs),
  LAW 2 (edits go through WP-1.5 commands).
- Depends on: WP-1.5.
- Tasks:
  - TASK-1.6.1 Track tree: one row group per animated bone and slot, child rows per channel
    (rotate/translate/scale/shear; slot color). Rows derive from the active animation's timelines.
  - TASK-1.6.2 Keyframe rendering: diamonds at `time` mapped through `dopesheetView`. Hit testing with pixel tolerance.
  - TASK-1.6.3 Selection: single click, shift-click multi, box (marquee) select. Selection is `keySelection`
    (`KeyframeId[]` in Zustand), never in the document.
  - TASK-1.6.4 Drag-to-move-in-time: dragging selected keyframes issues `MoveKeyframe` inside one interaction session;
    snap to frame at `workingFps` with a modifier to disable snapping.
  - TASK-1.6.5 Copy/paste: copy resolves `keySelection` to `keyClipboard` value records (editor-state store, not a
    global); paste at the playhead via `PasteKeyframes`.
  - TASK-1.6.6 Transport: play/pause/loop, scrub by dragging the playhead. Playback advances `playhead` from a
    monotonic clock and, when `loop` is on, maps it to `t' = ((elapsed % duration) + duration) % duration`
    (TASK-1.4.7), then calls `sampleSkeleton` per frame into a reused pose buffer; it does NOT mutate the document.
    (LAW 1: the solve stays a pure single-period function of `(doc, animationId, t')`; the clock only drives `t`.) Show
    the non-blocking "loop endpoints differ" advisory when the active animation has any channel whose first and last
    keyframe values differ (TASK-1.4.7).
  - TASK-1.6.7 Display: a frame/seconds readout. Default `workingFps` = 30 (60 selectable). Times are stored in
    seconds; the frame display is `round(t * fps)`.
  - TASK-1.6.8 Performance: keyframe rendering and hit-testing are virtualized over the visible range; no per-frame
    allocation during playback.
- Deliverables: dopesheet React panel (dockview), transport bar, Zustand wiring.
- Acceptance criteria:
  - [ ] Box-select captures exactly the keyframes whose screen rect intersects the marquee (unit test on the hit-test
        function), resolving to the correct `KeyframeId` set.
  - [ ] Dragging 3 selected keyframes by +0.5s moves all three and produces one undo entry; undo restores all three.
  - [ ] Copy two keyframes, move the playhead to 1.0s, paste: two keyframes appear at `original + 1.0s`, single undo.
  - [ ] Scrubbing the playhead never creates a history entry (assert `history` length unchanged across a scrub).
  - [ ] The "loop endpoints differ" advisory appears for an animation whose first/last keyframe values differ on some
        channel and is absent when all channels match (unit test on the advisory predicate).
  - [ ] Playback holds the frame budget on a representative synthetic in-test animation (section 8.5 frame-budget probe;
        this WP does NOT use the `idle-sprite` rig, which is built in WP-1.13, nor the Phase 2/3 WP-V.8 job).
  - [ ] The frame readout at `workingFps=30` shows frame 15 at `t=0.5s` and frame 30 at `t=1.0s`.

### WP-1.7 Curve editor (bezier / linear / stepped)

- Goal: Per-keyframe easing authoring matching `runtime-core` evaluation exactly.
- Laws touched: LAW 4 (our bezier), LAW 2 (`SetCurve`).
- Depends on: WP-1.4, WP-1.5, WP-1.6.
- Tasks:
  - TASK-1.7.1 Curve type selector per selected keyframe: `linear`, `stepped`, `bezier`.
  - TASK-1.7.2 Bezier control-point editor: drag two handles in a normalized `[0,1]` x panel (y unclamped); writes
    `SetCurve` with `cx1,cy1,cx2,cy2`, x CLAMPED to `[0,1]` at this author-time command, coalesced in one session. The
    author-time clamp and the import-time reject are two distinct enforcement points: the command clamps so an artist
    cannot drag x out of range, and the format validator rejects a hand-edited document whose `cx1`/`cx2` are out of
    `[0,1]` with `CURVE_BEZIER_X_RANGE` (format section 4.8). Both are stated so neither is mistaken for the other.
  - TASK-1.7.3 The editor preview curve renders from the SAME `BEZIER_SEGMENTS` sampling as `runtime-core` (one shared
    function), so what the animator sees equals what the runtime plays.
  - TASK-1.7.4 Presets: linear, ease-in, ease-out, ease-in-out as one-click control-point sets.
- Deliverables: curve editor panel; preset buttons.
- Acceptance criteria:
  - [ ] The editor preview curve and `runtime-core` evaluation agree at 100 sample points within the A.5 tolerance
        (shared sampling function; a test imports both).
  - [ ] Switching a keyframe linear -> bezier -> stepped -> linear and undoing four times returns the document to a
        deep-equal start snapshot.
  - [ ] `stepped` between two rotate keyframes holds the start angle until the next keyframe exactly (no interpolation),
        verified by sampling at the midpoint.
  - [ ] `SetCurve` clamps bezier x to `[0,1]` at author time (command test), and a hand-edited document with
        `cx > 1` is rejected on import with `CURVE_BEZIER_X_RANGE` (validator test).

### WP-1.8 Setup mode vs animation mode + auto-key

- Goal: The mode distinction and the auto-key workflow, with a single edit dispatcher.
- Laws touched: LAW 2 (auto-key uses keyframe commands, never direct mutation), INV editor state (mode/auto-key in
  Zustand).
- Depends on: WP-1.1, WP-1.5, WP-1.6.
- Tasks:
  - TASK-1.8.1 Mode switch in editor state. In `setup` mode, bone transform edits issue setup-pose commands
    (`RotateBone`, `MoveBone`, `ScaleBone`, ...). In `animation` mode with `autoKey` on, the SAME gizmo edit instead
    issues `SetKeyframe` at the `playhead` on the matching channel.
  - TASK-1.8.2 Auto-key value capture (must round-trip through TASK-1.4.3). Because sampling ADDS rotate/translate/shear
    onto setup and MULTIPLIES scale, the stored keyframe value is the DELTA from setup that reproduces the gizmo pose,
    NOT the absolute local value (storing the absolute local value would double-apply setup for any non-identity setup
    pose, for example the idle torso's non-zero setup rotation, so the playhead pose would not match the gizmo):
    - rotate: `angle = desiredLocalRotation - setupRotation`
    - translate: `(x, y) = desiredLocal - setupTranslation`
    - scale: `(sx, sy) = desiredLocalScale / setupScale` componentwise (setup scale is nonzero by construction)
    - shear: `(shx, shy) = desiredLocalShear - setupShear`
    Sampling at `playhead` then reproduces the gizmo pose exactly within the A.5 tolerance. This is the same delta rule
    TASK-1.4.3 applies in reverse; the two are specified to be inverses so the spec is unambiguous and the WP-1.8
    acceptance does not rely on a test author guessing.
  - TASK-1.8.3 Insert vs update: `SetKeyframe` updates the keyframe if one exists at `playhead` on that channel, else
    inserts. A drag is one coalesced undo step (one session).
  - TASK-1.8.4 Mode is visually unmistakable (viewport tint/banner + dopesheet enabled only in animation mode). Editing
    in animation mode with `autoKey` off shows a "not keying" indicator and makes no keyframe.
  - TASK-1.8.5 There is exactly ONE edit dispatcher that selects the command set by `mode`. No other code path mutates
    setup pose while in animation mode (verified by a boundary test that the dispatcher is the sole caller of bone
    setup-transform commands).
- Deliverables: mode toggle, edit dispatcher, auto-key indicator.
- Acceptance criteria:
  - [ ] In animation mode at `t=0.5s`, rotating a bone whose setup rotation is non-zero creates exactly one `SetKeyframe`
        on the rotate channel at `0.5s` whose stored angle is `desiredLocalRotation - setupRotation`; `sampleSkeleton`
        at `0.5s` reproduces the gizmo pose within the A.5 tolerance.
  - [ ] Editing the same bone again at the same `t` updates (does not duplicate) the keyframe.
  - [ ] In setup mode, the identical gizmo action edits the setup pose and creates no keyframe (assert the active
        animation snapshot is unchanged).
  - [ ] With `autoKey` off in animation mode, a gizmo drag produces no document mutation (history length unchanged).
  - [ ] The edit dispatcher is the only caller of bone setup-transform commands (grep/boundary test).

### WP-1.9 Multiple named animations

- Goal: Manage and switch among named animations from editor state, by `AnimationId`.
- Laws touched: LAW 2 (animation CRUD commands), INV editor state (`activeAnimation` is Zustand).
- Depends on: WP-1.5, WP-1.6.
- Tasks:
  - TASK-1.9.1 Animation list UI: create, rename, delete, duplicate. Create/rename/delete map to WP-1.5 primitives;
    duplicate maps to the `DuplicateAnimation` composite.
  - TASK-1.9.2 Switching `activeAnimation` resets `playhead` to 0 and re-samples; it is editor state, not a document
    mutation.
  - TASK-1.9.3 Deleting the active animation selects the next available (or null) in editor state AFTER the document
    command commits, via selection reconciliation (command-history section 8), not inside the command.
  - TASK-1.9.4 Names need not be unique at author time (rename is a single-field change). Uniqueness is enforced at the
    boundary: the format validator rejects duplicate animation keys on export/import. The UI may warn, but it does not
    block the command.
- Deliverables: animation manager panel.
- Acceptance criteria:
  - [ ] Creating "idle" and "win", switching between them, shows the correct tracks for each (`activeAnimation` keyed by
        `AnimationId`, stable across a rename).
  - [ ] Switching animations never writes to history (assert history length stable).
  - [ ] `DuplicateAnimation` of "idle" yields an animation whose timelines are deep-equal to the source except identity
        and name; undo removes it cleanly (harness-covered composite).
  - [ ] Renaming one animation to an existing name does not corrupt selection (selection keyed by `AnimationId`); the
        duplicate name is surfaced by the validator at export, not by a command throw.

### WP-1.10 runtime-web animated playback + export

- Goal: Export a full animated document and play it in `runtime-web`, reusing `runtime-core` for the solve.
- Laws touched: LAW 1 (deterministic playback), LAW 3 (export writes the contract, hash computed by the format owner),
  INV runtime-core reused.
- Depends on: WP-1.3, WP-1.4, all authoring WPs.
- Tasks:
  - TASK-1.10.1 Export pipeline (the single place the content hash is computed): serialize `DocumentModel` to format
    JSON, ensure the atlas (WP-1.3) and all animations are final and carry their required empty collections (section 5),
    then compute `hash` exactly once via `computeContentHash` from `packages/format` over the WHOLE final document, set
    LAST (format section 9.2 / 9.3), then run `validateDocument` against the schema + semantic + animation + hash layers
    before writing (fail loudly). The atlas pipeline (WP-1.3) does NOT compute any hash; hashing an incomplete document
    is wrong by construction.
  - TASK-1.10.2 `runtime-web` player: load the exported JSON + atlas PNGs, build region sprites, and per frame call
    `runtime-core.sampleSkeleton` into a reused pose buffer, then render in `slots[]` draw order with per-slot blend
    mode and color. Loop via the transport mapping (TASK-1.4.7).
  - TASK-1.10.3 The editor viewport and `runtime-web` import and call the IDENTICAL `sampleSkeleton` symbol and the
    identical region-placement math (one shared code path). The viewport adds overlays only.
  - TASK-1.10.4 Headless playback harness: a Node/Vitest entry that loads an exported document and samples bone
    transforms at a committed time list (for the determinism/parity assertion in WP-1.13), plus an offscreen-canvas
    render path used only by the advisory visual check (TASK-1.13.4). The advisory render path uses the Electron
    renderer in offscreen mode (or a headless WebGL context such as `gl`) and is NON-gating, so its CI stability is not
    a phase risk.
  - TASK-1.10.5 Object pooling for sprites/matrices in the player; no per-frame allocation.
- Deliverables: exporter; `runtime-web` player; headless harness. This is the editor-to-runtime contract of
  conformance C.2 / WP-V.7 (exporter -> runtime-web playback), distinct from cross-runtime conformance.
- Acceptance criteria:
  - [ ] The exported document passes `validateDocument` (schema + semantic + animation + hash); a deliberately
        corrupted export fails loudly (negative test).
  - [ ] `verifyContentHash(exported) === true`, and the hash is computed only in the exporter (a grep test asserts no
        `computeContentHash` call in the atlas pipeline).
  - [ ] `runtime-web` loads the exported idle and loops it without drift over 10 loops (sampled transforms deep-equal at
        loop boundaries) AND seamlessly (`pose(0)` and `pose(duration)` agree within the A.5 tolerance, TASK-1.4.7).
  - [ ] The editor viewport and `runtime-web` call the same `sampleSkeleton` symbol (import-graph assertion).
  - [ ] The player holds the frame budget on an exported `rig-2bone` animation (section 8.5 frame-budget probe; the
        `idle-sprite` rig is reserved for WP-1.13).
  - [ ] No per-frame heap allocation in the player after warmup (section 8.5 allocation probe).

### WP-1.11 Validator enablement + negative corpus for Phase 1 content

- Goal: Prove the ALREADY-COMPLETE validator (format WP-F.4 / WP-F.6) catches every Phase 1 malformation, and commit a
  negative corpus. This WP adds NO new checks and NO new error codes.
- Laws touched: LAW 3.
- Depends on: WP-1.2, WP-1.3, WP-1.5 (to produce realistic malformed documents). The validator itself is a Phase 0
  deliverable.
- Tasks:
  - TASK-1.11.1 Wire the editor import handler to surface `validateDocument` reports as typed, path-bearing errors in
    the UI (JSON Pointer paths such as `/animations/idle/bones/root/rotate/2/time`). Log once at the boundary
    (format-contract section 8.2), never per check.
  - TASK-1.11.2 Commit a Phase 1 negative corpus under `packages/format/test/fixtures/invalid/`, one document per
    Phase-1-relevant `FormatErrorCode` (section 5 list), each invalid by exactly ONE fault. This extends the corpus
    that format WP-F.10 already owns; it does not fork the validator.
  - TASK-1.11.3 Commit one POSITIVE fixture: a Phase 1 animation carrying the required empty collections
    (`ik`/`transform`/`deform`/`drawOrder`/`events`) that validates with zero errors (the section 5 completeness check).
- Deliverables: import-handler error surfacing + the Phase 1 slice of the negative corpus + the positive completeness
  fixture.
- Acceptance criteria:
  - [ ] Each Phase-1 malformation in the corpus is rejected with its expected single `FormatErrorCode` and correct
        JSON Pointer path (table-driven test, reusing format WP-F.10's corpus runner).
  - [ ] A valid Phase 1 document (the acceptance rig) passes with zero errors and zero warnings, INCLUDING an animation
        that authors only `bones`/`slots.color` but serializes the required empty collections.
  - [ ] No type changes to handoff section 6 and no new `FormatErrorCode` members (assert against the committed union);
        `formatVersion` unchanged.

### WP-1.12 Conformance contribution: land the `rig-2bone` Phase 1 fixture

- Goal: Land the first animation-sampling rig into the EXISTING conformance suite, generated from `runtime-core`, and
  validate the first generation against an independent analytic oracle. This WP references the conformance plan; it does
  not reinvent the generator, the lock, the gate, or the harness.
- Laws touched: INV conformance generated from runtime-core, LAW 4 (our bezier locked here). Carries AMEND-V-1.
- Depends on: WP-1.4, and conformance WP-V.0 (package skeleton, schemas, compare API).
- Tasks:
  - TASK-1.12.1 Author/extend `packages/conformance/src/rigs/rig-2bone.json` per conformance A.2 (root + child, rotate
    on both bones, translate on root) and, per AMEND-V-1, ADD a bezier-eased segment and a `scale` channel on the child
    bone so the rig covers rotate (add) + translate (add) + scale (multiply) and curves linear + stepped + bezier. The
    rig is a valid `SkeletonDocument` and passes the format validator (conformance WP-V.1).
  - TASK-1.12.2 Commit `packages/conformance/src/sample-spec/rig-2bone.sample-spec.json` (conformance A.4): the
    `poseTimes` (a mix of exact keyframe times, between-key times that exercise interpolation and bezier, and one time
    past `duration` to pin clamp) read identically by every runtime. Sample times live ONLY here; this plan does not
    embed them inline (so section 8.2 and section 11.2 cannot drift from the spec).
  - TASK-1.12.3 Generate fixtures via the EXISTING `generate.ts` (conformance A.6): it imports `runtime-core` + `format`
    only, runs the canonical solve at the sample-spec times, and writes
    `packages/conformance/src/fixtures/rig-2bone.fixture.json` plus updates `.fixtures.lock`. The fixture stores ONLY
    the canonical raw affine `[a,b,c,d,tx,ty]` per bone in document order (tip/world data ONLY as the affine), per
    conformance A.3. It does NOT store decomposed local rotation or a separately computed tip position; decomposition
    is forbidden because `atan2`/`acos` differ across language math libs.
  - TASK-1.12.4 The verification harness is the EXISTING runtime-web harness (conformance B.2 / WP-V.4): it drives the
    `runtime-web` playback path (not `runtime-core` directly) so it catches web-integration drift, and compares to the
    committed fixture via `compare.ts` + `tolerance.ts` (A.5). The drift guard is the EXISTING fixtures-lock CI step
    (`generate` then `git diff --exit-code`) plus the A.6 regeneration ceremony (`behavior-change` label, CODEOWNERS on
    `fixtures/**`, ADR). There is no new per-rig `pnpm` gate.
  - TASK-1.12.5 Independent analytic oracle (addresses fixture self-reference). Commit a small Phase 1 oracle test in
    `packages/conformance` that, on first generation, asserts the generated `rig-2bone` affines match HAND-COMPUTED
    closed-form values at 2 to 3 anchor times within the A.5 tolerance, so the fixture is validated against an
    independent source rather than merely frozen. Worked anchors (root at origin, child offset 100 along the root's
    +x in root-local at setup):
    - At a time where the root local rotation reaches exactly +90deg and the child adds 0, the child's WORLD basis is a
      pure +90deg rotation and the child tip world position is `root_tip + R(90)*(100,0) = (0,100) + (0,100) = (0,200)`.
    - At a time where the root reaches +90deg and the child reaches +90deg (local), the child world rotation is +180deg
      and its tip is `(0,100) + R(180)*(100,0) = (0,100) + (-100,0) = (-100,100)`.
    - At `t=0` (setup, both rotations 0) the child tip world position is `(200,0)`.
    These are computed without the solver and assert against the generated affine; a mismatch means the FIRST generation
    is wrong, not merely different.
- Deliverables: `rig-2bone.json`, `rig-2bone.sample-spec.json`, the generated `rig-2bone.fixture.json`, the updated
  `.fixtures.lock`, the analytic anchor test, and the AMEND-V-1 edit to conformance A.2. No new generator, no new harness.
- Acceptance criteria:
  - [ ] The runtime-web conformance harness (WP-V.4) reproduces `rig-2bone.fixture.json` within the A.5 tolerance for
        every sample-spec time, including the past-`duration` clamp sample.
  - [ ] linear, stepped, AND bezier segments and the scale (multiply) path are all exercised by the sample-spec
        (AMEND-V-1), and the A.2 coverage checklist meta-test passes with `rig-2bone` as the first bezier appearance.
  - [ ] The analytic anchor test passes against the generated fixture at all anchor times (independent oracle,
        TASK-1.12.5).
  - [ ] Changing `runtime-core` solve behavior without regenerating fixtures fails the existing fixtures-lock CI step
        (drift guard); regeneration follows the A.6 ceremony.
  - [ ] The fixture stores only raw affines (no decomposed rotation, no separate tip field) and validates against
        `fixture.schema.json`.

### WP-1.13 Phase 1 Definition-of-Done acceptance harness

- Goal: Automate the milestone proof: the editor and `runtime-web` agree (within A.5) on the idle loop sampled from an
  exported document, and the loop is seamless.
- Laws touched: LAW 1 (agreement is the proof of determinism and non-perturbation, not of cross-implementation
  correctness; see section 1).
- Depends on: WP-1.10 (export + player; this WP hard-depends on it), and all prior authoring WPs.
- Tasks:
  - TASK-1.13.1 Commit the acceptance rig under `packages/conformance/assets/idle-sprite/` (the rig JSON + its source
    sprites + the deterministic packed atlas + a committed sample-time list `idle-sprite.sample-list.json`), specified
    exactly in section 8.4, following the precedent of committing DoD rigs under `packages/conformance/assets/`.
  - TASK-1.13.2 Transform agreement step: sample `idle` at the committed sample-time list in BOTH the editor's
    `runtime-core` path and `runtime-web`'s playback path; assert every bone world affine and the derived tip position
    agree within the A.5 tolerance (consume `tolerance.ts`). This is determinism + non-perturbation across the web
    boundary, since both call the same `sampleSkeleton` symbol.
  - TASK-1.13.3 Loop-stability step: sample across 10 loop iterations; assert values at each loop boundary are
    deep-equal (no drift).
  - TASK-1.13.4 Seamless-loop step: assert `pose(0)` and `pose(duration)` agree within the A.5 tolerance (the idle rig
    is authored with matched endpoints, section 8.4, TASK-1.4.7). This is the pop-free guarantee that no-drift alone
    does not provide.
  - TASK-1.13.5 Advisory visual check (NON-gating): render the same frame indices to offscreen canvases in the editor
    viewport (content layer only, overlays off) and in `runtime-web`; report per-pixel diff. Because both paths share
    the same renderer and the same `sampleSkeleton`, this is near-tautological in Phase 1 and is NOT presented as
    cross-implementation proof; it mainly catches overlay leakage. It runs but does not gate the phase. The headless
    render mechanism is the one named in TASK-1.10.4.
  - TASK-1.13.6 Wire the gating steps (export validates, transform agreement, loop stability, seamless loop, perf) as a
    CI job. The advisory visual check runs but does not block.
- Deliverables: acceptance harness + CI job + the committed idle fixture + sample-time list.
- Acceptance criteria: see section 11 (the DoD script). The gating CI job is green; the advisory visual check runs.

---

## 8. New artifacts introduced in Phase 1

### 8.1 Phase 1 commands (canonical catalog: command-history section 11, WP-C.11; cross-ref Phase 0 WP-0.7)

Every command is registered in `commandRegistry` and is exercised by the WP-C.7 round-trip + discovery harness and the
WP-C.10.4 property tests. Names and `kind` strings are the catalog's. Coalescing legend follows command-history section
5.2 / 6: `Session` = wrapped in `beginInteraction`/`endInteraction` (the primary, timing-independent mechanism);
`Window` = the 250ms time-window fallback for key-nudge/numeric edits; `None` = always its own undo step; `Composite`
= expands to a `CompositeCommand` of catalog primitives.

| Command | kind | Source | Coalescing | Notes / typed-error guards |
|---|---|---|---|---|
| `RotateBone` | `bone.rotate` | catalog, retag P0 -> P1 (AMEND-CH-1) | Session | Setup-pose channel edit. |
| `ScaleBone` | `bone.scale` | catalog, retag (AMEND-CH-1) | Session | Setup-pose channel edit. |
| `SetBoneLength` | `bone.length` | catalog, retag (AMEND-CH-1) | Session | Bone tip render only; no child cascade. |
| `RenameBone` | `bone.rename` | catalog, retag (AMEND-CH-1) | None | Single field; uniqueness at validator (`BONE_NAME_DUPLICATE`), not the command. |
| `DeleteBone` | `bone.delete` | catalog, retag (AMEND-CH-1) | None | Cascade memento, grown incrementally (children now, slots/attachments WP-1.2, tracks WP-1.5); single undo. |
| `ReparentBone` | `bone.reparent` | catalog P1 | None | Cycle rejection is a typed editor command error (not a `FormatErrorCode`); world-stable local recompute. |
| `SetBoneTransformMode` | `bone.transformMode` | catalog P1 | None | Enum from handoff section 6. |
| `CreateSlot` | `slot.create` | catalog P1 | None | Appends to `slots[]` (draw order). |
| `DeleteSlot` | `slot.delete` | catalog P1 | None | Cascades its attachments now, slot timelines once WP-1.5 lands (memento). |
| `RenameSlot` | `slot.rename` | catalog add (AMEND-CH-2) | None | Single field; uniqueness at validator (`SLOT_NAME_DUPLICATE`). Justification: format error code exists; parity with `RenameBone`. |
| `SetSlotBlendMode` | `slot.blend` | catalog P1 | None | Enum. |
| `SetSlotColor` | `slot.color` | catalog P1 | Session | RGBA before/after. |
| `ReorderSlot` | `slot.reorder` | catalog P1 | Session | Setup-pose draw order (`slots[]`). |
| `AddRegionAttachment` | `attach.region.add` | catalog P1 | None | `path` must resolve to an atlas region (`ATTACHMENT_REGION_MISSING` at import). |
| `RemoveAttachment` | `attach.remove` | catalog P1 | None | Memento stores the full attachment value. |
| `SetActiveAttachment` | `slot.activeAttachment` | catalog P1 | None | Setup-pose active attachment. |
| `SetRegionAttachmentTransform` | `attach.region.transform` | catalog add (AMEND-CH-2) | Session | x/y/rotation/scale/size. Justification: a region attachment's placement is a document field; LAW 2 requires a command. |
| `SetAtlasRef` | `atlas.set` | catalog add (AMEND-CH-2) | None | Sets `doc.atlas` after pack. Justification: `atlas` is a document field; LAW 2 requires a command. Computes no hash. |
| `CreateAnimation` | `anim.create` | catalog P1 | None | New named animation; initializes required empty collections (section 5). |
| `RenameAnimation` | `anim.rename` | catalog P1 | None | Single field; map key by `AnimationId` internally. |
| `DeleteAnimation` | `anim.delete` | catalog P1 | None | Memento = whole animation. |
| `DuplicateAnimation` | `anim.duplicate` | catalog add (AMEND-CH-2) | Composite | `CreateAnimation` + `SetKeyframe`/`SetCurve` children. Justification: a named composite over catalog primitives, registered for discovery + round-trip. |
| `SetAnimationDuration` | `anim.duration` | catalog P1 | Window | Rejects shrink below last key (typed command error); validator enforces `ANIM_DURATION`. |
| `SetKeyframe` | `kf.set` | catalog P1 | None (insert) / Session (value-edit while scrubbing) | Single insert-or-update at playhead time on a bone/slot channel, by `KeyframeId`. |
| `MoveKeyframe` | `kf.move` | catalog P1 | Session | Changes keyframe time; keeps array sorted. |
| `DeleteKeyframe` | `kf.delete` | catalog P1 | None | Memento = value + time + curve. |
| `SetCurve` | `kf.curve` | catalog P1 | Session | linear/stepped/bezier + control points; x clamped to `[0,1]` at author time. |
| `PasteKeyframes` | `kf.paste` | catalog add (AMEND-CH-2) | Composite | `SetKeyframe` children at offset time. Justification: composite over catalog primitives, registered for discovery + round-trip. |

Carried from Phase 0 (not new): `CreateBone` (`bone.create`), `MoveBone` (`bone.move`).

Deferred to Phase 2 by AMEND-CH-2 (NOT built in Phase 1): `CreateSkin` (`skin.create`), `SetDrawOrderKeyframe`
(`anim.drawOrder.set`), `SetEventKeyframe` (`anim.event.set`), `DefineEvent` (`event.define`).

### 8.2 Conformance fixture: `rig-2bone` (owned by conformance A.2, WP-V.1/V.2; this plan only references it)

Phase 1's cross-runtime sampling contract is locked by the `rig-2bone` fixture in the existing conformance suite, NOT by
a fixture this plan invents. Layout and ids are the conformance plan's:

- Rig: `packages/conformance/src/rigs/rig-2bone.json` (root + child, length 100 each; rotate on both bones, translate
  on root, and per AMEND-V-1 a `scale` channel on the child). AMEND-V-1 adds a bezier-eased segment so the rig covers
  `linear + stepped + bezier` and the multiply-onto-setup-scale path.
- Sample times: `packages/conformance/src/sample-spec/rig-2bone.sample-spec.json` (A.4). This is the single committed
  list every runtime reads; section 11.2 references it rather than restating it, so they cannot drift.
- Expected outputs: `packages/conformance/src/fixtures/rig-2bone.fixture.json`, generated by `generate.ts` from
  `runtime-core` (A.6). Per A.3 the fixture stores ONLY the canonical raw affine `[a,b,c,d,tx,ty]` per bone in
  document order; decomposed rotation and a separate tip field are NOT stored.
- Independent oracle: the Phase 1 analytic anchor test (TASK-1.12.5) validates the FIRST generation against hand-computed
  closed-form values, so the fixture is not merely self-referential.
- Tolerance: `compare/tolerance.ts` (A.5). No epsilon is defined here.

Slot-color sampling is unit-locked by the WP-1.4 `runtime-core` suite in Phase 1; its cross-runtime fixture-lock lands
with the first slotted Phase 2 rig (color is a per-component lerp, the lowest cross-runtime divergence risk). This
fixture is the locked behavioral contract for bone-transform sampling that web, and later Unity and Godot, must
reproduce within the A.5 tolerance.

### 8.3 Bezier evaluation (our first-principles design, LAW 4)

- A bezier `CurveType` describes easing from a keyframe to the next: implicit endpoints `(0,0)` and `(1,1)`; control
  points `(cx1,cy1)`, `(cx2,cy2)`. `cx1, cx2` are constrained to `[0,1]` (owned by the format validator,
  `CURVE_BEZIER_X_RANGE`, format section 4.8); `cy1, cy2` are unbounded finite (overshoot/anticipation allowed).
- Why `[0,1]` makes the eval well-defined (the precise claim, not a hand-wave). The x-coordinate of a cubic bezier with
  `P0x=0, P1x=cx1, P2x=cx2, P3x=1` has derivative
  `X'(s) = 3 * [ cx1*(1-s)^2 + (cx2-cx1)*2s(1-s) + (1-cx2)*s^2 ]`. The middle coefficient `(cx2-cx1)` can be negative, so
  non-negativity is not automatic from non-negative control x alone; it must be proven. Treating the bracket as a
  function of `(cx1,cx2)` on the unit square for fixed `s`, it is linear in each control point, so its minimum is
  attained at a corner. The three governing corners give `s^2` (for small `s`), `(1-2s)^2` (mid), and `(1-s)^2` (large
  `s`), each `>= 0`. Therefore `X'(s) >= 0` for all `s in [0,1]` whenever `cx1, cx2 in [0,1]`, so `X(s)` is monotonic
  non-decreasing and mapping input x to output y by bracketing x is well-defined. This is the justification for the
  format's `[0,1]` constraint. (Note: this is the proven monotonicity of `X(s)`, NOT a claim that any control x in
  `[0,1]` keeps the y-SHAPE simple; the curve may still overshoot in y.)
- On build/load, sample the cubic at `BEZIER_SEGMENTS = 10` EQUAL-PARAMETER `s` steps into `(x,y)` pairs, cached on the
  SOLVE-SIDE keyframe representation (NOT serialized into the document). Because `X` is monotonic, the stored `x` values
  are non-decreasing. A `runtime-core` build-time assertion checks the sampled `x` table is non-decreasing, so any
  future change that breaks the invariant is caught.
- At sample time, normalize `nx = (t - t0)/(t1 - t0)`, find the bracketing x-segment `[x_i, x_{i+1}]` by binary search,
  and linearly interpolate `y`. DETERMINISTIC TIE-BREAK at a flat spot (where `x_i == x_{i+1}`, possible at a zero-slope
  inflection such as `cx1=1, cx2=0`): the lookup selects the LOWEST index `i` whose `x_{i+1} >= nx`, and when
  `x_{i+1} == x_i` the segment returns `y_i` (the lerp denominator is guarded, so the result is never `NaN` and never
  index-order-dependent). Apply the resulting `y` to the value delta per TASK-1.4.3.
- What this does and does not guarantee across runtimes. Equal-parameter sampling plus x-bracket lookup is deterministic
  within one runtime and avoids iterative root-finding, whose iteration counts and termination can diverge across
  language math libraries. It is NOT bit-identical across TS, C#, and GDScript: the `(x,y)` table is recomputed in each
  runtime (it is solve-side, not serialized), and f64 non-associativity, fused-multiply-add contraction, and differing
  `libm` mean the last 1 to 3 ULPs can disagree. That residual is absorbed by the A.5 tolerance, which is exactly why
  the suite uses a tight-but-nonzero tolerance rather than demanding bit-exactness (conformance A.5). The single
  normative parameterization (equal-parameter `s` steps, x-bracket lookup with the tie-break above,
  `BEZIER_SEGMENTS = 10`) is defined once in `runtime-core` and locked by the `rig-2bone` fixture; no runtime re-derives
  a different parameterization. Float-op hazards the Unity and Godot ports MUST respect: no FMA contraction, a fixed
  operation order matching the TS reference (no reassociation, same Horner-or-expanded form), and the same tie-break.
- `BEZIER_SEGMENTS = 10` rationale (documented next to the constant per the handoff "document as our design"): 10
  segments is a piecewise-linear approximation of the cubic. It is cheap, deterministic, and adequate for slot UI
  easing; it can show mild faceting on very slow eases. The value is a committed design choice, raisable later only as
  a deliberate fixture-regenerating change (it alters solve output), so it is fixed and documented rather than tuned ad
  hoc.

### 8.4 Acceptance rig: `idle-sprite` (pinned exactly, like `rig-2bone`)

THE artifact that gates the phase is pinned to the same precision as `rig-2bone`: exact bones, slots, attachment map,
atlas inputs + pack config, animation duration, and per-channel keyframes (time, value, curve). Committed under
`packages/conformance/assets/idle-sprite/` (rig JSON + source sprites + the deterministic packed atlas +
`idle-sprite.sample-list.json`). This is an editor DoD / integration artifact (conformance C.2 / WP-V.7), distinct from
the cross-runtime conformance rigs.

Bones (setup pose, local; angles in degrees, lengths in document units):

- `torso`: parent `null` (the single root), `x=0, y=0`, `rotation=90`, `length=120`, `scaleX=1, scaleY=1`,
  `shearX=0, shearY=0`, `transformMode=normal`. (Non-zero setup rotation deliberately exercises the auto-key delta rule,
  TASK-1.8.2.)
- `armL`: parent `torso`, `x=120, y=0` (at the torso tip in torso-local), `rotation=35`, `length=70`, scale 1, shear 0,
  `transformMode=normal`.
- `armR`: parent `torso`, `x=120, y=0`, `rotation=-35`, `length=70`, scale 1, shear 0, `transformMode=normal`.

Slots (the `slots[]` array IS the setup draw order, back to front):

1. `armR` on bone `armR`, attachment `armR`, color `{r:1,g:1,b:1,a:1}`, blend `normal`.
2. `torso` on bone `torso`, attachment `torso`, color `{r:1,g:1,b:1,a:1}`, blend `normal`.
3. `armL` on bone `armL`, attachment `armL`, color `{r:1,g:1,b:1,a:1}`, blend `normal`.

Default skin attachments (`skins.default.attachments`): slot `torso` -> attachment `torso` (`path: "torso"`), slot
`armL` -> `armL` (`path: "armL"`), slot `armR` -> `armR` (`path: "armR"`). Each attachment width/height/offset defaults
from its region (below).

Atlas inputs and pack config (the AtlasRef + PNG pages are the DETERMINISTIC OUTPUT of these pinned inputs through the
committed packer, committed alongside the rig and regenerated only via the WP-1.3 pipeline):

- Source sprites (RGBA PNG, exact dimensions and alpha bounding box):
  - `torso.png`: `64x128`, opaque content trimmed to `60x120` at `offsetX=2, offsetY=4`, `originalW=64, originalH=128`.
  - `armL.png`: `48x96`, trimmed to `44x90` at `offsetX=2, offsetY=3`, `originalW=48, originalH=96`.
  - `armR.png`: `48x96`, trimmed to `44x90` at `offsetX=2, offsetY=3`, `originalW=48, originalH=96`.
- Pack config: `maxPageSize=128`, `padding=2`, `allowRotation=false`, sort `area-descending then name-ascending`. With
  these inputs this deterministically yields TWO `128x128` pages: page 0 = `[torso]`, page 1 = `[armL, armR]` (so the
  rig genuinely exercises the multi-page path). All `rotated` flags are `false` (section 4.2). Exact `x/y` per region is
  the committed packer output in the fixture.

Animation `idle` (looping, SEAMLESS; every channel's first and last keyframe values match so `pose(0) == pose(duration)`,
TASK-1.4.7). `duration = 1.2`. Required empty collections `ik:{}, transform:{}, deform:{}, drawOrder:[], events:[]`
present (section 5). Channels (value is the DELTA over setup per TASK-1.4.3):

- `bones.torso.rotate`:
  - `t=0.0, angle=0`, curve `{type:"bezier", cx1:0.25, cy1:0.0, cx2:0.75, cy2:1.0}`
  - `t=0.6, angle=8`, curve `{type:"bezier", cx1:0.25, cy1:0.0, cx2:0.75, cy2:1.0}`
  - `t=1.2, angle=0`, curve `linear` (last-key curve ignored). First==last (0==0): seamless.
- `bones.torso.translate`:
  - `t=0.0, x=0, y=0`, curve `linear`
  - `t=0.6, x=0, y=6`, curve `linear`
  - `t=1.2, x=0, y=0`, curve `linear`. Seamless small vertical bob.
- `bones.armL.rotate`:
  - `t=0.0, angle=0`, curve `stepped`
  - `t=0.6, angle=20`, curve `linear`
  - `t=1.2, angle=0`, curve `linear`. Exercises stepped + linear; seamless.
- `bones.armR.rotate`:
  - `t=0.0, angle=0`, curve `linear`
  - `t=0.6, angle=-20`, curve `{type:"bezier", cx1:0.42, cy1:0.0, cx2:0.58, cy2:1.0}`
  - `t=1.2, angle=0`, curve `linear`. Exercises bezier + linear; seamless.

This authors >= 3 keyframes on each of multiple bones, uses all three curve types across at least two bones (torso and
armR bezier, armL stepped), and is seamless by construction. Sample-time list
`packages/conformance/assets/idle-sprite/idle-sprite.sample-list.json`:
`[0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35]` (the last value, `> duration`, pins the clamp; under the
transport loop map it folds to `0.15`). This single committed list is referenced by both this section and section 11.2,
so they cannot drift.

### 8.5 Phase 1 performance and allocation probes (local; conformance WP-V.8 formalizes them in Phase 2/3)

The formal conformance performance and allocation gates (WP-V.8) land in Phase 2/3. Phase 1 still enforces the 60fps and
no-per-frame-allocation invariants with LOCAL probes, so no Phase 1 acceptance depends on a Phase 2/3 job or on a fixture
built later in Phase 1:

- Allocation probe: a Vitest test in `runtime-core` and `runtime-web` that runs N frames under `--expose-gc`, forces GC,
  and measures the heap delta of the solve/render hot loop, asserting it is below a tight per-frame byte threshold (the
  conformance C.4 technique). Proves `sampleSkeleton` writes its caller-owned pose buffer and the player pools
  sprites/matrices.
- Frame-budget probe: a Vitest benchmark that samples and renders a REPRESENTATIVE animation AVAILABLE at the WP under
  test (WP-1.6 uses a synthetic in-test dopesheet; WP-1.10 uses an exported `rig-2bone`; WP-1.13 uses `idle-sprite`),
  asserting solve+render p95 under a generous CI ceiling with relative-regression tracking. The strict on-device 16.6ms
  budget is validated in Phase 5; the Phase 1 ceiling guards against gross regressions on noisy CI hardware.

These probes are Phase-1-local and self-contained; conformance WP-V.8 later subsumes them into the formal cross-runtime
perf/allocation job.

---

## 9. Command registry and enforcement (LAW 2)

Phase 1 adds no new mutation path and no new enforcement mechanism; it plugs into the ones command-history already
owns.

- Every command in section 8.1 is registered in `commandRegistry` (command-history section 10.1). The discovery guard
  (WP-C.7 TASK-C7.2) fails CI if any `*.command.ts` exports a `kind` not present exactly once in the registry, so a
  forgotten registration is a red build, not a silent gap.
- Every command is exercised by the generic do/undo/redo harness over the registry (WP-C.7 TASK-C7.3) and the property
  tests (coalesce-collapse, random walk, empty-doc safety, composite reversal; WP-C.7 / WP-C.5). This plan therefore
  does not attach a bespoke round-trip test to each command; the harness covers them by construction, which is the
  stronger guarantee.
- Mutation is structurally gated by the `Mutator` capability (command-history section 4.3 / 9.1) and the
  `no-mutator-outside-command` lint rule (section 9.2). The reviewer rule stands: a PR that mutates `DocumentModel`
  outside a `Command` is rejected. The derived content `hash` is not a `DocumentModel` field (section 5), so computing
  it in the exporter is not a mutation and does not violate this rule.
- Auto-key (WP-1.8) introduces no direct keyframe write: it dispatches `SetKeyframe`. The single edit dispatcher
  (TASK-1.8.5) is the only place that selects setup-pose vs keyframe commands by `mode`.

---

## 10. Sequencing and critical path

### 10.1 Dependency graph

```
WP-1.3 (atlas) --> WP-1.2 (attachments) ------+
WP-1.1 (bones) -------------------------------+--> WP-1.8 (mode + auto-key) --> WP-1.13 (DoD)
WP-1.4 (sampling) --> WP-1.5 (anim cmds) --> WP-1.6 (dopesheet) --> WP-1.7 (curves) --+
WP-1.4 --> WP-1.12 (conformance: rig-2bone)
WP-1.2 + WP-1.3 + WP-1.5 --> WP-1.11 (validator enablement + negative corpus)
all authoring --> WP-1.10 (export + runtime-web) --> WP-1.13 (DoD)
```

### 10.2 Recommended build order (one logical change per branch, milestone-gated)

1. WP-1.1 bone tools (extends Phase 0 commands; carries AMEND-CH-1).
2. WP-1.3 atlas pipeline (unblocks attachments; carries `atlas.set`).
3. WP-1.2 region attachments + draw order (relies on the already-complete validator for `ATTACHMENT_REGION_MISSING`).
4. WP-1.4 runtime-core sampling (the behavioral core).
5. WP-1.12 land `rig-2bone` into conformance (lock sampling behavior immediately after WP-1.4; carries AMEND-V-1).
6. WP-1.5 animation/keyframe commands.
7. WP-1.6 dopesheet (the largest UI WP; keep it minimal per section 4.2 and R1.1).
8. WP-1.7 curve editor.
9. WP-1.8 mode + auto-key.
10. WP-1.9 named animations.
11. WP-1.11 validator enablement + negative corpus (no new checks; the validator is already complete from Phase 0).
12. WP-1.10 export + runtime-web playback.
13. WP-1.13 DoD acceptance harness.

The `DeleteBone`/`DeleteSlot` cascade grows across steps 1, 3, and 6 (child bones, then slots/attachments, then tracks);
each step owns the test for the slice it adds (TASK-1.1.2), so no acceptance criterion references an entity that does
not yet exist at its build step. Lock WP-1.4 with WP-1.12 before building the dopesheet so the UI is authored against a
frozen sampling contract.

### 10.3 Critical path

WP-1.4 -> WP-1.5 -> WP-1.6 -> WP-1.7 -> WP-1.8 -> WP-1.10 -> WP-1.13. The dopesheet (WP-1.6) is the schedule risk;
keep it to the minimum scope defined in section 4.2 and R1.1. WP-1.10 (export + player) is on the critical path because
WP-1.13 hard-depends on it (section 10.1).

---

## 11. Definition of Done: acceptance script (the gate)

All gating steps must pass on CI and locally. This is the literal proof of the milestone. The manual authoring proof
(11.1) is NON-gating; the machine gate is 11.2. The advisory visual check runs but does not gate (section 1,
conformance B.2 / WP-V.8).

### 11.1 Authoring proof (manual, recorded once, NON-gating)

This is human verification, recorded once for confidence; it does NOT gate CI (the machine gate is 11.2):

1. Create a new document. Import the `idle-sprite` source sprites; run background removal at asset prep if needed, then
   run the atlas pack (WP-1.3). Confirm `AtlasRef` + PNG pages emitted (two pages per section 8.4), with no `rembg`
   dependency in the pack step.
2. In setup mode, create the torso + two limb bones; reparent a limb under the torso and confirm its on-screen position
   does not jump (world-stable reparent).
3. Create slots, add region attachments, set draw order so limbs render behind/in front correctly.
4. Switch to animation mode. Create animation `idle` (looping). With auto-key on, key rotate poses on two bones across
   3+ keyframes; set one segment to bezier, one to stepped, one linear via the curve editor; match first/last keyframe
   values so the loop is seamless.
5. Scrub and play/pause/loop; confirm the idle reads correctly and loops without a visible pop at `workingFps=30` and
   `60`.
6. Save, reload; confirm the document snapshot is deep-equal (no loss), and undo/redo across the whole session is clean.

### 11.2 Determinism + parity proof (automated, gating, WP-1.13)

The conformance contract (`rig-2bone`) is gated by the EXISTING conformance jobs, not a new per-rig script:

```
pnpm --filter @marionette/conformance test     # WP-V.4 runtime-web harness: all rigs incl. rig-2bone vs committed
                                                # fixtures, A.5 tolerance (the Phase 1 conformance gate)
pnpm --filter @marionette/conformance generate \
  && git diff --exit-code \
       packages/conformance/src/rigs \
       packages/conformance/src/sample-spec \
       packages/conformance/src/fixtures        # WP-V.2 fixtures-lock drift gate (A.6)
```

The Phase 1 editor DoD is gated by `phase1:acceptance` (WP-1.13), which performs:

1. Export `idle-sprite` to format JSON + atlas; assert the export passes `validateDocument` (schema + semantic +
   animation + hash), `verifyContentHash` is true, and the animation carries the required empty collections (section 5).
2. Transform agreement: sample `idle` at the committed
   `packages/conformance/assets/idle-sprite/idle-sprite.sample-list.json` times via the editor's `runtime-core` path and
   via `runtime-web`'s playback path; assert every bone world affine and tip position agree within the A.5 tolerance
   (`tolerance.ts`). This proves determinism and non-perturbation across the web boundary (both call the same
   `sampleSkeleton`), not cross-implementation correctness.
3. Loop stability: sample across 10 loop iterations; assert values at each loop boundary are deep-equal (no drift).
4. Seamless loop: assert `pose(0)` and `pose(duration)` agree within the A.5 tolerance (pop-free, TASK-1.13.4).
5. Performance: assert the solve+render frame budget on the `idle-sprite` rig via the section 8.5 frame-budget probe
   (relative-regression + generous CI ceiling; strict 16.6ms validated on device in Phase 5).

Advisory (NON-gating): render matching frame indices to offscreen canvases in the editor viewport (content layer only)
and in `runtime-web`; report the per-pixel diff. It is web-only, non-blocking, and near-tautological (shared renderer +
shared `sampleSkeleton`); it mainly catches overlay leakage and is not cross-implementation proof. The headless render
mechanism is the one named in TASK-1.10.4.

### 11.3 Gate checklist

- [ ] WP-1.1 to WP-1.13 acceptance criteria all green.
- [ ] Every Phase 1 command (section 8.1) is registered in `commandRegistry`; the WP-C.7 discovery guard and generic
      round-trip harness are green (no per-command bespoke test required, the harness covers them).
- [ ] `rig-2bone` conformance (WP-V.4) passes within the A.5 tolerance; the analytic anchor oracle passes; fixtures +
      `.fixtures.lock` committed; the fixtures-lock drift gate is green; AMEND-V-1 landed (bezier + scale in `rig-2bone`,
      A.2 checklist updated).
- [ ] `phase1:acceptance` passes: export validates, hash verified, transform agreement within A.5, loop stable, loop
      seamless (`pose(0) == pose(duration)` within A.5).
- [ ] `formatVersion` unchanged; no new `FormatErrorCode`; authored animations serialize the required empty collections;
      the Phase 1 negative corpus is rejected with the expected codes and paths.
- [ ] No PixiJS import in `runtime-core`; no `any` / unjustified `as` in `format` or `runtime-core`.
- [ ] No per-frame allocation in `sampleSkeleton` or the player (section 8.5 allocation probes green).
- [ ] The three same-PR amendments (AMEND-CH-1, AMEND-CH-2, AMEND-V-1) are merged into their owning docs in this PR.
- [ ] CI green: typecheck, lint, unit, conformance-web, fixtures-lock, perf, acceptance. No em-dashes anywhere.

When 11.3 is fully checked, Phase 1 is done and Phase 2 may begin (LAW 5).

---

## 12. Risks and mitigations (Phase 1 specific)

| ID | Risk | Severity | Mitigation (decision of record) |
|---|---|---|---|
| R1.1 | Dopesheet complexity balloons | High | Build the minimum only: keying + bezier + scrub (WP-1.6/1.7). Defer onion-skin, ripple-edit, full graph editor, and event/draw-order timelines (section 4.2). A WP-1.6 PR that adds deferred features is rejected. |
| R1.2 | Curve eval differs between editor preview and runtime | High | One sampling function (`BEZIER_SEGMENTS=10`) shared by `runtime-core`, the curve editor preview, and `runtime-web` (WP-1.4 TASK-1.4.6, WP-1.7 TASK-1.7.3). Deterministic within the A.5 tolerance and locked by the `rig-2bone` fixture (WP-1.12); NOT claimed bit-identical (section 8.3). |
| R1.3 | Reparent introduces a world-transform jump or a cycle | High | World-stable local recompute + command-level cycle guard (WP-1.1 TASK-1.1.3/1.1.4) with an A.5-tolerance parity test and a negative cycle test; import-time cycles surface as `BONE_ORDER_VIOLATION`/`BONE_PARENT_MISSING`. |
| R1.4 | Auto-key creates a hidden non-command mutation path, or stores absolute instead of delta | High | Single edit dispatcher; auto-key only dispatches `SetKeyframe` (WP-1.8). The `no-mutator-outside-command` lint rule + a boundary test assert the dispatcher is the sole caller. The delta capture (TASK-1.8.2) is specified as the exact inverse of the sampling apply (TASK-1.4.3), and the non-zero-setup-rotation acceptance proves it. |
| R1.5 | Editor viewport and runtime-web drift | High | They share `sampleSkeleton` and region-placement math; the viewport adds overlays only (WP-1.10 TASK-1.10.3). Import-graph assertion + transform agreement within A.5 (WP-1.13). Cross-implementation correctness is proven later by the conformance suite (Unity/Godot, Phase 5), not by Phase 1's same-symbol agreement. |
| R1.6 | Atlas trim/offset math wrong, sprites misplaced | Medium | Trim round-trip test (decoded-pixel-hash) and trimmed-vs-untrimmed pixel test (WP-1.2, WP-1.3; conformance WP-V.7). Deterministic pack (asserted on AtlasRef coordinates + decoded-pixel hash, not PNG bytes) so regressions are diffable. Rotation disabled in Phase 1 (section 4.2) removes the untested rotated-UV path. |
| R1.7 | Per-frame allocation tanks 60fps | Medium | `sampleSkeleton` writes a caller-owned pose buffer; pool matrices/sprites; the section 8.5 allocation probes (Phase-1-local; WP-V.8 formalizes in Phase 2/3) gate it. |
| R1.8 | Coalescing wrong (drag = many undo steps, or merges across actions) | Medium | Use the PRIMARY interaction-session mechanism per command-history section 5.2/6; explicit coalesce-collapse tests (60-step drag = 1 entry). The time window is a fallback, not the default. |
| R1.9 | Format drift sneaks in via a "small field" | Medium | LAW 3: any format change (even additive) bumps `formatVersion`, updates the validator, and regenerates fixtures in the same reviewed PR (format section 11). `formatVersion` unchanged is a gate item (11.3) and the format semver gate (conformance WP-V.12) enforces it. |
| R1.10 | Background removal environment differences break import | Low | `rembg` is an optional asset-prep step behind `MARIONETTE_REMBG_BIN`, validated at boot, fail-fast, and strictly outside the deterministic pack step (WP-1.3 TASK-1.3.2), so pack determinism never depends on it. |
| R1.11 | Loop pops despite passing no-drift | Medium | Seamless loop requires matched endpoints (TASK-1.4.7); the idle rig is authored with first==last per channel (section 8.4); the DoD asserts `pose(0)==pose(duration)` within A.5 (TASK-1.13.4), which no-drift alone does not prove. The editor surfaces a non-blocking endpoint-mismatch advisory. |
| R1.12 | This plan re-forks a decision of record | High | Section 0 binds every cross-cutting concern to its owning doc and lists the three same-PR amendments. A Phase 1 PR that re-defines commands, validator codes, the hash, or the conformance design instead of referencing them is rejected. |

---

## 13. Sign-off

This plan is approved when a senior reviewer confirms:

- [ ] Section 0 references the three decision-of-record docs at the right anchors, and the three same-PR amendments
      (AMEND-CH-1, AMEND-CH-2, AMEND-V-1) are approved together with this plan. No content is re-forked.
- [ ] Internal targets and selection use branded IDs (`BoneId`, `SlotId`, `AnimationId`, `KeyframeId`), never names or
      array indices (section 6, command-history section 2).
- [ ] The Phase 1 command set (section 8.1) matches the catalog's names, `kind` strings, and phase tags after the
      amendments; each is registered and harness-covered (no per-command bespoke test).
- [ ] All numeric assertions consume `compare/tolerance.ts` (A.5); no epsilon is invented (section 0.3); bit-identity is
      not claimed anywhere (section 8.3).
- [ ] The content hash is computed once in the exporter via `computeContentHash` (WP-1.10), never in the atlas pipeline,
      and is excluded from the editable model and the round-trip deep-equal (section 5).
- [ ] Authored animations serialize the required empty collections (`ik`/`transform`/`deform`/`drawOrder`/`events`) and
      validate; the validator is complete from Phase 0; WP-1.11 adds only a corpus and import surfacing, no new codes.
- [ ] Auto-key captures the DELTA from setup (TASK-1.8.2), the exact inverse of the sampling apply (TASK-1.4.3); the
      bezier eval is well-defined (proven monotone x, deterministic tie-break, section 8.3) and not claimed bit-identical.
- [ ] Loop semantics are defined (single-period clamp + transport wrap, matched endpoints, section 8.3 / TASK-1.4.7) and
      the DoD gates a seamless loop, not merely no-drift.
- [ ] Every WP acceptance criterion is evaluable at its own build step (section 10.2); cascades grow across WPs with each
      WP owning its slice's test; no criterion depends on a later WP or a not-yet-built fixture.
- [ ] `rig-2bone` lands in the existing conformance suite with raw-affine fixtures, a committed sample-spec, the
      runtime-web harness, the fixtures-lock gate, and an independent analytic-anchor oracle; bezier and scale coverage
      are added via AMEND-V-1 (WP-1.12).
- [ ] The `idle-sprite` gate fixture is pinned exactly (bones, slots, atlas inputs + config, duration, per-channel
      keyframes; section 8.4), reproducible, and seamless by construction.
- [ ] Pixel comparison is advisory and non-gating with a named headless mechanism; the gate is transform agreement
      within A.5 plus export validation plus loop stability plus seamless loop plus the section 8.5 perf probe.
- [ ] No law or invariant in section 3 is violated, and all deferrals (section 4.2) are explicit.

Reviewer: ______________________  Date: ____________
