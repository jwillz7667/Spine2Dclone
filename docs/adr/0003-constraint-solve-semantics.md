# ADR-0003 (ADR-2.SOLVE): Constraint solve semantics

Status: Accepted (2026-06-27)
Owner: runtime-core
Gates: TASK-2.5.0. MUST be Accepted before any WP-2.5 (IK solve) or WP-2.7 (transform constraint) code.
Cross-ref: `docs/plan/phase-2-rigging.md` section 5 (normative source, mirrored here), `MARIONETTE_HANDOFF.md`
section 6 (per-frame solve order) and 8.6 (IK/constraints), `docs/plan/cross-cutting/format-contract.md` section
4.9 (the deform local-vs-world question this ADR resolves).

## Context

IK constraints, transform constraints, skinning, and deform are reimplemented by three runtimes (TS reference,
Unity, Godot). The single highest cross-runtime drift risk (R2.4) is the SOLVE SEMANTICS: what space each
constraint reads and writes, how on-demand world state is obtained at step 3 while the authoritative world pass is
step 4, the exact affine decompose/recompose convention, and where deform offsets are applied. These must be a
WRITTEN contract, not an unwritten convention discovered from a fixture. This ADR is that contract; the conformance
fixtures FIX-2.IK1, FIX-2.IK2, FIX-2.TC, FIX-2.DF lock it numerically.

## Decision

### 1. Reconciling "solve constraints at step 3" with "world transforms at step 4"

The canonical per-frame order (handoff section 6) lists step 3 (solve constraints: IK then transform) and step 4
(world transforms, single forward pass, parents precede children) as distinct steps; all runtimes match it.

- **Constraints WRITE local transform deltas only.** They never write a world matrix directly. After all
  constraints have run, the LOCAL state of every bone fully encodes their effect.
- **Step 4 is a single, authoritative forward pass** over bones in stored order:
  `world = parentWorld * compose(localTransform)`. Because constraints wrote only local, this pass is clean and
  unconditional. The world matrices it produces are the final, rendered ones.
- **Step 3 obtains world state on demand** via `resolveWorld(bone)`, a pure function of CURRENT local state. It
  reads; it does not mutate step 4's work. The world frame computed for an already-solved bone equals what step 4
  will produce for that bone (modulo float), because both compose the same local transforms with the same routine.

### 2. On-demand world resolution rule (`resolveWorld`)

`resolveWorld(boneIndex) -> world 2x3` composes the bone's ancestor chain's CURRENT local transforms from the root
down to the bone:

- It reflects all animation timeline values applied in step 2 and every local delta written by constraints that
  solved EARLIER in step 3.
- It is a pure function of current local state: calling it twice with no intervening local write yields identical
  results. An implementation MAY memoize within a frame, but the memoized value MUST equal a fresh root-to-bone
  walk.
- It uses the EXACT SAME affine `compose` routine as step 4. It allocates nothing (writes into solver-owned scratch
  matrices). Chains are short (1 to 2 constrained bones plus a few ancestors), so the repeated walk is within
  budget.

### 3. Constraint ordering

ALL IK constraints first (in stored array order), then ALL transform constraints (in stored array order). Each
constraint, when it runs, reads world state via `resolveWorld` that already reflects every earlier constraint's
local writes. Determinism follows from the fixed array order plus the pure resolver.

### 4. IK constraint: channel space and write-back (read WORLD, write LOCAL rotation)

- Read `resolveWorld(target)` for the target world position, and the chain root's parent world (and, for two-bone,
  the parent chain bone's world) for the frame the chain starts in.
- One-bone (`solveIkOneBone`): rotate the single bone so its tip points at the target world position; express the
  result as a LOCAL rotation relative to the bone's parent world frame; blend the local rotation from its pre-IK
  value toward the IK solution by `mix` in [0,1].
- Two-bone (`solveIkTwoBone`): law of cosines on the two segment lengths (each `bone.length` scaled by that bone's
  world scale) to find the two world angles that place the chain tip at the target; `bendPositive` selects which of
  the two mirror solutions (elbow/knee direction); convert each world angle to a LOCAL rotation relative to that
  bone's parent world frame; blend each by `mix`. Clamp when the target is unreachable (straighten the chain toward
  the target) or too close (fold). No NaN may leave the solver.
- IK writes ONLY local rotation (never translation, scale, shear, or a world matrix).

### 5. Transform constraint: channel space and write-back (read WORLD, blend WORLD, write LOCAL)

- **Read WORLD channels of the target**: decompose `resolveWorld(target)` into world rotation, x, y, scaleX,
  scaleY, shearY (section 6).
- **Read the constrained bone's would-be WORLD channels**: decompose `resolveWorld(bone)` into the same six.
- **Blend per channel in WORLD space.** For each `ch` in {rotate, x, y, scaleX, scaleY, shearY}:
  `worldCh = lerp(boneWorldCh, targetWorldCh, mixCh) + offsetCh`. Channels blend independently; blend order is
  irrelevant.
- **Recompose to a WORLD matrix** via `composeWorld`, then **write LOCAL**:
  `local = inverse(parentWorld) * blendedWorld`, stored on the bone. Step 4 recomputes the bone's world from this
  local, reproducing the blended world (modulo float).

Rule: read world, blend in world, write local. This keeps "constraints write local only" uniform across IK and
transform, which is what makes step 4 a clean single pass.

