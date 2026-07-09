# ADR-0010 (ADR-B5.SOLVE): constraint solve depth and explicit order (an ADR-0003 amendment)

Status: Accepted (2026-07-09)
Owner: Lane B (Core solve and conformance)
Gates: the PP-B5 solve behavior for the stage F2 constraint fields that ADR-0009 carried as data at no-op
defaults. Amends ADR-0003 (constraint solve semantics) without repealing it: every default (softness 0,
stretch/compress/uniform false, no explicit order) reproduces ADR-0003 bit for bit, which is why every
pre-F2 conformance fixture regenerates byte-identical.
Cross-ref: `docs/adr/0003-constraint-solve-semantics.md` (the baseline this extends); `docs/adr/0009-*`
sections 1.1, 1.2, 1.3 (the field shapes and their carried-at-default meaning); `docs/plan/pro-parity-execution-plan.md`
section 4 Lane B (PP-B5); `CLAUDE.md` per-frame solve order step 3.

## Context

ADR-0009 (format 0.4.0) added constraint-depth data to the format and explicitly deferred every solve
meaning to Lane B: "The format stores these; runtime-core (Lane B, PP-B5) implements their effect on the
IK solve and conformance locks it" (section 1.1) and, for order, "the runtime sorts by order when present
and falls back to the document order otherwise" (section 1.3). This ADR is that amendment. It pins the
exact, first-principles math for the IK depth controls and the exact meaning of the optional explicit
constraint order, so all three runtimes (TS, Unity C#, Godot) compute the identical result and the
conformance corpus can lock it.

Every formula below is designed from the published CONCEPT of two-bone inverse kinematics and constraint
scheduling (Law 4). No Spine runtime source was consulted; the soft-reach easing curve, the stretch and
compress length distribution, and the order encoding are our own design and derivation.

Two invariants bound every rule here:

1. **Default neutrality.** softness 0, stretch false, compress false, uniform false, and no constraint
   carrying `order` MUST reproduce the ADR-0003 solve exactly. The implementation guards each new branch on
   its enabling condition and never enters it at the default, so the byte-locked pre-F2 fixtures are
   untouched (proved by regenerating them and diffing zero).
2. **Determinism and no per-frame allocation.** The order schedule is precomputed once at `buildPose`;
   the depth math uses only pre-existing pose scratch. Nothing here allocates in the per-frame solve.

## Decision

### 1. Explicit constraint order (ADR-0009 section 1.3)

The combined constraint set is `ikConstraints` (document array order) followed by `transformConstraints`
(document array order); call this the DOCUMENT ORDER of the `N` constraints. ADR-0003 solves that document
order (all IK, then all transform). ADR-0009 lets every constraint carry an optional `order: integer` that
the format validates to be a dense unique permutation of `[0, N)` when ANY constraint carries it
(all-or-none, `CONSTRAINT_ORDER_INVALID` otherwise).

Solve rule:

- **No constraint carries `order`:** solve in DOCUMENT ORDER, i.e. the exact ADR-0003 two-phase loop (all
  IK constraints, then all transform constraints). Byte-identical to the baseline.
- **Every constraint carries `order`:** solve the single interleaved sequence obtained by sorting the
  combined set ascending by `order`. An IK and a transform constraint may now interleave (a transform
  constraint may solve before an IK constraint, or between two IK constraints), which the two-phase loop
  cannot express.

The schedule is precomputed at `buildPose` into one `Int32Array` (`solveOrder`), null when no order is
present. Each entry encodes one constraint by a single integer: `0 <= code < ikCount` selects
`ikConstraints[code]`; `code >= ikCount` selects `transformConstraints[code - ikCount]`. The per-frame
`solveConstraints` branches once on `solveOrder === null`: null runs the unchanged two-phase loops; non-null
walks `solveOrder` and dispatches each entry to the SAME per-constraint solve helper the default path uses,
so an IK constraint solved via the ordered path is bit-identical to the same constraint solved via the
default path. The single per-constraint solve body has exactly one definition; only the schedule differs.

`order` is a static structural property (not keyable), so it is captured once at build; no per-frame sample
touches it.

### 2. IK constraint depth (ADR-0009 section 1.1)

The depth controls extend the two-bone (and, where noted, one-bone) IK solve. Let, for a two-bone chain,
`len1`, `len2` be the two segment world lengths (`bone.length * worldScaleX` of the parent and child
respectively, exactly as ADR-0003 computes them), `reach = len1 + len2` the fully-extended length, `base`
the parent world origin, `d = max(distance(base, target), EPSILON)` the base-to-target distance, and
`baseAngle = atan2(target - base)`. `EPSILON = 1e-12` as in ADR-0003.

The controls compose in this fixed precedence, chosen so each enabling flag is independent and the default
(all off) is the ADR-0003 hard solve:

#### 2.1 Stretch (target beyond reach)

When `stretch` is true AND `d > reach`, the chain lengthens along a straight line to touch the target
instead of stopping at full extension. Because the child bone rides the parent through transform
inheritance (its world length is the parent's world scale times its own), the scale is applied to the
PARENT's local `scaleX` and the child either inherits it or is counter-scaled:

- Both bones aim straight at the target: `phi1 = phi2 = baseAngle` (no bend; the law of cosines is not
  used because the triangle is degenerate at full extension).
- `uniform` true: multiply the parent's local `scaleX` by `d / reach` and leave the child (its factor is
  1). The child inherits the parent's `d / reach`, so BOTH world segments scale by `d / reach` and the
  straight tip lands at `reach * (d/reach) = d`. This is the "scale both chain bones" mode (ADR-0009).
- `uniform` false: multiply the parent's local `scaleX` by `(d - len2) / len1` and the child's local
  `scaleX` by the inverse `len1 / (d - len2)`. The parent's world length becomes `d - len2`; the child
  inherits the parent factor and the counter-factor cancels it, so the child keeps its world length
  `len2`. Only the parent physically lengthens and the tip lands at `(d - len2) + len2 = d`. This is the
  "only the parent" mode. `d > reach` guarantees `d - len2 > len1 > 0`, so the factors are finite.
- Both the rotation and the scale multiplier are blended by `mix` (mix 0 leaves the bone at its
  pre-constraint local transform; mix 1 lands on the stretched solution), so stretch honours the mix ramp
  like every other IK output. Exact tip placement holds for a similarity chain frame (the conformance
  rig uses one); under a sheared or non-uniformly scaled ancestor the stretch is proportional, the
  standard approximation, and the fixture locks the deterministic result all runtimes reproduce.

Stretch also applies to a ONE-bone chain: when `stretch` and `d > len` (the single segment world length),
aim at the target and multiply the bone's local `scaleX` by `d / len` (uniform is irrelevant with one
bone). This lets a one-bone IK reach a target beyond its length.

