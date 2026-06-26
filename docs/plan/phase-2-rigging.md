# Phase 2: Rigging (Tier 2, the hard subsystem)

> Plan of record. Requires senior reviewer sign-off before WP-2.1 starts.
> Codename Marionette. Authoritative source: `MARIONETTE_HANDOFF.md` (format §6, command system §8.1, math boundary §7, mesh/skinning §8.5, IK/constraints §8.6, roadmap §9, risks §10, conventions §11).

| Field | Value |
|---|---|
| Phase | 2 (Rigging) |
| Status | Draft, awaiting sign-off |
| Prerequisite | Phase 1 milestone GREEN (entry gate, see section 2) |
| Milestone (exit) | A mesh-deformed character with a weighted, IK-driven limb animating smoothly, played identically in editor AND web runtime, with cross-runtime conformance fixtures green |
| Rough effort | 2 to 4 months solo + AI (longest phase; do not compress by skipping the validation spike WP-2.0) |
| Touches Law 1 (math/presentation boundary) | No new outcome surface. Rigging is pure presentation. Machine-enforced by an import-boundary rule (section 3). |
| Touches Law 2 (all mutations are commands) | Yes, heavily. Every new editor capability ships as a Command with a mandatory do/undo round-trip test. |
| Touches Law 3 (format is the contract) | No BREAKING change to the format. `packages/format` receives ADDITIVE, backward-compatible code only (the weighted-vertex codec and the weighted-encoding validator rules, both for §6 structures first authored in Phase 2). `formatVersion` is bumped only via ADR. Two ADRs gate this phase: ADR-2.WEIGHTED and ADR-2.SOLVE (section 3, section 5, WP-2.2). |
| Touches Law 4 (Spine legal boundary) | Yes. LBS, analytic IK, transform constraints, affine decomposition, and deform are implemented from first principles. No Spine source, no Spine binary compatibility. |
| Touches Invariant (runtime-core has no PixiJS) | Yes. LBS, IK solve, transform-constraint solve, on-demand world resolution, affine decompose/recompose, and deform application land in `runtime-core` (pure). Rendering stays in `runtime-web`. Triangulation and silhouette tracing are authoring-only (editor), never in `runtime-core`. |
| Touches Invariant (fixtures generated from runtime-core) | Yes. Six new fixture families (WP-2.10), committed, regenerated only as a deliberate reviewed act. |

---

## 1. Phase goal and exit milestone

Phase 2 turns the Tier-0/1 bone puppet from Phase 1 into a real character-animation tool. The single deliverable that defines success:

**A mesh-deformed character with a weighted, IK-driven limb animating smoothly, played identically in editor AND web runtime, with cross-runtime conformance fixtures green.**

Decomposed, the exit milestone requires all of the following to be simultaneously true and verifiable (full acceptance script in section 14):

1. An artist can take a region attachment, generate a mesh (auto grid-fill or auto perimeter trace as a starting point), and edit vertices/edges.
2. That mesh can be bound to two or more bones and weight-painted, with weights normalized and capped at the pinned `MAX_BONE_INFLUENCES` (4) per vertex.
3. A two-bone IK constraint drives a limb from a target bone; bend direction is controllable.
4. A transform constraint drives one bone's channels from another with mix and offset, in world space, per the solve-semantics spec (section 5).
5. A deform timeline animates per-vertex offsets that are applied AFTER skinning by the runtime.
6. The same exported document plays identically in the editor viewport and `runtime-web`, with all sampled solve outputs (bone world transforms and skinned-plus-deformed vertex positions) agreeing within the committed conformance tolerance (section 11), validated against committed conformance fixtures. There is no "byte-identical" claim for floating-point solve output; byte-identity applies only to the fixture-regeneration determinism check (section 11, WP-2.10).

---

## 2. Entry gate: Phase 1 must be GREEN

Do not begin WP-2.1 until every item below is checked. This gate is non-negotiable (Law 5, phase independence).

- [ ] G2.1 `packages/format` types from §6 exist, are TypeScript-strict, and the JSON Schema validator rejects malformed documents loudly on import for every attachment and constraint type that EXISTS in Phase 1 (bones, slots, region attachments, unweighted meshes, IK/transform constraint declarations, animations, atlas). Weighted-mesh encoding validation does NOT yet exist, because weighted meshes are first authored in Phase 2; it is ADDED in WP-2.2 as deliberate, additive format work (section 9 ledger, TASK-2.2.0 and TASK-2.2.1). This is not a contradiction with TASK-2.2.0: the validator gains rules for a §6 structure that had no instances before Phase 2.
- [ ] G2.2 `DocumentModel` + `History` (§8.1) are the ONLY mutation path. CI has a lint/review rule that fails any `DocumentModel` mutation outside a `Command`.
- [ ] G2.3 `runtime-core` has the 2x3 affine lib and the world-transform pass (solve order steps 1 and 4) with passing unit tests.
- [ ] G2.4 `runtime-web` (PixiJS) renders a `SkeletonDocument` setup pose and plays a bone-only animation; the editor viewport imports `runtime-web` (shared renderer).
- [ ] G2.5 The dopesheet keys bone rotate/translate/scale/shear with linear, stepped, and bezier curves; playback is identical in editor and `runtime-web`.
- [ ] G2.6 A conformance harness exists in `packages/conformance` with at least one bone-only fixture green in CI; fixtures are generated from `runtime-core`.
- [ ] G2.7 Save/load round-trips a document to format JSON and back to a deep-equal `DocumentModel`.
- [ ] G2.8 An import-boundary lint tool is wired into CI (for example `eslint-plugin-boundaries`), so Law 1 and the `runtime-core` no-PixiJS invariant can be machine-enforced, not eyeballed. Phase 2 extends it with the rules in section 3.

If any box is unchecked, Phase 2 is blocked. Fixing Phase 1 debt now is cheaper than building rigging on a soft foundation.

---

## 3. Architectural laws this phase must honor (call-outs)

- **Law 1 (math/presentation boundary), machine-checked.** Rigging adds zero outcome logic. There is no `SpinResult` dependency anywhere in Phase 2. The boundary is enforced by a CI import-boundary rule (G2.8), not by review-by-eye: no file under `apps/editor/.../modules/mesh`, `apps/editor/.../modules/constraints`, or any `runtime-core` skinning/IK/transform/deform/world-resolution module may import from `packages/math-bridge`. A PR that adds such an import fails CI, mirroring G2.2's command-mutation lint.
- **Law 2 (commands).** Section 10 enumerates every Phase 2 command (34 total). Each has a mandatory `do`/`undo` round-trip test: `do` then `undo` returns a deep-equal prior `DocumentModel`. Weight-paint strokes, vertex drags, deform vertex drags, and slider drags coalesce into single undo steps via the explicit interaction-group API (section 5.7, TASK-2.1.0), NOT the 250ms time heuristic.
- **Law 3 (format is the contract).** Phase 2 makes NO breaking change to the format: no field is removed, no existing field's meaning changes, no previously valid document becomes invalid, and `formatVersion` is bumped only via ADR. Phase 2 DOES add backward-compatible code to `packages/format`: (a) the weighted-vertex codec (`encodeWeightedVertices`/`decodeWeightedVertices`), and (b) validator rules that enforce the §6 weighted encoding (new because weighted meshes are first authored in Phase 2). These additions are deliberate format work, recorded by ADR-2.WEIGHTED (TASK-2.2.0), not silent edits. **STOP-and-ADR rule:** if any work package discovers the format cannot express what is needed (a new field or a changed meaning), halt that WP, file `docs/adr/NNNN-*.md`, bump `formatVersion` under review, and update the validator and fixtures as one reviewed change. Ad-hoc field additions are forbidden (§10 format-churn risk).
- **Law 4 (Spine legal boundary).** LBS, one- and two-bone analytic IK (law of cosines), transform constraints, the 2D affine decompose/recompose (QR-style), and deform are general computer science implemented from first principles. No Spine runtime source is read, copied, or vendored; no claim of Spine binary compatibility. Algorithm references in comments cite math (law of cosines, linear blend skinning, affine matrix decomposition), not Spine.
- **Invariant (runtime-core dependency-light, no PixiJS).** All solving (`resolveWorld`, `decomposeWorld`/`composeWorld`, `solveIkOneBone`, `solveIkTwoBone`, `solveTransformConstraint`, `solveSkin`, `applyDeform`) lives in `runtime-core` and imports nothing from PixiJS, the editor, or `math-bridge`. Triangulation (earcut), marching-squares silhouette tracing, and Douglas-Peucker simplification are AUTHORING-ONLY and live in the editor (`modules/mesh`); `runtime-core` never depends on earcut and never re-triangulates. This is what lets Unity/Godot reimplement the solve surface against the same fixtures without being misled into reimplementing triangulation.
- **Invariant (fixtures from runtime-core).** WP-2.10 generates six fixture families from the TS reference. Changing solve behavior later requires regenerating fixtures as a deliberate, reviewed commit.
- **Invariant (60fps, no per-frame allocation).** Skinning and deform run in the per-frame solve/render loop. Vertex/weight buffers are pre-allocated and pooled (section 13 performance budgets). No allocation inside `solveSkin`/`applyDeform`/`solveIk*`/`solveTransformConstraint`.
- **No em-dashes and no en-dashes** anywhere in code, comments, docs, or UI copy. Use commas, parentheses, or separate sentences.

**Import-boundary rules added this phase (CI-enforced, G2.8):**

1. No import of `@marionette/math-bridge` from `modules/mesh`, `modules/constraints`, or `runtime-core` solve modules (Law 1).
2. No import of PixiJS (`pixi.js` / `@pixi/*`) from any `runtime-core` module (no-PixiJS invariant).
3. No import of `earcut` (or any triangulation library) from `runtime-core` (authoring stays out of core).

---

## 4. WP-2.0 (RISK-FIRST): validate that mesh deform is actually needed

This is a gate, not a formality. §10 flags "mesh deform was never actually needed" as a real risk: if the real symbol designs are mostly sprite-on-bone, the months of Phase 2 mesh work could be deferred. Run this BEFORE committing to WP-2.1.

