# ADR-0013 (ADR-B6.SOLVE): path attachment and path constraint solve semantics

Status: Accepted (2026-07-09)
Owner: Lane B (Core solve and conformance)
Gates: the PP-B6 path solve for the stage F3 path attachment and path constraint fields that ADR-0011
(format 0.5.0) carried as DATA and explicitly left to the runtime. ADR-0011 section 5, Consequences and
Alternatives repeatedly defer the evaluation here: "Lane B (PP-B6) owns the path solve: constant-speed
arc-length reparametrization from the `lengths` table, the position/spacing/rotate modes, the mix blend,
and the default IK-before-transform-before-path order." This ADR pins that math so all three runtimes
(TypeScript, Unity C#, Godot GDScript) compute the identical result and the conformance corpus locks it.
Cross-ref: `docs/adr/0011-format-0-5-0-paths.md` (the geometry and field shapes this evaluates);
`docs/adr/0010-pp-b5-constraint-solve-depth-and-order.md` sections 1 (the interleaved order schedule this
extends to a third array) and 2 (the parent-frame local-write precedent this reuses); ADR-0003 (constraint
solve semantics, the on-demand world resolution and mix-blend precedent); ADR-0002 (weighted-vertex codec,
reused for weighted control points); ADR-0012 (the PP-B2 vertex-transform precedent);
`docs/plan/pro-parity-execution-plan.md` section 4 Lane B (PP-B6); `CLAUDE.md` per-frame solve order step 3.

## Context

A path constraint positions and orients a list of bones ALONG a target slot's path attachment (a piecewise
cubic Bezier spline). ADR-0011 fixed the DATA: the spline's control points (weighted or unweighted via the
ADR-0002 codec), the `closed` and `constantSpeed` flags, the committed cumulative-per-curve arc-length table
`lengths`, and the constraint's `positionMode` / `spacingMode` / `rotateMode` / `position` / `spacing` /
`offsetRotation` / `mixRotate` / `mixX` / `mixY` / optional `order`, plus the per-animation `path` timeline
(keyable `position` / `spacing` / `mixRotate` / `mixX` / `mixY`). It deferred every SOLVE meaning here.

Every formula below is designed from the published GEOMETRY of a cubic Bezier spline and the concept of
distributing bones along an arc (Law 4). No Spine runtime source was consulted; the arc-length refinement
method, the spacing distribution, the three rotate modes, and the parent-frame write are our own design and
derivation. The encoding and the format are ours (ADR-0011).

Two invariants bound every rule here, mirroring ADR-0010:

1. **Additivity / neutrality.** Path constraints are a NEW constraint kind. A rig with no path constraints
   has an empty `pathConstraints` array and an empty per-animation `path` record, so the schedule and the
   step-3 loop are unchanged and every pre-F3 conformance fixture regenerates byte-identical (proved by
   regenerating them and diffing zero).
2. **Determinism and no per-frame allocation.** The prepared path tables (control-point layout, curve
   count, the committed lengths, the weighted manifest) are built once at `buildPose`. The per-frame solve
   uses only pre-existing pose/constraint scratch (world control points, the per-curve arc-length LUT, the
   per-bone position/angle buffers). Nothing here allocates in the per-frame solve.

## Decision

### 1. Cubic Bezier spline evaluation (the geometry, Law 4)

A path attachment stores `V` control points (ADR-0011 section geometry): open splines carry `V = 3C + 1`
control points for `C` curves, closed splines carry `V = 3C`. Curve `i` (`0 <= i < C`) is the cubic Bezier
through control points `P0 = cp[3i]`, `P1 = cp[3i+1]`, `P2 = cp[3i+2]`, `P3 = cp[3i+3]`, where for a CLOSED
spline the final curve's end anchor wraps: `cp[3C] === cp[0]` (index taken modulo `V`). The control points
are used in WORLD space (section 2).

The point at parameter `t in [0,1]` on curve `i` is the standard Bernstein form

```
B(t)  = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
```

and the tangent (first derivative, an UNNORMALIZED direction) is

```
B'(t) = 3(1-t)^2 (P1-P0) + 6(1-t)t (P2-P1) + 3t^2 (P3-P2)
```

Both are evaluated per component (x, y). The tangent's ANGLE is `atan2(B'_y, B'_x)`; its magnitude is never
used (only the direction matters for rotation), so no normalization or division occurs on the tangent.