#### 2.2 Compress (target closer than the chain folds)

`compress` is the mirror of stretch for a target too CLOSE to reach by bending:

- Two-bone: the closest a fixed chain reaches by folding is `dead = |len1 - len2|` (the fully-folded tip
  distance). When `compress` is true AND `d < dead`, the ordinary law of cosines already folds the chain
  (its `cosAngle2` clamps to 1 at `d < dead`, so `angle2 = 0`), and compress additionally multiplies the
  PARENT's local `scaleX` by `d / dead`. The child inherits that factor, so both world segments shrink by
  `d / dead` and the folded tip (which sits at `dead` scaled by the factor) lands at `d`. Compress ignores
  the `uniform` flag (ADR-0009 defines `uniform` for stretch only); the parent-scaled-child-inherits form
  is the single compress behavior. When `len1 == len2` (`dead == 0`) there is nothing to compress toward,
  so the `dead >= EPSILON` guard is false and the ADR-0003 hard fold stands.
- One-bone: when `compress` and `d < len`, multiply the bone's local `scaleX` by `d / len` so the single
  segment shrinks to reach a target closer than its length.

Compress and stretch are mutually exclusive at any instant: `d` cannot be both `> reach` and `< dead`
(since `dead <= reach`), so at most one branch fires.

#### 2.3 Softness (easing near full extension)

`softness` (world units, `>= 0`) eases the two-bone chain into full extension so the joint does not pop
straight as the target crosses the reachable boundary. It remaps only the DISTANCE fed to the law of
cosines (the aim direction still points at the true target), and only when the target is within the soft
band or beyond it AND stretch did not already consume the beyond-reach case.

Define the soft band start `dStart = reach - softness`. The remap is

```
softDistance(d) = d                                             , if softness == 0 or d <= dStart
                = reach - softness * exp(-(d - dStart) / softness) , if d > dStart
```

Derivation and properties (why this exact curve):

- Continuity: `softDistance(dStart) = reach - softness * exp(0) = reach - softness = dStart`, so the remap
  joins the identity with no jump at the band entry.
- Smoothness (C1): `softDistance'(d) = exp(-(d - dStart)/softness)`, which is `1` at `dStart`, so there is
  no kink where softening begins.