Cycle rule: a constrained bone must not be an ancestor of its own target. The validator rejects such constraints on
import. Ordering plus the no-cycle rule guarantee the target's world and the bone's parent's world are resolvable
before the constraint runs.

### 6. Canonical 2D affine decomposition and recomposition

Part of `runtime-core`; reimplemented by every runtime; MUST match the reference within the conformance tolerance
(not merely "be a valid decomposition"). FIX-2.TC locks them. First-principles QR-style decomposition (Law 4), not
Spine source.

```
decomposeWorld: given world 2x2 columns X' = (a, c), Y' = (b, d), translation (tx, ty):
  rotation = atan2(c, a)          // radians internally; the format stores degrees
  scaleX   = sqrt(a*a + c*c)
  det      = a*d - b*c
  scaleY   = det / scaleX         // signed; carries reflection
  shearY   = atan2(a*b + c*d, det)// radians
  x = tx, y = ty

composeWorld (exact inverse):
  a = scaleX * cos(rotation)
  c = scaleX * sin(rotation)
  b = scaleY * (tan(shearY) * cos(rotation) - sin(rotation))
  d = scaleY * (tan(shearY) * sin(rotation) + cos(rotation))
  tx = x, ty = y
```

`shearY` is undefined as it approaches +/- 90 degrees (the `tan` term diverges); the validator rejects setup-pose
or keyed shears in that degenerate range. The convention is self-consistent: a pure rotation decomposes to zero
shear and unit scales; a Y-only shear of angle gamma decomposes to `shearY = gamma`. Angles internally are radians;
the format and constraint offsets are in degrees, converted at the boundary.

### 7. `bendPositive` is non-interpolatable

`IkFrame.bendPositive` is a boolean and is sampled STEPPED regardless of the keyframe's curve type, in ALL
runtimes. A `bendPositive` flip is a clean step at its keyframe time, never interpolated. FIX-2.IK2 locks this.
`IkFrame.mix` interpolates normally (linear/stepped/bezier).

### 8. `transformMode` interaction (TASK-2.5.4)

When a constrained bone has a non-`normal` `transformMode`, the world pass already honors the mode when composing
that bone's world from its parent. The constraint solve in step 3 reads the bone's would-be world via
`resolveWorld`, which applies the SAME `transformMode` logic as step 4 (it is the same compose routine). IK and
transform constraints therefore operate on the mode-adjusted world frame and write a LOCAL value that, after step
4's mode-aware compose, reproduces the intended world. Phase 2 does NOT special-case constraints per mode beyond
this: the mode is applied exactly once, in the shared compose, and `resolveWorld` and step 4 agree by construction.
This is locked by a fixture (a constrained bone under `noScale`) so the behavior is not implementation-defined.

### 9. Skinning and deform application space (resolves format-contract section 4.9)

- **Skinning (`solveSkin`)** runs at solve-order step 5, BEFORE deform. Weighted:
  `pos = sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy))`, accumulated in INFLUENCE ORDER
  AS STORED (the accumulation order is part of the numerical contract, TASK-2.2.5). Unweighted fast path:
  `pos = slotBoneWorldMatrix * (x, y)`. Writes into a caller-provided pre-allocated `Float32Array` (no allocation).
- **Deform (`applyDeform`)** runs at solve-order step 5, AFTER skinning. The per-vertex `(dx, dy)` offsets are ADDED
  to the POST-SKIN world-space positions: `final_i = skinned_i + (dx_i, dy_i)`. This RESOLVES the local-vs-world
  ambiguity flagged in format-contract section 4.9 in favor of WORLD-SPACE, POST-SKIN, ADDITIVE application
  (handoff section 6 step 5 "skin meshes ... and apply deform offsets" and handoff 8.5 "adds them after skinning").
  Offsets are sampled/interpolated by the deform timeline (linear/stepped/bezier) and stored relative to the setup
  mesh. `applyDeform(skinned, offsets, out)` writes into a pooled buffer (no allocation). FIX-2.DF locks
  skin-then-deform: applying deform before skin would change results and fail the fixture.

## Consequences

- This ADR and plan section 5 are kept identical; a change to one is a change to both, and changing solve behavior
  is a reviewed act that regenerates conformance fixtures (the behavior-change gate).
- The `runtime-core` solve surface added in Phase 2 (`resolveWorld`, `decomposeWorld`/`composeWorld`,
  `solveIkOneBone`, `solveIkTwoBone`, `solveTransformConstraint`, `solveSkin`, `applyDeform`) sits at the exact
  solve-order slots above, is PixiJS-free and math-bridge-free, and allocates nothing in the per-frame path.
- Unity/Godot build their constraint readers/solvers against this ADR plus the fixtures, never against an unwritten
  convention.

## Alternatives considered

- Constraints write world matrices directly (and step 4 skips constrained bones). Rejected: makes step 4 conditional
  and per-bone-branchy, defeats the single-forward-pass invariant, and complicates the C#/Godot ports.
- Deform applied in bind-local space before skinning. Rejected: handoff section 6 step 5 and 8.5 both state
  after-skin; world-space additive is the simpler, drift-resistant reading and matches "offsets from setup mesh"
  measured in the rendered frame.
- Euler/polar decomposition instead of QR-style. Rejected: QR-style with signed scaleY cleanly carries reflection
  and matches the handoff's rotation/scale/shear channel model used by transform constraints.