### 2. World control points (the vertex transform, reused from ADR-0002 / ADR-0012)

A path constraint solves at step 3, BEFORE the authoritative step-4 world pass, so it resolves the world
control points ON DEMAND from current local state (the ADR-0003 `resolveWorld` precedent that IK and
transform constraints already use), never from `pose.world` (which is not yet written at step 3). This is
the ONE difference from mesh skinning (`solveSkin`, ADR-0002), which runs at step 5 and reads `pose.world`.

- **Unweighted** control points ride the target slot's bone: `worldPoint_v = slotBoneWorld * (x_v, y_v)`,
  where `slotBoneWorld` is the slot bone's world matrix resolved on demand (`resolveWorldMat`). This is the
  exact unweighted transform of ADR-0012's `transformUnweightedVerticesInto`.
- **Weighted** control points use the ADR-0002 self-delimiting stream (`boneCount,
  (globalBoneIndex, vx, vy, weight) x boneCount` per logical control point):
  `worldPoint_v = sum over influences of weight * (boneWorld[globalBoneIndex] * (vx, vy))`, accumulated in
  STORED influence order (the numerical contract of ADR-0002 `solveSkin`). Each referenced bone's world
  matrix is resolved on demand once per solve into a per-constraint packed scratch buffer (indexed by
  GLOBAL bone index, sized `boneCount * 6` at build, filled only for the manifest bones each frame), then
  the stream walk reads that scratch. This reproduces `solveSkin` bit for bit while using step-3 on-demand
  worlds instead of `pose.world`.

The world control points are computed ONCE per constraint solve into a pre-allocated `worldPoints` scratch
(`V * 2` lanes), reused by both the LUT build (section 3) and the point/tangent evaluation (section 5).

### 3. Constant-speed arc-length parametrization (the committed table plus a pinned in-curve LUT)