**External prerequisite and fallback.** The ideal input is the first real game's character designs from the Gemini asset pipeline. In a greenfield repo these may not exist yet (they are produced near Phase 4). FALLBACK: if the real designs are not ready, run the audit against a REPRESENTATIVE stand-in set (the intended hero-character concept plus a sample of typical Pragmatic-class symbols), and mark DECISION-2.0 as PROVISIONAL with a mandatory re-check gate at Phase 4 (RECHECK-2.0) when the real designs land. The audit is never skipped and never fabricated. If neither real designs nor a representative stand-in exist, Phase 2 proceeds under the FULL-Phase-2 default and DECISION-2.0 records "provisional, designs pending."

| ID | Task | Owner | Done when |
|---|---|---|---|
| TASK-2.0.1 | Collect the target symbol/character designs (real Gemini-pipeline assets if available, otherwise the representative stand-in set above). Inventory each: does it need surface deformation (bending limbs, squash/stretch, cloth/jelly) or is rigid sprite-on-bone sufficient? | Lead | A committed table `docs/plan/phase-2-symbol-deform-audit.md` lists every planned animated element with a verdict: `sprite-on-bone` or `needs-mesh-deform`, and marks whether the input was real or stand-in. |
| TASK-2.0.2 | Count. If fewer than ~15% of animated elements need mesh deform AND the milestone character can be done sprite-on-bone, escalate a decision: defer WP-2.1/2.3/2.4/2.9 (mesh, skinning, weight paint, deform) and ship IK + transform constraints + skins only as a reduced Phase 2. | Lead + reviewer | A written decision is recorded in the audit doc with sign-off. |
| TASK-2.0.3 | If deform IS needed (expected for a Pragmatic-class hero character), confirm at least one concrete milestone character that exercises weighted mesh + two-bone IK + deform, and pin it as the Definition-of-Done rig. | Lead | The DoD rig is named and its source assets are committed under `packages/conformance/assets/`. |

**Gate decision (must be recorded before WP-2.1):**

- [ ] DECISION-2.0: Full Phase 2 (mesh + skinning + weight paint + IK + transform + skins + deform) OR reduced Phase 2 (IK + transform + skins only), with PROVISIONAL/FINAL status per the fallback above. Default assumption for planning and the rest of this document is FULL Phase 2.
- [ ] RECHECK-2.0 (only if DECISION-2.0 is PROVISIONAL): re-run TASK-2.0.1/2.0.2 against the real designs when they land in Phase 4; confirm or revise scope.

Rationale for risk-first ordering: WP-2.1/2.3/2.4/2.9 are the most expensive packages in the entire project. Spending three engineering days on an audit to avoid potentially two wasted months is the highest-leverage decision in this phase.

---

## 5. Solve-semantics specification (the contract Unity/Godot reimplement)

This section is the normative specification of how constraints obtain world state, what space each constraint reads and writes, and how the result reconciles with the single forward world pass. It is the single highest cross-runtime drift risk in the whole subsystem, so it is pinned here and mirrored verbatim into **ADR-2.SOLVE** (`docs/adr/NNNN-constraint-solve-semantics.md`), which MUST merge before any WP-2.5 or WP-2.7 code lands (TASK-2.5.0). Fixtures FIX-2.IK1, FIX-2.IK2, and FIX-2.TC lock it. A reimplementing runtime team builds against this section plus those fixtures, never against an unwritten convention.

### 5.1 Reconciling "solve constraints at step 3" with "world transforms at step 4"

The canonical per-frame order (§6) lists step 3 (solve constraints, IK then transform) and step 4 (world transforms, single forward pass; parents precede children) as distinct steps, and all runtimes must match it. The subtlety: IK and transform constraints need WORLD state at step 3, but the authoritative world transforms are computed at step 4.

The reconciliation, normative:

- **Constraints WRITE local transform deltas only.** They never write a world matrix directly. After all constraints have run, the LOCAL state of every bone fully encodes their effect.
- **Step 4 is a single, authoritative forward pass** over bones in stored order: for each bone, `world = parentWorld * compose(localTransform)`. Because constraints wrote only local, this pass is clean and unconditional, and parents precede children (the §6 bone-ordering invariant). The world matrices it produces are the final, rendered ones.
- **Step 3 obtains world state on demand** via `resolveWorld(bone)` (section 5.2), which is a pure function of CURRENT local state. It does not mutate step 4's work; it only reads. The world frame each constraint computes for an already-solved bone equals what step 4 will produce for that bone (modulo float), because both compose the same local transforms with the same routine.

This keeps the literal §6 step structure (step 3 then step 4) and keeps step 4 a single forward pass, while giving constraints the world state they need.

### 5.2 On-demand world resolution rule (`resolveWorld`)

`resolveWorld(bone) -> world 2x3 matrix` computes a bone's world matrix by composing its ancestor chain's CURRENT local transforms from the root down to `bone`:

- It reflects all animation timeline values applied in step 2 and every local delta written by constraints that solved EARLIER in step 3.
- It is a pure function of current local state: calling it twice with no intervening local write yields identical results. An implementation MAY memoize within a single frame, but the memoized value MUST equal a fresh root-to-bone walk.
- It uses the exact same affine `compose` routine as step 4. It allocates nothing (writes into a scratch matrix owned by the solver).

Chains are short (1 to 2 constrained bones plus a handful of ancestors), so the repeated ancestor walk is cheap and stays within the 60fps budget.

### 5.3 Constraint ordering

Constraints solve in the canonical order from §6: ALL IK constraints first (in their stored array order), then ALL transform constraints (in their stored array order). This order is part of the contract. Each constraint, when it runs, reads world state via `resolveWorld` that already reflects every earlier constraint's local writes. Determinism follows from the fixed array order plus the pure resolver.

### 5.4 IK constraint: channel space and write-back

IK reads WORLD positions and writes LOCAL rotation:

- Read `resolveWorld(target)` for the target world position, and `resolveWorld` of the chain root's parent (and, for two-bone, of the parent chain bone) for the world frame the chain starts in.
- One-bone (`solveIkOneBone`): rotate the single bone so its tip points at the target world position; express the result as a LOCAL rotation relative to the bone's parent world frame; blend the local rotation from its pre-IK value toward the IK solution by `mix` (0..1).
- Two-bone (`solveIkTwoBone`): solve the law of cosines for the two segment lengths (each `bone.length` scaled by that bone's world scale) to find the two world angles that place the chain tip at the target; `bendPositive` selects which of the two mirror solutions (elbow/knee direction); convert each world angle to a LOCAL rotation relative to that bone's parent world frame; blend each by `mix`. Clamp when the target is unreachable (straighten the chain toward the target) or too close (fold); no NaN may leave the solver.
- IK writes ONLY local rotation (it never writes translation, scale, or shear, and never a world matrix).

### 5.5 Transform constraint: channel space and write-back (WORLD-space)

The transform constraint operates in WORLD space, as Spine-class transform constraints do (this is general behavior, not Spine source). The spec:

- **Read WORLD channels of the target.** Decompose `resolveWorld(target)` into world channels: world rotation, world x, world y, world scaleX, world scaleY, world shearY (decomposition formula in section 5.6).
- **Read the constrained bone's would-be WORLD channels.** Decompose `resolveWorld(bone)` into the same six world channels.
- **Blend per channel in WORLD space.** For each channel `ch` in {rotate, x, y, scaleX, scaleY, shearY}: `worldCh = lerp(boneWorldCh, targetWorldCh, mixCh) + offsetCh`, where `mixCh` is the channel's mix factor (`mixRotate`, `mixX`, ...) and `offsetCh` is the channel's offset (`offsetRotation`, `offsetX`, ...). Channels are blended independently; blend order does not matter.
- **Recompose to a WORLD matrix**, then **write LOCAL.** Convert the blended world channels back to a world matrix via `composeWorld` (section 5.6), then convert that world matrix to the constrained bone's LOCAL transform against the bone's parent's already-resolved world matrix: `local = inverse(parentWorld) * blendedWorld`. Store the resulting local transform on the bone. Step 4 then recomputes the bone's world from this local, reproducing the blended world (modulo float).

So the rule is: **read world, blend in world, write local.** This keeps the "constraints write local only" invariant (section 5.1) uniform across IK and transform constraints, which is what makes step 4 a clean single pass.

Cycle rule: a constrained bone must not be an ancestor of its own target (no cycles); the validator rejects such constraints on import (WP-2.7). The target's world (and the bone's parent's world) must be resolvable before the constraint runs; the ordering in section 5.3 plus the no-cycle rule guarantee this.

### 5.6 Canonical 2D affine decomposition and recomposition

`decomposeWorld`/`composeWorld` are part of `runtime-core` and are reimplemented by every runtime. They MUST match the reference bit-for-bit within the conformance tolerance (section 11), not merely "be a valid decomposition." FIX-2.TC locks them. Both are first-principles QR-style affine decomposition (Law 4), not Spine source.

```text
Canonical 2D affine decomposition (runtime-core decomposeWorld), given a
world 2x2 with columns X' = (a, c) and Y' = (b, d), plus translation (tx, ty):
  rotation  = atan2(c, a)                  // radians; stored in degrees
  scaleX    = sqrt(a*a + c*c)
  det       = a*d - b*c
  scaleY    = det / scaleX                 // signed; carries reflection
  shearY    = atan2(a*b + c*d, det)        // radians
  x = tx, y = ty                           // translation passes through

Canonical recomposition (runtime-core composeWorld), the exact inverse:
  a = scaleX * cos(rotation)
  c = scaleX * sin(rotation)
  b = scaleY * (tan(shearY) * cos(rotation) - sin(rotation))
  d = scaleY * (tan(shearY) * sin(rotation) + cos(rotation))
  tx = x, ty = y
```

`shearY` is undefined as `shearY` approaches plus or minus 90 degrees (the `tan` term diverges); the validator rejects setup-pose or keyed shears in that degenerate range. This convention is self-consistent (a pure rotation decomposes to zero shear and unit scales; a Y-only shear of angle gamma decomposes to `shearY = gamma`).

### 5.7 Interaction-group coalescing (the basis for single-undo strokes)

§8.1's `History.execute` coalesces only when consecutive commands are less than 250ms apart. That time heuristic is NOT sufficient for strokes and drags: an animator who holds the pointer and pauses for more than 250ms mid-stroke would split the stroke into multiple undo steps. Phase 2 therefore relies on an explicit, session-scoped interaction-group API on `History`, established by TASK-2.1.0:

- `history.beginInteraction(label)` opens a group on pointer-down.
- While a group is open, each command of the matching kind is merged into the single open command via `coalesceWith`, regardless of elapsed time.
- `history.commitInteraction()` on pointer-up closes the group; the group is exactly one undo step. `history.cancelInteraction()` (for example on Escape) undoes and discards the open group.

The 250ms time-window coalescing from §8.1 is retained only for DISCRETE repeated value nudges that are not pointer interactions (arrow-key bumps, scroll-wheel value changes). All drags, strokes, and slider drags use interaction groups. This is the mechanism the acceptance criteria in WP-2.1, WP-2.4, WP-2.6, WP-2.7, and WP-2.9 depend on.

---

## 6. Work package map and sequencing

Dependencies flow left to right. A package may not start until its prerequisites are GREEN (Law 5 applied at the WP grain).

| WP | Title | Lands in | Depends on | Sub-milestone |
|---|---|---|---|---|
| WP-2.0 | Symbol-design deform validation spike | docs | Phase 1 green | gate |
| WP-2.1 | Mesh creation/editing (region to mesh, vertex/edge CRUD, triangulation, auto grid-fill, auto perimeter trace, interaction-group history) | `modules/mesh` (authoring), `History` (shared infra) | WP-2.0 | M2.a |
| WP-2.2 | runtime-core LBS skinning math + weighted-encoding codec/validator | `runtime-core` (solve), `packages/format` (codec + validator) | WP-2.1 | M2.b |
| WP-2.3 | Skinning / bone binding (bind mesh to bones, unweighted to weighted conversion) | `modules/mesh` | WP-2.2 | M2.b |
| WP-2.4 | Weight painting (brush, modes, normalize, cap 4, heat-map, auto-weight, stroke coalescing) | `modules/mesh` | WP-2.3 | M2.c |
| WP-2.5 | IK solve in runtime-core (one-bone + two-bone analytic) | `runtime-core` | Phase 1 green + ADR-2.SOLVE (parallel with WP-2.1) | M2.d |
| WP-2.6 | IK authoring in editor (constraint CRUD, target, bend gizmo, IK timelines) | `modules/constraints` | WP-2.5 | M2.d |
| WP-2.7 | Transform constraints (runtime-core solve + editor authoring + transform timelines) | `runtime-core`, `modules/constraints` | WP-2.5 (solve-order code) + ADR-2.SOLVE | M2.d |
| WP-2.8 | Skins (named attachment variants, skin CRUD, preview switch) | `modules/skeleton`/`modules/mesh` | Phase 1 green (region attachments); TASK-2.8.4 additionally WP-2.3 | M2.e |
| WP-2.9 | Deform timelines (per-vertex offsets, runtime apply after skinning, editor authoring + auto-key) | `runtime-core`, `modules/timeline`, `modules/mesh` | WP-2.2 + WP-2.1 (deform on unweighted mesh); weighted-mesh deform additionally WP-2.3 | M2.e |
| WP-2.10 | Conformance fixtures (six families) | `packages/conformance` | WP-2.2, WP-2.5, WP-2.7, WP-2.9 | M2.f |
| WP-2.11 | Editor + runtime-web integration and the DoD milestone rig | `runtime-web`, `apps/editor/viewport`, `packages/conformance` | all above | M2.exit |

Sub-milestones (each is a usable, demonstrable artifact):

- **M2.a** Mesh exists and edits: region to editable triangulated mesh, undoable as single-undo strokes.
- **M2.b** A mesh follows a single bone via the weighted encoding (rigid skin), solved in `runtime-core`, rendered in `runtime-web`.
- **M2.c** Weight painting produces smooth multi-bone deformation with normalized, capped weights.
- **M2.d** Two-bone IK and transform constraints solve in the correct solve-order slot per section 5, animatable.
- **M2.e** Skins and deform timelines author and play back.
- **M2.f** All six fixture families green in CI; editor and runtime-web agree within the conformance tolerance.

Suggested critical path: WP-2.1 -> WP-2.2 -> WP-2.3 -> WP-2.4 in series (mesh stack), with WP-2.5 -> WP-2.6/2.7 (constraint stack) developed in parallel because they touch disjoint code, and WP-2.8 basic skin CRUD startable right after Phase 1 (it needs only region attachments). WP-2.9 follows the mesh stack. WP-2.10 is incremental: add each fixture family the moment its runtime-core code is green, not at the end.

---

## 7. Work packages in detail

Each WP lists scope, the commands it introduces (Law 2), runtime-core additions (the no-PixiJS invariant), and independently verifiable acceptance criteria. Acceptance criteria are testable; no "etc."

### WP-2.1 Mesh creation and editing

**Scope.** Turn a `RegionAttachment` into a `MeshAttachment` (§6), then edit it. Provide automatic starting points so the artist is not hand-placing every vertex (§8.5 requirement). Establish the interaction-group history API (section 5.7) that all later drag/stroke commands depend on.

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.1.0 | Interaction-group history API (section 5.7): add `beginInteraction`/`commitInteraction`/`cancelInteraction` to `History`. Groups coalesce all matching commands regardless of elapsed time; commit yields one undo step. Generalizes the existing 250ms coalescing without replacing it. | Unit tests: a group of N commands with arbitrary inter-command delays (including delays over 250ms) commits to exactly one undo step; cancel restores the pre-group document deep-equal. |
| TASK-2.1.1 | Region-to-mesh generation: create a `MeshAttachment` whose hull is the 4 corners of the region quad, `uvs` mapped from the atlas region, `hullLength = 4`, default 2 triangles, `vertices` unweighted (flat `[x,y,...]` in slot-bone space, `bones` omitted per §6). | New mesh renders pixel-identical to the source region in `runtime-web` (same texels, same transform) at setup pose. |
| TASK-2.1.2 | Vertex CRUD: add an interior vertex (on a triangle, uv interpolated), move a vertex (drag, interaction group), delete a vertex (forbid deleting hull vertices that would open the polygon). MOVE does NOT re-triangulate (triangle indices stay stable); only ADD and DELETE re-triangulate. | Each operation is a Command with a passing do/undo round-trip; the drag coalesces to one undo step via its interaction group. |
| TASK-2.1.3 | Edge definition: store/edit `edges` (§6, editor wireframe display only) and use hull edges as triangulation constraints. | `edges` round-trips through save/load; wireframe overlay matches stored edges. |
| TASK-2.1.4 | Triangulation (AUTHORING-ONLY, editor `modules/mesh`): earcut on hull + interior points (§8.5). Deterministic output for a given vertex set and ordering. Wrap earcut behind a pure editor function `triangulate(hull, interior, edges)` returning `triangles: number[]`. `runtime-core` is NOT touched; runtimes never re-triangulate. | Same input vertex set yields identical `triangles` across runs (determinism unit test). Degenerate/collinear input fails loudly with a typed `MeshError`, not a silent empty mesh. |
| TASK-2.1.5 | AUTO grid-fill: given the region bounds and a cell size (UI param), generate a regular grid of interior vertices clipped to the hull, then triangulate. | One click produces a valid manifold mesh; vertex count scales with cell size as documented; result is undoable as a single Command. |
| TASK-2.1.6 | AUTO perimeter-trace (AUTHORING-ONLY): trace the alpha silhouette of the source sprite (marching-squares on the trimmed alpha mask from the atlas) to seed a hull, then simplify (Douglas-Peucker with a tolerance param) to a reasonable vertex count, then grid-fill the interior. Marching-squares and Douglas-Peucker live in editor `modules/mesh`. | Unit tests for marching-squares (known mask to known contour) and Douglas-Peucker (known polyline to known simplified set) pass; on a test sprite with transparent margins, the traced hull follows the opaque silhouette within the tolerance; produces a valid triangulation; single undoable Command. |
| TASK-2.1.7 | Mesh validation: no duplicate vertices, no zero-area triangles, hull is a simple polygon, every triangle index is in range, no sliver below a min-angle threshold (R2.3). Run on every mesh mutation and on import. | Invalid meshes are rejected with a typed `MeshError` discriminated union; the editor surfaces the reason; import of a malformed mesh fails loudly (Law 3). |
| TASK-2.1.8 | Topology-lock policy (prevents stale weights/deform, see item below): ADD and DELETE vertex (operations that change vertex count or order) are FORBIDDEN once a mesh is weighted (WP-2.3) OR has any deform keyframe in any animation (WP-2.9). MOVE vertex is always allowed (count/order stable). To re-topologize a weighted/deformed mesh, the artist must first `UnbindMesh` (clears weights, WP-2.3) and `ClearAttachmentDeform` (clears deform tracks for that attachment, WP-2.9); each is its own command with do/undo capturing the removed state. | An attempt to add/delete a vertex on a weighted or deformed mesh surfaces a typed `MeshError` and mutates nothing; after `UnbindMesh` + `ClearAttachmentDeform`, the same edit succeeds; the round-trip tests for `UnbindMesh` and `ClearAttachmentDeform` restore the prior weights/deform deep-equal. |

**Topology-lock rationale (reviewer item 8).** Add/move/delete that changes the vertex set would silently misalign two positional structures: the weighted `vertices` encoding (bound in WP-2.3) and deform keyframe `{ offsets: number[] }` arrays (WP-2.9), both indexed by vertex position. Rather than attempt fragile in-place remapping inside the topology command (which would also make its do/undo round-trip incorrect unless it captured and restored all dependent weight and deform state), Phase 2 FORBIDS count/order-changing topology edits on a weighted or deformed mesh and requires an explicit, undoable unbind/clear first. MOVE is exempt because it does not change count or order: a MOVE on a weighted mesh recomputes only that vertex's per-bone `(vx, vy)` so the bind pose stays consistent (captured in undo), and deform offsets (relative, length-stable) remain valid.

**Commands introduced:** `GenerateMeshFromRegion`, `AddMeshVertex`, `MoveMeshVertex` (interaction group), `DeleteMeshVertex`, `SetMeshEdges`, `AutoGridFillMesh`, `AutoPerimeterTraceMesh`. (Re-triangulation is an internal effect of add/delete, captured in their undo state, not a separate user command.)

**Authoring utilities (NOT `runtime-core`, NOT reimplemented by runtimes):** `triangulate()` (earcut), marching-squares silhouette tracing, Douglas-Peucker simplification. These need the source bitmap (which runtimes do not have) and a triangulation dependency (which `runtime-core` must not carry). The runtime never re-triangulates; it consumes the committed `triangles` array. WP-2.1 adds NOTHING to `runtime-core` except the shared `History` interaction-group API (TASK-2.1.0), which is editor infrastructure, not solve code.

**Verification (independent):** `pnpm --filter @marionette/editor test modules/mesh` green; manual: load a region, click "Auto grid-fill", get a triangulated mesh, move a vertex, undo, redo, save, reload, mesh is identical.

---

### WP-2.2 runtime-core linear blend skinning + weighted-encoding codec/validator

**Scope.** The standard 2D LBS math (§8.5) in `runtime-core`, plus the encode/decode and validation of the §6 weighted vertex format in `packages/format`. This is load-bearing and TypeScript-strict with no `any` and no unjustified `as` (Invariant, §11).

**Where things live (Law 3, reviewer item 2).** The weighted-vertex codec (`encodeWeightedVertices`/`decodeWeightedVertices`) and the weighted-encoding VALIDATOR RULES live in `packages/format`, the contract owner. This means `packages/format` WILL receive additive commits in Phase 2. That is expected and is NOT a Law 3 violation: Law 3 forbids BREAKING changes (removed/changed fields, `formatVersion` bumps without ADR), not additive code for a §6 structure that is first authored now. The skinning SOLVE (`solveSkin`) lives in `runtime-core`.

**Pre-task (ADR-2.WEIGHTED, MUST merge before TASK-2.2.1):**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.2.0 | Resolve the §6 contract ambiguity: what does `MeshAttachment.bones` contain, given `boneIndex` is already inline in the weighted `vertices` encoding? The §6 comment says weighted meshes set `bones` present and put `[boneCount, (boneIndex, vx, vy, weight) * boneCount]` inline in `vertices`. Pin whether `bones` is a discriminator-only flag, a per-vertex bone-count list, or a separate flat index list. Record the decision in ADR-2.WEIGHTED (`docs/adr/NNNN-weighted-vertex-encoding.md`). This is DELIBERATE format-spec work, not a zero-change clarification: it determines codec and validator behavior and is part of completing the contract. If the resolution requires a schema change, bump `formatVersion` in the same ADR (Law 3 STOP-and-ADR). | ADR-2.WEIGHTED states the canonical interpretation; the codec, validator, and fixtures all follow it. No codec or validator code is written against an unpinned contract. ADR merged before TASK-2.2.1. |

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.2.1 | Weighted-encoding codec in `packages/format`: `encodeWeightedVertices(perVertexBindings) -> { vertices, bones }` and `decodeWeightedVertices(mesh) -> perVertexBindings`. Round-trip identity. | `decode(encode(x))` deep-equals `x` for randomized fuzz inputs (1 to 4 influences/vertex). |
| TASK-2.2.2 | Weighted-encoding validator rules in `packages/format` (additive, backward compatible): confirm `boneCount` headers are consistent with payload length, every `boneIndex` is in range, every vertex has 1 to `MAX_BONE_INFLUENCES` (4) influences, weights are finite. Pre-Phase-2 documents (no weighted meshes) still validate unchanged. | Malformed weighted meshes are rejected loudly with a typed error on import; a property test confirms all committed Phase 1 golden documents still validate (backward compatibility). |
| TASK-2.2.3 | `solveSkin(mesh, boneWorldMatrices, outVertices)` in `runtime-core`: for each vertex, `pos = sum over influences of weight * (boneWorldMatrix * (vx, vy))`. Writes into a caller-provided pre-allocated `Float32Array` (no allocation, Invariant 60fps). | Unit test: a 1-bone rigid skin reproduces the bone transform exactly; a 2-bone 50/50 weight lands at the average of the two bone-space transforms. |
| TASK-2.2.4 | Unweighted fast path: meshes with `bones` omitted skin as flat `[x,y]` in slot-bone space transformed by the slot bone's world matrix only. Covered by FIX-2.RM (WP-2.10). | Unweighted mesh result equals applying the slot bone world matrix to each `[x,y]`. |
| TASK-2.2.5 | Determinism + numerical contract: define the accumulation order (by influence order as stored) and the float type so all runtimes match. Reference the pinned conformance tolerance (section 11). | A fixture-style test serializes skinned vertices for a known rig and asserts stability across runs. |

**Constant (reviewer item 3).** `MAX_BONE_INFLUENCES = 4` is a pinned `packages/format` constant (the standard runtime-cost cap), enforced by the codec and validator. It is NOT document state and NOT a command. Making it document-configurable would require a new `formatVersion` field and is therefore out of scope unless taken through STOP-and-ADR.

**Commands introduced:** none (pure runtime-core solve + format codec; binding is WP-2.3).

**runtime-core additions:** `solveSkin` (solve-order step 5, BEFORE deform). No PixiJS, no `math-bridge`, no `any`.

**Verification:** `pnpm --filter @marionette/runtime-core test` and `pnpm --filter @marionette/format test` green; codec fuzz test green; backward-compat validator test green.

---

### WP-2.3 Skinning / bone binding

**Scope.** Editor flow to bind a mesh to one or more bones and convert an unweighted mesh to the weighted encoding (§8.5 sub-tool 2, cross-ref WP-2.2 codec).

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.3.1 | Bind mesh to a bone set: select a mesh and N bones; produce weighted vertices. Initial weights are a placeholder (rigid to nearest bone, or equal split) so the mesh is immediately skinnable; real weights come from WP-2.4. | After bind, the mesh is weighted-encoded (`bones` present), the document validates, and the mesh still renders in the same setup-pose position (binding must not move geometry). |
| TASK-2.3.2 | Unweighted-to-weighted conversion preserves setup pose: each vertex's bone-local `(vx, vy)` is computed by inverse-transforming the setup world position through each bound bone's setup world matrix. | Round-trip: with all bones at setup pose, `solveSkin` reproduces the original unweighted positions within the conformance tolerance. |
| TASK-2.3.3 | Rebind / add bone / remove bone from an existing weighted mesh, re-normalizing affected vertices. | Each is a Command with do/undo round-trip; removing a bone drops its influence and re-normalizes so weights still sum to 1. |
| TASK-2.3.4 | Bind safety: forbid binding to a bone not in the document; cap influences at `MAX_BONE_INFLUENCES` (4) at bind time when more than 4 bones are selected (keep the 4 nearest, warn). | Binding to more than 4 bones yields exactly 4 influences per vertex; an over-cap attempt surfaces a typed warning, not a silent truncation. |
| TASK-2.3.5 | `UnbindMesh`: clears all weights, returning the mesh to the unweighted flat encoding (re-deriving `[x,y]` from the current setup pose). Required by the topology-lock policy (TASK-2.1.8). Forbidden if the mesh still has deform keyframes (clear those first). | `UnbindMesh` Command with do/undo round-trip restoring the weighted encoding deep-equal; the unbound mesh renders identically at setup pose. |

**Commands introduced:** `BindMeshToBones`, `AddBoneToMeshBinding`, `RemoveBoneFromMeshBinding`, `UnbindMesh`.

**Cross-ref Law 3:** the on-disk shape is exactly the §6 weighted encoding; no new fields.

**Verification:** bind a 2-corner mesh to two bones, move one bone in setup pose, see the mesh follow per the placeholder weights; undo restores exactly; unbind returns it to the flat encoding.

---

### WP-2.4 Weight painting

**Scope.** The genuinely hard, genuinely scoped sub-tool. Ship basic-but-correct per §10: brush with size/strength, add/subtract/smooth modes, per-bone heat-map, auto-normalization (weights per vertex sum to 1), `MAX_BONE_INFLUENCES` (4) cap, auto-weight-from-bone-proximity as a starting point, and stroke coalescing into single undo steps via interaction groups (section 5.7). **Do not gold-plate** (no gradient ramps, no per-vertex lock UI, no falloff-curve editor in Phase 2).

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.4.1 | Auto-weight from bone proximity: seed weights by inverse-distance to each bound bone's line SEGMENT (distance to the segment, not just the origin), capped to 4 nearest, then normalized. This is the starting point so manual paint is touch-up not from-scratch (§10 mitigation). The distance-to-segment function is pure and unit-tested. | Unit test for distance-to-bone-segment (known points to known distances) passes; one click "Auto-weight" on a bound mesh produces a normalized, capped weight set; the limb deforms plausibly without any manual paint. |
| TASK-2.4.2 | Brush mechanics: circular brush with radius (size) and strength; affects vertices within radius with distance falloff; modes add / subtract / smooth (smooth averages a vertex's active-bone weight toward its neighbors). | Painting add on the active bone raises that bone's weight on covered vertices; subtract lowers it; smooth reduces local variance. All three are observable in the heat-map. |
| TASK-2.4.3 | Auto-normalization: after any brush dab, re-normalize each touched vertex so its influences sum to 1, preserving relative proportions of the non-active bones. | Invariant test: for every vertex after any stroke, sum of weights == 1 within the conformance tolerance, and influence count <= 4. |
| TASK-2.4.4 | Max-influence cap (4): when a paint would introduce a 5th influence, drop the smallest and renormalize to honor `MAX_BONE_INFLUENCES`. | No vertex ever exceeds 4 influences; a property-based test over random strokes holds the cap. |
| TASK-2.4.5 | Per-bone heat-map view: color vertices/mesh by the active bone's weight (0 = cold, 1 = hot). Editor-state only (active bone, view mode are Zustand, not document). | Selecting a different bone updates the heat-map; toggling heat-map off restores normal render; no document mutation occurs from viewing. |
| TASK-2.4.6 | Stroke coalescing: a paint stroke (pointer-down to pointer-up, an interaction group per section 5.7) is many dabs but exactly ONE undo step. Time-window coalescing is NOT used; the group is bounded by pointer-down/pointer-up so a mid-stroke pause of any length stays one stroke. | After a 200-dab stroke that includes a deliberate pause longer than 250ms, a single undo fully reverts the stroke to the pre-stroke weights (do/undo round-trip on the coalesced `PaintWeightStroke`). |

**Commands introduced:** `AutoWeightFromProximity`, `PaintWeightStroke` (interaction group), `NormalizeMeshWeights`. (No `SetMaxInfluences`: the cap is the pinned constant, not document state, see WP-2.2.)

**Explicitly deferred (anti-gold-plating):** gradient/linear weight tools, mirror-paint across an axis, weight copy between meshes, per-vertex weight table editing UI. Revisit only if production animators hit a wall.

**Verification:** `pnpm --filter @marionette/editor test modules/mesh` includes the sum-to-1 and cap-<=4 property tests and the distance-to-segment unit test; manual: auto-weight, paint a stroke (with a pause), single undo reverts it, heat-map reflects changes.

---

### WP-2.5 IK solve in runtime-core (one-bone and two-bone analytic)

**Scope.** Closed-form analytic IK (§8.6) per the solve-semantics spec (section 5.4): one-bone (point the bone at the target) and two-bone (law of cosines with a bend direction). Chain IK (FABRIK/CCD) is DEFERRED (§8.6) and out of scope unless a game needs long chains; recorded as a non-goal (section 15).

**Pre-task (ADR-2.SOLVE, MUST merge before TASK-2.5.1):**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.5.0 | Author ADR-2.SOLVE (`docs/adr/NNNN-constraint-solve-semantics.md`) mirroring section 5 verbatim: the on-demand world resolution rule (`resolveWorld`), constraints-write-local-only, IK channel space (read world, write local rotation), transform-constraint channel space (read world, blend world, write local), the canonical decompose/recompose, and constraint ordering. This lands BEFORE any WP-2.5 or WP-2.7 code so Unity/Godot have a written spec, not a fixture alone. | ADR-2.SOLVE merged; section 5 and the ADR are identical; reviewers sign off on the world-resolution and channel-space rules. |

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.5.1 | `solveIkOneBone(bone, targetWorld, mix)`: rotate the bone so its tip points at the target (target obtained via `resolveWorld`), write the result as a LOCAL rotation blended by `mix` (0..1). Covered by FIX-2.IK1. | Unit test: with mix=1 the bone's tip direction equals the bone-to-target direction; with mix=0 the bone is unchanged. |
| TASK-2.5.2 | `solveIkTwoBone(parent, child, targetWorld, bendPositive, mix)`: law-of-cosines solution; `bendPositive` selects elbow/knee direction; world angles converted to LOCAL rotations (section 5.4); clamp when target is unreachable (straighten toward target) or too close (fold). Covered by FIX-2.IK2. | Unit tests: reachable target places the tip at the target within tolerance; `bendPositive` true vs false produces mirrored elbow positions; unreachable target straightens the chain pointing at the target; mix blends between IK and FK pose; no NaN leaves the solver. |
| TASK-2.5.3 | Solve-order placement per section 5: IK solves at step 3 using `resolveWorld` for on-demand world state, writes LOCAL rotation deltas, and the authoritative single forward world pass (step 4) follows. No constraint writes a world matrix. | A test rig with an IK chain produces identical bone world transforms whether solved via the editor or `runtime-core` directly; the order matches the committed solve order (locked by FIX-2.IK1/FIX-2.IK2). |
| TASK-2.5.4 | Determinism and `transformMode` interaction: define behavior when a constrained bone has a non-`normal` `transformMode`. Pin it (do not leave implementation-defined) and cover with a test. | The chosen behavior is documented in ADR-2.SOLVE and locked by a fixture; no `any`, no unjustified `as`. |

**Commands introduced:** none (pure runtime-core). Authoring is WP-2.6.

**runtime-core additions:** `resolveWorld`, `decomposeWorld`/`composeWorld` (shared with WP-2.7), `solveIkOneBone`, `solveIkTwoBone`. No PixiJS, no `math-bridge`. Law 4: comments cite the law of cosines and QR-style affine decomposition, not Spine.

**Verification:** `pnpm --filter @marionette/runtime-core test` green with the reachability/bend/mix/unreachable cases above.

---

### WP-2.6 IK authoring in editor

**Scope.** Create and edit `IkConstraint` (§6) in the editor, with a target-bone gizmo and bend-direction control, and make IK params animatable via the `ik` timeline (§6 `Animation.ik`).

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.6.1 | Create IK constraint: select 1 or 2 chain bones + a target bone, produce an `IkConstraint` (`name`, `bones`, `target`, `mix`, `bendPositive`). Validate bones exist, chain length is 1 or 2, and the target is not an ancestor of a chain bone (no cycle, section 5.5). | `CreateIkConstraint` Command with do/undo round-trip; document validates; constraint appears in the hierarchy/inspector. |
| TASK-2.6.2 | Target gizmo: dragging the target bone re-solves the chain live in the viewport (using WP-2.5). The drag is an interaction group. | Dragging the target visibly bends the limb at 60fps; the drag coalesces to one undo step. |
| TASK-2.6.3 | Bend-direction toggle and mix slider, both as Commands (the slider drag is an interaction group). | Toggling `bendPositive` flips the elbow; `mix` blends; both undoable. |
| TASK-2.6.4 | IK timelines: in animation mode, keying `mix`/`bendPositive` writes `Keyframe<IkFrame>[]` into `Animation.ik[name]` (§6). Runtime samples these in solve step 2 before the IK solve in step 3. `bendPositive` is a boolean and is NON-interpolatable: it is sampled STEPPED regardless of the keyframe's curve type, in all runtimes (locked by FIX-2.IK2). | An animation that ramps `mix` 0 to 1 plays identically in editor and `runtime-web`; a `bendPositive` flip occurs as a clean step at its keyframe time, never interpolated. |

**Commands introduced:** `CreateIkConstraint`, `SetIkMix` (slider interaction group), `SetIkBendPositive`, `DeleteIkConstraint`, `SetIkKeyframe`, `DeleteIkKeyframe`.

**Verification:** create a two-bone IK on the milestone limb, drag the target, key a mix ramp, play it; undo/redo clean.

---

### WP-2.7 Transform constraints

**Scope.** Drive a bone's channels from a target with per-channel mix factors and offsets, in WORLD space (§6 `TransformConstraint`, §8.6, solve-semantics section 5.5). Solved at step 3 AFTER IK (§6 solve order: IK then transform). Requires ADR-2.SOLVE (TASK-2.5.0).

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.7.1 | `solveTransformConstraint(constraint, bones, targetWorld)` in `runtime-core` per section 5.5: decompose the target's WORLD transform (`resolveWorld(target)`) and the constrained bone's would-be WORLD transform into the six world channels (rotate, x, y, scaleX, scaleY, shearY); blend each in WORLD space by its `mix*` factor plus `offset*`; recompose to a world matrix; write the constrained bone's LOCAL transform via `inverse(parentWorld) * blendedWorld`. | Unit tests per channel: `mixRotate=1, offsetRotation=0` makes the bone's WORLD rotation track the target; `mixX=0.5` half-follows in world x; offsets apply additively in world space; the written value is local and reproduces the blended world after step 4. |
| TASK-2.7.2 | Solve-order: transform constraints run after IK, before the world-transform pass. Confirm ordering with a rig that has both IK and a transform constraint on related bones (FIX-2.TC). | Result is order-stable and matches the committed solve order; a swapped order would produce a different (failing) fixture. |
| TASK-2.7.3 | Editor authoring: create/edit a `TransformConstraint` (all six mix and six offset fields), validate target/bones exist and there is no cycle (section 5.5). | `CreateTransformConstraint` + `SetTransformConstraintParams` Commands with do/undo round-trips; document validates. |
| TASK-2.7.4 | Transform timelines: animate mix factors via `Animation.transform[name]` (`Keyframe<TransformFrame>[]`, §6), sampled in solve step 2. | A mix ramp on a transform constraint plays identically in editor and runtime-web. |

**Commands introduced:** `CreateTransformConstraint`, `SetTransformConstraintParams` (slider interaction group), `DeleteTransformConstraint`, `SetTransformKeyframe`, `DeleteTransformKeyframe`.

**runtime-core additions:** `solveTransformConstraint` (solve step 3, after IK), reusing `resolveWorld` and `decomposeWorld`/`composeWorld` from WP-2.5. No PixiJS, no `math-bridge`.

**Verification:** `runtime-core` per-channel tests green; editor demo: secondary bone follows a driver via world rotate mix; animatable.

---

### WP-2.8 Skins (named attachment variants)

**Scope.** Named skins (§6 `Skin`): a skin maps `slot -> attachmentName -> Attachment`. Supports symbol variants (color/shape swaps) without separate documents. Basic skin CRUD over region attachments needs only Phase-1 work; only TASK-2.8.4 (weighted meshes in skins) depends on WP-2.3, so this WP can start in parallel right after Phase 1.

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.8.1 | Skin CRUD: create, rename, delete a skin; `default` always exists and cannot be deleted. | Commands with do/undo round-trips; deleting a non-default skin removes only its attachment entries; document validates. |
| TASK-2.8.2 | Place an attachment (region or mesh) into a specific skin under a slot/attachment key. | `SetSkinAttachment` Command; the same slot can resolve different attachments per active skin. |
| TASK-2.8.3 | Active-skin preview: switching the previewed skin is EDITOR state (Zustand), not a document mutation (§8.2 wall). Runtime resolves attachments through the active skin then `default` fallback. | Switching preview skins changes the viewport without creating an undo entry; `runtime-web` resolves identically. |
| TASK-2.8.4 | Weighted meshes in non-default skins still skin correctly (the mesh in a variant skin can be its own weighted attachment). Depends on WP-2.3. | A two-skin rig where each skin has a distinct weighted mesh on the same slot skins correctly in both. |

**Commands introduced:** `CreateSkin`, `RenameSkin`, `DeleteSkin`, `SetSkinAttachment`, `RemoveSkinAttachment`. (Active-skin selection is editor state, not a Command.)

**Verification:** create a "red" and "blue" skin variant, switch preview, export, runtime-web shows the active skin; undo/redo on skin edits clean.

---

### WP-2.9 Deform timelines

**Scope.** Per-vertex offsets at keyframes (§6 `DeformTimelines`), interpolated and added AFTER skinning by the runtime (solve order step 5: skin meshes THEN apply deform offsets). Deform on an unweighted mesh needs only WP-2.1 + WP-2.2; deform on a weighted mesh additionally needs WP-2.3.

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.9.1 | `applyDeform(skinnedVertices, deformOffsets, outVertices)` in `runtime-core`: add interpolated per-vertex `(dx, dy)` offsets to the post-skin positions. Offsets are sampled and interpolated by the timeline (linear/stepped/bezier curve per keyframe). Writes into a pooled buffer (no allocation). | Unit test: zero offsets leave skinned positions unchanged; a constant offset translates the mesh; interpolation between two deform keys is linear/bezier as specified. |
| TASK-2.9.2 | Solve-order correctness: deform is applied AFTER skinning, never before (§6 step 5). A rig that both skins and deforms produces skin-then-add, verified against the order (FIX-2.DF). | A fixture asserts deform-after-skin; applying deform before skin would change results and fail the fixture. |
| TASK-2.9.3 | Editor authoring: in animation mode, moving mesh vertices writes/updates a deform keyframe at the playhead (auto-key, §8.7), storing per-vertex `offsets` relative to the setup mesh (§6 `{ offsets: number[] }`). The vertex drag is an interaction group. | `SetDeformKeyframe` Command with do/undo round-trip; offsets are relative to setup mesh, not absolute; the vertex drag during deform coalesces into one undo step. |
| TASK-2.9.4 | Deform timelines are keyed per skin -> slot -> attachment (§6 nested record). Switching skins shows the correct deform track. | Deform on a mesh in the "red" skin does not bleed into the "blue" skin's mesh. |
| TASK-2.9.5 | Curve support: deform keyframes honor linear, stepped, and bezier curve types (reuse Phase 1 curve sampling). | A bezier-eased deform key interpolates per the curve; matches between editor and runtime-web. |
| TASK-2.9.6 | `ClearAttachmentDeform`: remove all deform keyframes for one attachment across all animations and skins. Required by the topology-lock policy (TASK-2.1.8) so a mesh can be re-topologized. | `ClearAttachmentDeform` Command with do/undo round-trip restoring the removed deform tracks deep-equal. |

**Commands introduced:** `SetDeformKeyframe` (vertex-drag interaction group), `DeleteDeformKeyframe`, `MoveDeformKeyframe`, `ClearAttachmentDeform`.

**runtime-core additions:** `applyDeform` (solve step 5, after `solveSkin`). No PixiJS, no `math-bridge`, pooled buffers.

**Verification:** key two deform poses on the milestone mesh, scrub, see smooth interpolation; same in runtime-web; undo/redo clean.

---

### WP-2.10 Conformance fixtures (cross-runtime contract)

**Scope.** Six NEW fixture families, GENERATED FROM `runtime-core` (the behavioral source of truth), committed, and run in CI within the pinned conformance tolerance (section 11). These are how Unity/Godot stay honest later (§8.11). Per the fixtures-from-runtime-core invariant, EVERY `runtime-core` solve path is fixture-locked, including the one-bone IK and unweighted (rigid) skinning fast path. Add each fixture the moment its runtime-core code is green, not at the end.

| ID | Fixture | Exercises | Sampled outputs |
|---|---|---|---|
| FIX-2.RM | `rigid-mesh-rig` | An UNWEIGHTED mesh (`bones` omitted) on a single moving bone, exercising the `solveSkin` fast path (TASK-2.2.4). | Skinned vertex positions at N times. |
| FIX-2.W | `weighted-mesh-rig` | A mesh bound to 2+ bones with multi-influence weights; bones animated. | Bone world transforms + skinned vertex positions at N times. |
| FIX-2.IK1 | `one-bone-ik-rig` | A one-bone IK constraint (TASK-2.5.1) with a moving target and a `mix` ramp. | Bone world transforms (post-IK, post-world-pass) at N times. |
| FIX-2.IK2 | `two-bone-ik-rig` | A two-bone IK chain with a moving target, `bendPositive` both values (stepped), a `mix` ramp, and unreachable-target frames. | Bone world transforms at N times, including unreachable-target frames. |
| FIX-2.TC | `transform-constraint-rig` | A WORLD-space transform constraint driving a bone from a target with per-channel mix + offset, plus an IK on a related bone to lock IK-then-transform order and the decompose/recompose. | Bone world transforms at N times. |
| FIX-2.DF | `deform-rig` | A weighted mesh with a deform timeline (linear + bezier keys), to lock skin-then-deform order. | Final (skinned + deformed) vertex positions at N times. |

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.10.1 | Author the six reference rigs as small format documents under `packages/conformance/rigs/`. Each validates against the format schema. | Schema-valid; minimal; each isolates one feature plus the minimum to exercise solve order. |
| TASK-2.10.2 | Generator: a `runtime-core`-driven script samples each rig at the specified times and writes expected-output JSON to `packages/conformance/fixtures/`. | Running the generator twice yields byte-identical fixtures (determinism). Regeneration is a deliberate, reviewed commit (Invariant). |
| TASK-2.10.3 | CI harness: `runtime-web` (and `runtime-core`) load each rig, sample, and assert equality to the committed fixtures using the pinned tolerance and per-channel comparison rule (section 11). | CI job is RED if any runtime drifts past tolerance; PRs cannot merge red (convention). |
| TASK-2.10.4 | Document the regeneration ritual: changing skinning/IK/deform/transform/decompose behavior requires regenerating fixtures with reviewer approval. | A `packages/conformance/README.md` section states the ritual; a drift without regeneration fails CI. |

**Law call-outs:** fixtures encode the committed solve order (constraints before world transforms; IK before transform; deform after skinning) and the world-resolution/channel-space rules of section 5. They are the contract that Unity/Godot reimplementations validate against (§8.11). They are generated from `runtime-core`, never hand-edited.

**Verification:** `pnpm --filter @marionette/conformance test` green; intentionally perturbing a solve constant turns CI red.

---

### WP-2.11 Editor + runtime-web integration and the DoD milestone rig

**Scope.** Assemble the actual milestone deliverable and prove editor/runtime parity (§8.3 shared renderer).

**Tasks.**

| ID | Task | Acceptance |
|---|---|---|
| TASK-2.11.1 | Build the DoD rig (from TASK-2.0.3): a character with a weighted mesh limb, a two-bone IK on that limb, and a deform timeline, plus an idle/wave animation. | The rig is committed under `packages/conformance/assets/` and authored entirely through Commands. |
| TASK-2.11.2 | Render the rig in the editor viewport (which imports `runtime-web`, §8.3) and in a standalone `runtime-web` page from the EXPORTED document. Because the editor and `runtime-web` share the SAME solve and renderer code path, the sampled solve output (bone world transforms, skinned+deformed vertex positions) is identical within the conformance tolerance (in practice bit-identical on the same machine). Pixel-diff tolerance applies ONLY to rasterization differences (anti-aliasing, sub-pixel timing), never to solve output. | Sampled-vertex and world-transform diff between editor and runtime-web is within the conformance tolerance; the optional visual A/B pixel-diff is within the rasterization tolerance. |
| TASK-2.11.3 | 60fps check: the milestone rig solves + renders at 60fps in the viewport with no per-frame allocation in the skin/IK/transform/deform/render loop (Invariant). | A profiling run shows steady 60fps and a flat allocation graph during playback (section 13 budget). |
| TASK-2.11.4 | Save/load/undo/redo full round-trip on the milestone rig (all Phase 2 features). | Save, reload, deep-equal `DocumentModel`; undo to empty and redo to full both succeed. |

**Verification:** the section 14 acceptance script passes end to end.

---

## 8. runtime-core additions (consolidated, the no-PixiJS surface)

**Table A: the `runtime-core` solve surface (reimplemented by Unity/Godot).** All of these are pure, platform-agnostic, TypeScript-strict (no `any`, no unjustified `as`, no `math-bridge`), allocation-free in the per-frame path, and placed at their exact solve-order slot.

| Function | Solve-order step | Signature intent | WP |
|---|---|---|---|
| `resolveWorld(bone)` | step 3 (on-demand, section 5.2) | compose ancestor chain to a world 2x3 | WP-2.5 |
| `decomposeWorld(m)` / `composeWorld(ch)` | step 3 (section 5.6) | QR-style affine decompose/recompose | WP-2.5 |
| `solveIkOneBone(bone, targetWorld, mix)` | step 3 (constraints, IK) | rotate-to-target, write local rotation | WP-2.5 |
| `solveIkTwoBone(parent, child, targetWorld, bendPositive, mix)` | step 3 (constraints, IK) | law-of-cosines two-bone, write local rotation | WP-2.5 |
| `solveTransformConstraint(c, bones, targetWorld)` | step 3 (constraints, transform, AFTER IK) | read world, blend world, write local (section 5.5) | WP-2.7 |
| world-transform forward pass | step 4 (single forward pass) | `world = parentWorld * compose(local)`; parents precede children | Phase 1 (G2.3), extended by section 5.1 |
| `solveSkin(mesh, boneWorldMatrices, out)` | step 5 (skin meshes) | LBS into pooled buffer | WP-2.2 |
| `applyDeform(skinned, offsets, out)` | step 5 (AFTER skin) | add interpolated offsets | WP-2.9 |

**Table B: authoring-only or format-consumption (NOT a runtime-core solve step).**

| Function | Where it lives | Reimplemented by runtimes? |
|---|---|---|
| `triangulate(hull, interior, edges)` (earcut) | editor `modules/mesh` | No. Runtimes consume the committed `triangles`; they never re-triangulate. earcut never enters `runtime-core`. |
| marching-squares silhouette trace, Douglas-Peucker | editor `modules/mesh` | No. Authoring-only; needs the source bitmap. |
| `encodeWeightedVertices` | `packages/format` | No. Authoring/contract-owner side. |
| `decodeWeightedVertices` | `packages/format` (TS reference) | Yes, as FORMAT CONSUMPTION, not a solve step: runtimes implement reading the §6 weighted encoding per ADR-2.WEIGHTED to feed `solveSkin`. |

The per-frame solve loop after Phase 2 (must match §6 exactly across all runtimes):

1. Reset all bones to setup pose.
2. Apply animation timelines (bone transforms; slot colors/attachments; sampled IK/transform-constraint params; sampled deform offsets; draw order; events). `bendPositive` is sampled stepped.
3. Solve constraints in order (section 5): IK (`solveIkOneBone`/`solveIkTwoBone`), then transform (`solveTransformConstraint`). Each constraint obtains world state via `resolveWorld` and writes LOCAL deltas only.
4. Compute world transforms (single authoritative forward pass; parents precede children). Because step 3 wrote only local, this pass is clean.
5. Skin meshes (`solveSkin`), then apply deform offsets (`applyDeform`).
6. Render in draw order with per-slot blend mode and color.

Steps 3 and 4 are logically distinct (the observable contract) and are realized so that every constraint's effect is visible in the step-4 world transforms of the bones it influences, exactly as section 5 specifies.

---

## 9. Format-contract touchpoints (Law 3 ledger)

Phase 2 makes **no breaking change** to the format. Existing §6 types fully cover the work. `packages/format` does receive ADDITIVE, backward-compatible code (the weighted-vertex codec and the weighted-encoding validator rules), which is expected and is not a Law 3 violation.

| Capability | §6 type used | Breaking field change? | Additive code in packages/format? |
|---|---|---|---|
| Mesh creation/edit | `MeshAttachment` (`uvs`, `triangles`, `hullLength`, `edges`, `vertices`) | No | No (authoring lives in the editor) |
| Skinning | `MeshAttachment.bones` + weighted `vertices` encoding | No (pending ADR-2.WEIGHTED interpretation) | Yes: codec + weighted validator rules (additive) |
| IK | `IkConstraint` + `Animation.ik` | No | No |
| Transform constraints | `TransformConstraint` + `Animation.transform` | No | No |
| Skins | `Skin` | No | No |
| Deform | `DeformTimelines` (`Animation.deform`) | No | No |
| Influence cap | `MAX_BONE_INFLUENCES` constant (4) | No (constant, not a field) | Yes: the constant + enforcement (additive) |

Two ADRs gate the phase:

- **ADR-2.WEIGHTED** (TASK-2.2.0): pins the semantics of `bones` vs the inline weighted `vertices` encoding. This is deliberate format-spec work, not a non-change. If it concludes the contract must change, it is a `formatVersion` bump executed as one reviewed change with validator + fixtures updated together.
- **ADR-2.SOLVE** (TASK-2.5.0): pins constraint solve semantics (section 5). It changes no format fields; it specifies behavior that all runtimes must reproduce.

No silent field additions. The STOP-and-ADR rule (section 3) governs any genuine new requirement.

---

## 10. Command inventory (Law 2: every mutation is a command, every command has a do/undo round-trip test)

34 commands. Coalescing, where present, is the interaction-group mechanism (section 5.7) bounded by pointer-down/pointer-up, not the 250ms time window.

| # | Command | WP | Coalesces? | do/undo round-trip test required |
|---|---|---|---|---|
| 1 | `GenerateMeshFromRegion` | 2.1 | No | Yes |
| 2 | `AddMeshVertex` | 2.1 | No | Yes |
| 3 | `MoveMeshVertex` | 2.1 | Interaction group (drag) | Yes |
| 4 | `DeleteMeshVertex` | 2.1 | No | Yes |
| 5 | `SetMeshEdges` | 2.1 | No | Yes |
| 6 | `AutoGridFillMesh` | 2.1 | No | Yes |
| 7 | `AutoPerimeterTraceMesh` | 2.1 | No | Yes |
| 8 | `BindMeshToBones` | 2.3 | No | Yes |
| 9 | `AddBoneToMeshBinding` | 2.3 | No | Yes |
| 10 | `RemoveBoneFromMeshBinding` | 2.3 | No | Yes |
| 11 | `UnbindMesh` | 2.3 | No | Yes |
| 12 | `AutoWeightFromProximity` | 2.4 | No | Yes |
| 13 | `PaintWeightStroke` | 2.4 | Interaction group (stroke) | Yes |
| 14 | `NormalizeMeshWeights` | 2.4 | No | Yes |
| 15 | `CreateIkConstraint` | 2.6 | No | Yes |
| 16 | `SetIkMix` | 2.6 | Interaction group (slider) | Yes |
| 17 | `SetIkBendPositive` | 2.6 | No | Yes |
| 18 | `DeleteIkConstraint` | 2.6 | No | Yes |
| 19 | `SetIkKeyframe` | 2.6 | No | Yes |
| 20 | `DeleteIkKeyframe` | 2.6 | No | Yes |
| 21 | `CreateTransformConstraint` | 2.7 | No | Yes |
| 22 | `SetTransformConstraintParams` | 2.7 | Interaction group (slider) | Yes |
| 23 | `DeleteTransformConstraint` | 2.7 | No | Yes |
| 24 | `SetTransformKeyframe` | 2.7 | No | Yes |
| 25 | `DeleteTransformKeyframe` | 2.7 | No | Yes |
| 26 | `CreateSkin` | 2.8 | No | Yes |
| 27 | `RenameSkin` | 2.8 | No | Yes |
| 28 | `DeleteSkin` | 2.8 | No | Yes |
| 29 | `SetSkinAttachment` | 2.8 | No | Yes |
| 30 | `RemoveSkinAttachment` | 2.8 | No | Yes |
| 31 | `SetDeformKeyframe` | 2.9 | Interaction group (vertex drag in anim mode) | Yes |
| 32 | `DeleteDeformKeyframe` | 2.9 | No | Yes |
| 33 | `MoveDeformKeyframe` | 2.9 | No | Yes |
| 34 | `ClearAttachmentDeform` | 2.9 | No | Yes |

Reviewer rule (from §11): a PR that mutates `DocumentModel` outside a Command, or adds a Command without a do/undo round-trip test, is rejected. Editor-only state (active bone for heat-map, previewed skin, brush size/strength, paint mode, view mode) lives in Zustand and is NOT a Command (§8.2 wall). The influence cap is the pinned `MAX_BONE_INFLUENCES` constant, not a command.

---

## 11. Conformance comparison policy and pinned tolerances

The conformance comparison is a CI-gating contract consumed by three runtimes, so the tolerances are PINNED (not "for example") and committed as a constant in `packages/conformance` (for example `tolerance.ts`). A single absolute world-unit tolerance is wrong for heterogeneous quantities, so the policy is per-quantity and combines absolute and relative tolerance.

Committed tolerances:

| Quantity | Tolerance rule | Values |
|---|---|---|
| Bone world-matrix linear elements (a, b, c, d) | absolute | `abs = 1e-5` (dimensionless) |
| Bone world translation (worldX, worldY) | absolute + relative | `abs = 1e-4` world units, `rel = 1e-5` |
| Vertex positions (skinned and deformed, world units, possibly hundreds of pixels) | absolute + relative | `abs = 1e-4` world units, `rel = 1e-5` |

Comparison rule (per-channel): for each scalar channel of each sampled quantity at each sampled time, the check passes when `abs(expected - actual) <= absTol + relTol * abs(expected)`. CI is RED if any single channel fails. Angles are NOT compared directly (to avoid wraparound and to keep accumulation differences from biasing the result); IK and transform-constraint outputs are compared as the resulting world-matrix elements and world translation under the rules above. The relative term handles large coordinate magnitudes; the absolute term handles values near zero.

"Byte-identical" is used ONLY for the fixture-regeneration determinism check (TASK-2.10.2): the SAME generator on the SAME machine and code must emit byte-identical fixture JSON. Cross-runtime numeric agreement is always "within the committed tolerance," never byte-identical.

---

## 12. Phase 2 risks and mitigations

| ID | Risk | Severity | Mitigation (concrete) |
|---|---|---|---|
| R2.1 | Weight-paint UX is hard to make usable | High | Ship basic-but-correct only: brush + add/sub/smooth + normalize + cap-4 + heat-map + auto-weight-from-proximity (WP-2.4). Auto-weight makes manual paint a touch-up, not from-scratch. Hard-defer gradient/mirror/copy/table tools (WP-2.4 deferred list). Gate: animators can rig the DoD limb without the deferred tools. |
| R2.2 | Mesh deform was never actually needed (sprite-on-bone suffices) | Low-but-worth-checking | WP-2.0 runs FIRST and can downgrade to a reduced Phase 2, saving the mesh/skin/paint/deform months. DECISION-2.0 is recorded with sign-off; PROVISIONAL decisions carry RECHECK-2.0 at Phase 4. |
| R2.3 | Triangulation quality is poor on deformation (earcut sliver triangles) | Medium | earcut for v1 (§4), wrapped behind the editor `triangulate()` so `cdt2d`/`poly2tri` can replace it without touching callers and without entering `runtime-core`. Min-angle sliver check in TASK-2.1.7. If artifacts appear on the DoD rig, swap the impl behind the same interface (no format change). |
| R2.4 | Three runtimes drift on skin/IK/deform/transform numerics | High | Section 5 spec + ADR-2.SOLVE give a written contract; six WP-2.10 fixtures (incl. one-bone IK and rigid mesh) generated from `runtime-core`; pinned per-quantity tolerance (section 11); CI-red on drift. Accumulation order and float type are specified (TASK-2.2.5, TASK-2.5.4). |
| R2.5 | IK edge cases (unreachable / zero-length / colinear) produce NaNs or snapping | Medium | TASK-2.5.2 specifies clamp-on-unreachable and fold-on-too-close; FIX-2.IK2 includes unreachable frames; unit tests cover degenerate chains. No NaN may leave `solveIkTwoBone`. |
| R2.6 | Per-frame allocation in skin/deform/constraint tanks 60fps | Medium | `solveSkin`/`applyDeform` write into caller-pooled buffers; `resolveWorld` uses scratch matrices (TASK-2.2.3, TASK-2.9.1, section 5.2). TASK-2.11.3 profiles a flat allocation graph. |
| R2.7 | Format ambiguity (`bones` vs inline `vertices`) causes late rework | Medium | ADR-2.WEIGHTED (TASK-2.2.0) resolves it BEFORE codec/validator code. No code is written against an unpinned contract (Law 3). |
| R2.8 | Solve-order regressions (deform before skin, transform before IK) ship silently | High | Encoded directly into FIX-2.TC (IK-then-transform) and FIX-2.DF (skin-then-deform). A wrong order fails CI, not review-by-eye. |
| R2.9 | Stale weights/deform after a mesh topology edit | Medium | Topology-lock policy (TASK-2.1.8): add/delete vertex forbidden once weighted/deformed; explicit undoable `UnbindMesh`/`ClearAttachmentDeform` required first. MOVE recomputes per-bone coords (captured in undo). Covered by round-trip tests. |
| R2.10 | Scope creep toward general Spine (path constraints, FABRIK, curve-graph polish) | Medium | Section 15 non-goals. FABRIK/CCD chain IK explicitly DEFERRED (§8.6). Reject features no target game needs (§2.2). |
| R2.11 | Coalescing bugs make a stroke into hundreds of undo steps | Medium | Interaction-group API (section 5.7, TASK-2.1.0) bounds strokes/drags by pointer-down/pointer-up, independent of timing; TASK-2.4.6 asserts a 200-dab stroke with a mid-stroke pause is exactly one undo. |

---

## 13. Performance budgets and coverage (Phase 2 specific)

| Budget | Target | Verified by |
|---|---|---|
| Viewport + runtime-web playback of the DoD rig | sustained 60fps | TASK-2.11.3 profiling run |
| Per-frame allocation in solve/render loop | zero steady-state allocation | flat heap graph during 10s playback |
| `solveSkin` for a 200-vertex, 4-influence mesh | well under the 16ms frame budget (target < 1ms) | runtime-core micro-benchmark |
| `solveIkTwoBone` + `resolveWorld` per chain | negligible (< 0.05ms) | micro-benchmark |
| `solveTransformConstraint` (incl. decompose/recompose) per constraint | negligible (< 0.05ms) | micro-benchmark |
| Weight-paint stroke responsiveness | dab-to-heat-map update < 16ms | manual + frame timing |
| Conformance tolerance | pinned per section 11 (abs 1e-5 matrix linear; abs 1e-4 + rel 1e-5 positions) | TASK-2.10.3 |

**Coverage target (global standard, §11 user conventions):** 80%+ line/branch coverage on the new `runtime-core` solve functions (`resolveWorld`, `decomposeWorld`/`composeWorld`, `solveIkOneBone`, `solveIkTwoBone`, `solveTransformConstraint`, `solveSkin`, `applyDeform`) and on the `modules/*` command/service layers introduced this phase. CI reports coverage; a drop below 80% on these paths is a review blocker. Coverage is a smell-detector, not a goal: prefer one meaningful behavior test over five trivial ones.

Pooling requirements (Invariant): pre-allocate per-mesh `Float32Array` for skinned vertices and deformed vertices; reuse across frames; never allocate inside `solveSkin`/`applyDeform`/IK/transform/`resolveWorld`.

---

## 14. Definition of Done acceptance script (concrete, runnable)

Phase 2 is DONE when this entire script passes. Steps marked CI are automated; steps marked MANUAL are a human walkthrough of the DoD rig.

```bash
# 0. Entry gate still green (regression guard)
pnpm -w turbo run test --filter=@marionette/format --filter=@marionette/runtime-core
# expect: PASS (Phase 1 + Phase 2 unit tests)

# 1. runtime-core solve correctness (CI)
pnpm --filter @marionette/runtime-core test
# expect: PASS for solveSkin (weighted + unweighted fast path), solveIkOneBone,
#         solveIkTwoBone (incl. unreachable), solveTransformConstraint (per channel,
#         world-space), resolveWorld, decomposeWorld/composeWorld round-trip,
#         applyDeform (skin-then-deform).

# 2. Format codec + validator + backward compatibility (CI), Law 3
pnpm --filter @marionette/format test
# expect: PASS for weighted-encoding codec round-trip fuzz, weighted validator rules,
#         and the backcompat suite: every committed Phase 1 golden document still
#         validates and round-trips deep-equal under the extended validator.

# 3. Editor command round-trips (CI), Law 2
pnpm --filter @marionette/editor test
# expect: PASS for every command in section 10 (do then undo == deep-equal prior doc),
#         PaintWeightStroke 200-dab stroke with a >250ms mid-stroke pause == single undo,
#         weight invariants (sum==1 within tol, influences<=4) hold over random strokes,
#         topology-lock: add/delete vertex on a weighted/deformed mesh is rejected.

# 4. Conformance fixtures (CI), Invariant + section 11 + §8.11
pnpm --filter @marionette/conformance test
# expect: PASS for FIX-2.RM, FIX-2.W, FIX-2.IK1, FIX-2.IK2, FIX-2.TC (IK-then-transform),
#         FIX-2.DF (skin-then-deform), each within the pinned per-quantity tolerance.

# 5. Fixture determinism (CI)
pnpm --filter @marionette/conformance run generate && git diff --exit-code packages/conformance/fixtures
# expect: no diff (fixtures regenerate byte-identically from runtime-core on this machine).

# 6. Format contract: no breaking change without ADR (Law 3), machine-checked
#    packages/format WILL show an additive diff (codec + weighted validator). That is expected.
#    What must NOT happen is a formatVersion bump or a backward-incompatible change without an ADR.
node packages/format/scripts/assert-format-version-stable.mjs --base origin/main
# expect: PASS. The script reads formatVersion on origin/main and HEAD; if unchanged, PASS.
#         If changed, it requires a docs/adr/*.md that references the new version, else FAIL.
#         Backward compatibility itself is enforced by the backcompat suite in step 2.

# 7. Lint / type strictness / import boundaries (CI)
pnpm -w turbo run lint typecheck
# expect: PASS; zero 'any' and zero unjustified 'as' in packages/format and runtime-core;
#         import-boundary rules (section 3): no math-bridge in modules/mesh|constraints or
#         runtime-core solve; no PixiJS in runtime-core; no earcut in runtime-core;
#         zero em-dashes and zero en-dashes (lint rule) in changed files.
```

MANUAL walkthrough (the milestone exit):

- [ ] D2.1 Open the editor, load the DoD character source assets.
- [ ] D2.2 On a limb sprite: Auto perimeter-trace (or Auto grid-fill) a mesh, adjust a few vertices. Undo and redo cleanly (each drag is one undo step).
- [ ] D2.3 Bind the mesh to the upper and lower limb bones; Auto-weight from proximity; paint a touch-up stroke (with a deliberate mid-stroke pause); verify the heat-map; single undo reverts the stroke.
- [ ] D2.4 Add a two-bone IK constraint with a target bone; drag the target and watch the limb bend smoothly at 60fps; flip `bendPositive` and see the elbow mirror (a clean step, never interpolated).
- [ ] D2.5 Add a transform constraint so a secondary bone follows a driver in world space; confirm it solves after IK.
- [ ] D2.6 In animation mode, key the IK target and a deform pose across time; scrub and see smooth, correctly interpolated motion; confirm deform is added on top of skinning (limb bends from bones, surface wobbles from deform).
- [ ] D2.7 Export the document. Open it in a standalone `runtime-web` page. The animation is visually identical to the editor viewport (shared renderer, §8.3); sampled solve output matches within tolerance.
- [ ] D2.8 Save, close, reload: the `DocumentModel` is deep-equal to before save; undo all the way to empty and redo all the way back both succeed.
- [ ] D2.9 Profiler shows sustained 60fps and a flat allocation graph during playback.

When CI steps 1 to 7 are green AND D2.1 to D2.9 pass, Phase 2 is DONE and Phase 3 (VFX/particles) may begin (Law 5).

---

## 15. Non-goals and explicit deferrals (Phase 2)

- **Chain IK (FABRIK / CCD).** Deferred (§8.6). Two-bone analytic covers the overwhelming majority of slot character needs. Add only when a specific game needs long chains (tentacle, tail, rope).
- **Path constraints.** Out of scope (§2.2 non-goals).
- **Advanced weight tools:** gradient/linear ramp, mirror-paint, weight copy between meshes, per-vertex weight table UI (anti-gold-plating, R2.1).
- **Constrained Delaunay triangulation (`cdt2d`/`poly2tri`).** earcut for v1; swap behind the editor `triangulate()` only if deformation artifacts demand it (R2.3). Triangulation stays out of `runtime-core`.
- **Document-configurable influence cap.** `MAX_BONE_INFLUENCES` is a pinned constant (4). Making it a format field is deferred and would require STOP-and-ADR.
- **Orphaned §6 attachment types (explicit deferral so they do not fall through the cracks).** `ClippingAttachment`, `PointAttachment`, and `BoundingBoxAttachment` exist in §6 but are NOT authored or solved in Phase 2. Clipping is deferred to Phase 3 (VFX masking) or later; point attachments to Phase 3 (particle/muzzle anchors); bounding boxes to Phase 4 (hit/region authoring in the slot layer). The format already carries them and the Phase 1 validator accepts them structurally; Phase 2 leaves them inert (no authoring UI, no solve step).
- **Onion-skinning, ripple-edit, graph-editor polish.** Timeline niceties remain deferred (Phase 1 risk note, §10).
- **Unity/Godot runtime reimplementation.** Phase 5. Phase 2 only produces the fixtures and the section 5 / ADR-2.SOLVE spec they will validate and build against.

---

## 16. Reviewer sign-off checklist

A senior reviewer signs off on this plan only if all of the following are true:

- [ ] S1 WP-2.0 (deform-necessity audit) is scheduled FIRST, can downgrade scope, and has an explicit external prerequisite plus a PROVISIONAL/RECHECK fallback when real designs are not ready.
- [ ] S2 Every `runtime-core` solve addition (resolveWorld, decompose/recompose, IK, transform, skin, deform) is placed at its exact solve-order slot (section 8 Table A) and is PixiJS-free and math-bridge-free.
- [ ] S3 The constraint world-resolution rule, IK and transform channel space (read world / write local), write-back order, and decompose/recompose convention are fully specified in section 5 and mirrored in ADR-2.SOLVE, which lands before WP-2.5/WP-2.7 code.
- [ ] S4 Every command in section 10 (34 total) has a mandatory do/undo round-trip test; strokes and drags coalesce via interaction groups, not the 250ms window.
- [ ] S5 Law 3 is honored as "no breaking change, additive code only, formatVersion bump only via ADR"; the codec and weighted validator are pinned to `packages/format`; ADR-2.WEIGHTED resolves the `bones` ambiguity before codec/validator code; acceptance step 6 is a real machine check (formatVersion stability + backcompat), not a file-diff veto.
- [ ] S6 `SetMaxInfluences` is removed; the cap is the pinned `MAX_BONE_INFLUENCES` constant, not a command and not a hidden format field.
- [ ] S7 Six fixture families (FIX-2.RM, FIX-2.W, FIX-2.IK1, FIX-2.IK2, FIX-2.TC, FIX-2.DF) are generated from runtime-core, committed, and CI-gated, covering one-bone IK and the rigid-mesh fast path, and encoding solve order.
- [ ] S8 The topology-lock policy (TASK-2.1.8) prevents stale weights/deform, with explicit undoable `UnbindMesh`/`ClearAttachmentDeform` and round-trip tests.
- [ ] S9 `triangulate`, marching-squares, and Douglas-Peucker are authoring-only (editor `modules/mesh`), absent from the reimplemented-surface table, and earcut never enters `runtime-core`.
- [ ] S10 The conformance tolerance is pinned per quantity (section 11) with an explicit per-channel absolute-plus-relative comparison rule; "byte-identical" is used only for fixture-regeneration determinism.
- [ ] S11 Law 1 is machine-checked by the import-boundary rule (section 3, G2.8), and the coverage target (80%+ on runtime-core solve and service layers) is stated.
- [ ] S12 Performance budgets (section 13) include zero per-frame allocation and 60fps on the DoD rig; deferrals (section 15) keep scope off the general-Spine path and account for the orphaned attachment types.
- [ ] S13 No em-dashes and no en-dashes anywhere in the deliverables.