- Asymptote: as `d -> infinity`, `softDistance -> reach` from below and never reaches or exceeds it, so a
  non-stretching soft chain approaches full extension smoothly and never overshoots.
- Monotonic increasing (derivative always positive), so a farther target always yields a straighter chain.

The remapped distance is floored at `EPSILON` (a pathological `softness > reach` can drive the closed form
negative; that is degenerate authoring and the floor keeps the cosine denominators finite). The law of
cosines then runs with `distance = softDistance(d)` while `baseAngle` still uses the true target, so the
chain aims at the target but bends as if the target were slightly nearer, easing the last of the reach.

`softness == 0` skips the branch entirely (the guard is `softness > 0`), so the hard ADR-0003 solve and its
byte-locked fixtures are unchanged.

Softness is a two-bone concept (a one-bone aim has no joint to ease) and is ignored for one-bone chains.

#### 2.4 Keyable depth channels

ADR-0009 makes `softness`, `stretch`, and `compress` optionally keyable on the IK animation frame
(`uniform` and `bend`-as-a-boolean-pair are not: `uniform` is a static rig property, `bend` was already
keyable as the signed direction). The per-frame sampling mirrors the existing IK-frame handling:

- `softness` is a scalar channel blended toward its keyed value by the track alpha exactly like `mix`
  (linear blend, additive-aware), because it is a continuous world-unit distance.
- `stretch` and `compress` are discrete boolean channels sampled STEPPED and resolved by the discrete
  greater-weight-wins rule (ADR-0005 rule 5), exactly like the existing `bend` direction: a per-constraint
  win-weight guards which track's boolean wins when multiple tracks key it.

A frame that keys none of them leaves the constraint definition's values (the reset-to-base each frame).

### 3. Transform-constraint local and relative variants (ADR-0009 section 1.2)

DESIGNED here for completeness of the constraints group; the SOLVE lands in a later PP-B5 slice and its
conformance rig with it. The world/absolute default (`local == false && relative == false`) is unchanged
from ADR-0003 and is the only branch exercised by the current fixtures. Recorded so the group's semantics
live in one place:

- `local == true`: the constraint reads and writes the bone's LOCAL components (the pre-world channels the
  animation-blend layer produced) instead of decomposing and recomposing the WORLD matrix, so the
  constraint composes in the bone's own frame.
- `relative == true`: the per-channel blend is applied as an OFFSET added to the bone's current value
  scaled by mix (`value += mix * (targetChannel + offsetChannel)`) rather than an absolute interpolation
  toward the target (`value = lerp(boneChannel, targetChannel, mix) + offset`).

These four combinations and their exact arithmetic are pinned when that slice lands, under this ADR.

## Consequences

- `runtime-core` gains: a precomputed `solveOrder` schedule on the pose and a single-branch dispatch in
  `solveConstraints`; softness/stretch/compress/uniform in the two-bone and one-bone IK solve; the keyable
  softness/stretch/compress channels on the prepared IK channel and the per-constraint sampled scratch.
  Every addition is guarded on its enabling condition, so the default solve and its fixtures are unchanged.
- The conformance corpus gains `rig-constraint-order` (an interleaving that provably differs from document
  order) and `rig-ik-depth` (softness, stretch, compress, and uniform branches, one and two bone). Both
  observe only the existing bone-world-affine lane, so no fixture schema change is needed. The pre-F2
  fixtures regenerate byte-identical (the neutrality invariant).
- Unity and Godot mirror the same schedule and math, gated by the same fixtures (the one-stage-lag rule).
- Deferred within PP-B5 (tracked, not built here): the transform local/relative solve (section 3), and the
  non-constraint F2 behaviors (linked meshes, sequences, per-component and split-color and dark timelines,
  skin scoping) that ADR-0009 also carried at defaults.

## Alternatives considered

- A soft-IK curve that clamps linearly into full extension. Rejected: a piecewise-linear ramp has a kink
  (discontinuous derivative) at the band entry, reintroducing a smaller pop; the exponential ease is C1 and
  asymptotic, which is the property softness exists to provide.
- Distributing stretch always uniformly across both bones. Rejected: ADR-0009 defines `uniform` precisely
  as the toggle between "both bones" and "only the parent," so a uniform-only implementation would make the
  `uniform: false` data meaningless. The parent-only factor `(d - len2)/len1` reaches the target exactly,
  so both modes are correct, not approximate.
- Keeping the fixed IK-then-transform loop and ignoring `order`. Rejected: ADR-0009 validates and carries
  `order`; ignoring it would silently drop authored intent, the exact silent-approximation the program
  forbids.