`position` and `spacing` are always ARC-LENGTH quantities (ADR-0011: `fixed` is absolute arc length,
`percent` is a fraction of total length). The total path length is `L = lengths[C-1]` (the committed
cumulative table's last entry). A target arc-length `s` maps to a point in two steps.

**Step 3a: cross-curve selection from the committed table.** The committed `lengths` array is the CUMULATIVE
arc length to the END of each curve, so `lengths[i-1]` (or 0 for `i = 0`) is the arc length at the START of
curve `i`. Binary-search `lengths` for the smallest `i` with `lengths[i] >= s`. Then

```
curveStart    = i == 0 ? 0 : lengths[i-1]
curveLen      = lengths[i] - curveStart
curveFraction = curveLen > EPSILON ? (s - curveStart) / curveLen : 0     (clamped to [0, 1])
```

`curveFraction` is the position WITHIN curve `i`, expressed as a fraction of that curve's committed length.
This is why the format commits the table (ADR-0011): the AUTHORED metric budgets how much arc a curve owns,
shared by all three runtimes with zero integration and zero drift. The committed table has ONE value per
curve (the endpoint), so it fixes cross-curve budgeting but carries NO sub-curve data; the in-curve mapping
must be integrated by the runtime (step 3b).

**Step 3b: in-curve parameter from a pinned world arc-length LUT.** The `curveFraction` is converted to the
Bezier parameter `t` differently per `constantSpeed`:

- **`constantSpeed === false`** (naive per-curve t): `t = curveFraction` directly. No integration; the
  parameter advances linearly with the committed curve fraction and the point bunches wherever the cubic
  bunches. This is ADR-0011's "naive per-curve t".
- **`constantSpeed === true`**: `t` is found by inverting the curve's normalized WORLD arc-length table.
  The curve is subdivided into `PATH_CURVE_SUBDIVISIONS = 64` equal-PARAMETER steps
  (`u_k = k / 64`, `k = 0 .. 64`); the world Bezier (section 1, world control points from section 2) is
  evaluated at each `u_k` and the CUMULATIVE CHORD length `cum[k]` is accumulated (`cum[0] = 0`,
  `cum[k] = cum[k-1] + distance(B(u_{k-1}), B(u_k))`). Let `total = cum[64]` and `targetLen = curveFraction
  * total`. Binary-search `cum` for the subsegment `[cum[k], cum[k+1])` bracketing `targetLen`, then linearly
  interpolate inside it:

  ```
  segLen = cum[k+1] - cum[k]
  frac   = segLen > EPSILON ? (targetLen - cum[k]) / segLen : 0
  t      = (k + frac) / 64
  ```

  The 64-segment chord LUT with linear inversion is the PINNED refinement method. It is chosen over a
  fixed-iteration Newton solve because it needs no derivative root-finding and no per-iteration branch that
  could diverge across language math libraries: it is a fixed-count sum of `distance()` calls plus one linear
  interpolation, so the three runtimes reproduce it to f64 round-off (the cross-language argument is exactly
  `PATH_CURVE_SUBDIVISIONS = 64`, applied identically). The LUT is built in WORLD space (the world control
  points already exist and are the only well-defined space for a weighted/deformed path); for a rigidly
  transformed path world and setup chord lengths are proportional per curve, so the fraction inversion is
  transform-invariant and equals the setup-space answer. The per-curve LUT for all `C` curves is built once
  per constraint solve into a pre-allocated `curveLut` scratch (`C * (PATH_CURVE_SUBDIVISIONS + 1)` lanes),
  so per-bone sampling only binary-searches it.

For a straight-line path with evenly spaced control points, arc length is LINEAR in `t`, so the LUT is
exactly linear and `t = curveFraction` regardless of `constantSpeed`; that is what makes the conformance
analytic oracle (a straight closed path) hand-computable and independent of the subdivision count.

### 4. Distributing N bones along the arc (position and spacing modes)

Each constrained bone `b` (`0 <= b < N`, in the constraint's `bones` list order, the authored along-path
order) is placed at a target arc-length `s[b] = basePosition + offset[b]`.

**Base position** from `positionMode` (`position` is `p`):

```
positionMode fixed:   basePosition = p
positionMode percent: basePosition = p * L
```

**Cumulative spacing offset** `offset[b]` with `offset[0] = 0` and `offset[b] = offset[b-1] + gap[b]` for
`b >= 1`, where `gap[b]` (the arc-length increment from bone `b-1` to bone `b`) is chosen by `spacingMode`
(`spacing` is `q`, `naturalLen(k) = setup bone length of bones[k]`, i.e. `pose.boneLength` at that bone's
index; the SETUP length is used for determinism and because the oracle rigs use unit world scale, so setup
and world length agree there; world-scale-adjusted spacing is a later refinement if a rig needs it):

```
spacingMode fixed:        gap[b] = q
spacingMode percent:      gap[b] = q * L
spacingMode length:       gap[b] = naturalLen(b-1)
spacingMode proportional: gap[b] = naturalLen(b-1) * K,
                          K = naturalTotal > EPSILON ? q / naturalTotal : 0,
                          naturalTotal = sum over k in [0, N-2] of naturalLen(k)
```

`length` tiles the bones at their natural sizes; `fixed` tiles them at a constant arc gap; `percent` tiles
them at a resolution-independent fraction of the whole; `proportional` scales the natural chain so it spans
exactly `q` arc length. `spacing` `q` is a fraction of `L` for `percent` and a raw arc length for
`fixed`/`proportional` (matching ADR-0011's per-mode `spacing` meaning). `spacing` may be negative (the
chain runs upstream) and `position` may exceed the path; that is handled by section 4.1.

#### 4.1 Open clamp and closed wraparound

Each target `s[b]` is normalized before mapping (section 3a):

- **Open path** (`closed === false`): `s[b]` is CLAMPED to `[0, L]`. A bone whose position runs past an end
  sits at the endpoint (the path does not extrapolate). Curve selection at exactly `s = L` resolves to the
  last curve at `t = 1`.
- **Closed path** (`closed === true`): `s[b]` WRAPS into `[0, L)` by `s = ((s mod L) + L) mod L` (a
  floored modulo, so a negative or over-length position wraps onto the loop). This is the closed-path
  wraparound: a chain that runs off the end reappears at the start.

`L <= EPSILON` (a degenerate zero-length path) short-circuits the whole constraint to a no-op (no division
by zero can leave the solver).

### 5. Orienting each bone (the three rotate modes) and the mix blend

The path WORLD POSITION of every constrained bone is computed first, into a per-constraint `positions`
scratch (`N * 2` lanes), from section 3/4 (evaluate the world Bezier at the resolved `(curve, t)`). Rotation
then reads those positions (chain modes need the NEXT bone's position), so no bone-write ordering hazard
exists: positions are pure path samples, independent of the local writes.

For bone `b` at world position `(px, py)`, the target WORLD rotation angle `theta` (radians) is:

- **`tangent`**: `theta = atan2(tangent_y, tangent_x)`, the world Bezier derivative (section 1) at the
  bone's `(curve, t)`. The bone points downstream along the rail.
- **`chain`**: `theta = atan2(py_{b+1} - py_b, px_{b+1} - px_b)`, pointing at the NEXT constrained bone's
  world position. The LAST bone (`b = N-1`) has no successor and falls back to its `tangent` angle. A
  zero-length gap (coincident successor) also falls back to the tangent, so `atan2(0,0)` never fixes a
  spurious 0.
- **`chainScale`**: the `chain` angle PLUS a per-bone `scaleX` multiplier so the bone's rendered segment
  spans the gap to the next bone. `desired = distance(pos_b, pos_{b+1})`; `natural = naturalLen(b) *
  worldXScale(b)` (the bone's current world segment length); `scaleXMul = natural > EPSILON ? desired /
  natural : 1`. The last bone uses `scaleXMul = 1`. The scale multiplier is blended by `mixRotate` (it is
  part of the chain orientation, not an independent mix channel; ADR-0011 keeps scale off the mix channel
  set precisely because `chainScale` owns it).

`offsetRotation` (degrees) is added to `theta` for every mode (`theta_final = theta + offsetRotation *
DEG_TO_RAD`).

**Writing the bone local (the ADR-0010 section 2 parent-frame precedent).** The target is a world position
and a world rotation; both are expressed in the bone's PARENT world frame (resolved on demand,
`parentWorldMat`) and blended into the bone's current local by the per-channel mix, then recomposed:

```
(lx, ly)     = inverse(parentWorld) * (px, py)              // target local translation
solvedRotDeg = worldDirToLocalRotDeg(parentWorld, theta_final)  // ADR-0010 helper, exact under shear/scale
current      = decompose(localMat(bone))
x'           = current.x + mixX * (lx - current.x)
y'           = current.y + mixY * (ly - current.y)
rot'         = current.rotationDeg + mixRotate * wrapDegrees(solvedRotDeg - current.rotationDeg)
scaleX'      = current.scaleX * (1 + mixRotate * (scaleXMul - 1))   // scaleXMul = 1 except chainScale
compose(x', y', rot', scaleX', current.scaleY, current.shearXDeg, 0)
```

`mixX = mixY = mixRotate = 0` reproduces the bone's current local exactly (every delta collapses to zero and
`scaleX'` collapses to `current.scaleX`), so a fully-faded path constraint is a no-op. `mixRotate = mixX =
mixY = 1` lands on the solved position and orientation. A bone with an unresolved index (-1) or an
unresolved slot bone is skipped (the ADR-0003 defensive-skip convention). Shear Y is pinned to 0 by
`decompose`/`compose`, exactly as IK's `blendLocalRotation` does; the path constraint writes translation,
rotation, and (chainScale only) scaleX, never scaleY or shear.

### 6. The shared constraint order now spans three arrays (extends ADR-0010 section 1)

ADR-0011 section 2.3 declares the default solve order IK, then transform, then path, and one shared `order`
namespace across all three arrays. This ADR implements it:

- **No constraint carries `order`** (`pose.solveOrder === null`): solve all IK (document order), then all
  transform (document order), then all PATH (document order). The IK-then-transform prefix is byte-identical
  to ADR-0010; path constraints append after, so a rig with no path constraints is unchanged.
- **Every constraint carries `order`**: the precomputed dense schedule `pose.solveOrder` (an `Int32Array`
  of codes) is extended to a THIRD range. A code `c` selects `ikConstraints[c]` when `c < ikCount`,
  `transformConstraints[c - ikCount]` when `ikCount <= c < ikCount + transformCount`, and
  `pathConstraints[c - ikCount - transformCount]` otherwise. Step 3 walks the schedule and dispatches each
  code to the SAME per-constraint solve helper the default path uses, so a path constraint solved via the
  ordered path is bit-identical to one solved via the default path; only the schedule moves.

`buildSolveOrder` (pose build) enumerates all three arrays; its all-or-none, dense-unique-permutation, and
unvalidated-document fallback-to-null rules are unchanged (ADR-0010 section 1, `CONSTRAINT_ORDER_INVALID`
guarantees validity for a validated rig). `order` is a static structural property, captured once at build.

### 7. Skin scoping and the active path attachment

A path constraint honors skin scoping exactly like IK/transform (ADR-0009 section 5, ADR-0011 section 4):
its `scopeSkins` is captured at build and `isConstraintScopeActive` gates the solve. The target slot's path
attachment GEOMETRY is resolved at BUILD time from the slot's setup active attachment in the `default` skin
(the statically decidable case ADR-0011 section 2.2 validates), and prepared into the resolved constraint.
A constraint whose target slot has no resolvable setup path attachment in the default skin prepares to a
NO-OP (it solves nothing), which is the runtime concern ADR-0011 section 2.2 explicitly leaves here; live
attachment-swap or non-default-skin path selection is out of scope for PP-B6 (a later additive slice, if a
rig ever needs it) and is documented as such. This keeps the prepared path tables built once and the
per-frame solve allocation-free, which is the invariant-2 requirement.

## Consequences

- `runtime-core` gains: a `path.ts` solve module (world control points, the per-curve world arc-length LUT,
  the constant/non-constant parametrization, the position/spacing distribution, the three rotate modes, and
  the parent-frame local write); a `ResolvedPathConstraint` on the pose (prepared control-point layout,
  curve count, committed lengths, weighted manifest, and the per-constraint scratch), built by `buildPose`
  from the target slot's setup path attachment; a `PreparedPathChannel` and `applyConstraintEntry` branch
  for the `path` timeline (position/spacing/mixRotate/mixX/mixY); and a third range in `buildSolveOrder` and
  `solveConstraints`. Every addition is gated on a path constraint existing, so the default solve and its
  fixtures are unchanged (invariant 1).
- The conformance corpus gains `rig-path-follow` (an OPEN path, all three rotate modes across samples,
  percent and fixed position) and `rig-path-spacing` (a CLOSED path, the four spacing modes, constant-speed
  on). Both observe only the existing bone-world-affine lane (a path constraint writes bone transforms), so
  no fixture schema change is needed and every pre-F3 fixture regenerates byte-identical. A straight-line
  analytic oracle independently checks the first `rig-path-follow` generation (closed-form arc length and
  hand-computed positions/rotations), so the fixtures are checked, not merely frozen.
- Unity and Godot mirror the same evaluation, LUT, distribution, rotate modes, order range, and parent-frame
  write, gated by the same fixtures (the one-stage-lag rule). The pinned `PATH_CURVE_SUBDIVISIONS = 64` and
  the floored-modulo wraparound are the cross-language contract.

## Alternatives considered

- **Recompute the full world arc-length of every curve each frame and ignore the committed `lengths`.**
  Rejected: ADR-0011 committed the table precisely so runtimes share ONE authored cross-curve budget and do
  not each integrate and drift. The committed table governs cross-curve selection; only the unavoidable
  in-curve mapping (the format carries no sub-curve data) integrates, and it does so with a pinned LUT.
- **Fixed-iteration Newton for the in-curve arc-length inversion.** Rejected: Newton needs the arc-length
  derivative (the tangent magnitude) and an iteration count and convergence test that can diverge by an ULP
  across language math libraries, threatening the byte/tolerance gate. The 64-segment chord LUT is a fixed
  sum plus a linear interpolation, trivially identical across the three runtimes.
- **World-scale-adjusted spacing (multiply `length`/`proportional` gaps by each bone's world scaleX).**
  Deferred: the setup length is deterministic and unambiguous, the oracle rigs use unit world scale so the
  two agree, and a world-scale spacing is an additive refinement a rig can motivate later. Pinning setup
  length now keeps the oracle hand-computable.
- **A separate `mixScale` channel for `chainScale`.** Rejected: ADR-0011 deliberately keeps scale off the
  path constraint's mix channel set and assigns length preservation to the `chainScale` MODE; blending the
  chain-scale multiplier by `mixRotate` keeps orientation and its length preservation on one channel, which
  is the channel that turns the mode on.
- **Resolving the active path attachment per frame (honoring attachment-swap/skin timelines).** Deferred to
  a later additive slice: it would move geometry resolution into the per-frame solve and break the
  build-once, allocation-free prepared-table invariant. ADR-0011 section 2.2 already scopes the format check
  to the setup default-skin case and names live selection a runtime concern; PP-B6 prepares the setup path
  and no rig in scope swaps it.
