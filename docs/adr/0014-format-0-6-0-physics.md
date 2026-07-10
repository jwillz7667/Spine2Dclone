# ADR-0014 (ADR-A4.FORMAT): formatVersion 0.6.0, physics constraints

Status: Accepted (2026-07-09)
Owner: Lane A (Contracts)
Gates: ALL PP-A4 (stage F4) schema, validator, and migration work in `packages/format`. MUST be Accepted
before the schema is touched (Law 3 STOP-and-ADR, pro-parity-execution-plan.md section 3, which states the
deterministic fixed-timestep integrator is pinned in this ADR BEFORE any code).
Cross-ref: `docs/plan/pro-parity-execution-plan.md` sections 3 (stage F4) and 4 (Lane A, PP-A4; Lane B,
PP-B7); `docs/plan/cross-cutting/format-contract.md` sections 4.7, 4.8, 6, 8.4, 10; `MARIONETTE_HANDOFF.md`
section 6; ADR-0003 (constraint solve semantics, the `resolveWorld` and decompose/recompose primitives this
ADR reuses), ADR-0008, ADR-0009, and ADR-0011 (the stage-ADR precedents this ADR follows);
`packages/runtime-core/src/effects/emitter-solve.ts` (the integer-step-clock and semi-implicit-Euler
determinism precedent this ADR mirrors operation for operation). The PP-B7 physics-solve ADR (Lane B) owns
the runtime implementation of the model pinned here. `docs/audit/spine-pro-parity-audit.md` section 3.1 (the
physics-constraint concept row F4 closes).

## Context

Stage F4 of the Pro Parity program (`pro-parity-execution-plan.md` section 3) is the fourth and last format
bump of the F1 to F4 staging. The audit section 3.1 records one presentation capability the certified
authoring surface needs and that the current 0.5.0 format cannot express: a PHYSICS constraint, which drives
a bone with spring physics so secondary motion (tails, ropes, hair, cloth flaps, antennae, jiggle) emerges
deterministically from the animated pose plus world forces, without the animator keying every frame.

The current 0.5.0 format has no physics: the document carries `ikConstraints`, `transformConstraints`, and
`pathConstraints` only, and an animation has `bones/slots/ik/transform/path/deform/drawOrder/events`
timelines. Physics is the one constraint kind that STEPS OVER TIME, so it is the one place in the format
where determinism is not free: two runtimes that disagree on the integrator, the timestep, or the arithmetic
order will visibly desync a tail after a few seconds. Non-negotiable 4 of the program
(`pro-parity-execution-plan.md` section 2) requires that anything that steps over time use a fixed timestep
and an integer or fixed-point accumulator EXACTLY like `effects/emitter-solve.ts`, and land with a
determinism test. This ADR pins that model from first principles BEFORE any code exists (Law 4: designed
from the published behavior of a damped-driven harmonic oscillator and the concept of secondary motion,
never from Spine source or Spine serialization; the encoding and the integrator are ours).

This ADR is a single record for the whole of stage F4 (one MINOR bump, `0.5.0 -> 0.6.0`), mirroring the
ADR-0008, ADR-0009, and ADR-0011 one-ADR-per-stage pattern. The implementing commits land one coherent group
at a time (schemas; validators plus fixtures; the migration with the version bump last), per plan section 3.

## The physical model (the source of every field, Law 4)

A physics constraint binds to ONE bone and simulates a chosen subset of that bone's LOCAL pose channels
(`x`, `y`, `rotation`, `scaleX`, `shearX`) as an independent damped-driven harmonic oscillator per channel.
For a channel with simulated value `p`, velocity `v`, and a setpoint `target` (the value the channel would
have from animation and earlier constraints), the continuous model is:

```
p'' = strength * (target - p) + aExt / mass - dampingForce(v)
```

a spring of stiffness `strength` pulling `p` toward the animated pose, plus an external world force `aExt`
(gravity and wind, projected into the bone's frame and divided by inertial `mass`), minus a viscous damping
that bleeds energy so the oscillation settles. At rest the bone sits exactly on its animated pose (`p =
target`, `v = 0`), so a constraint with zero effect is indistinguishable from no constraint. Every schema
field below is one term of this model. The model is integrated with a symplectic integrator at a fixed
timestep on an integer step clock so it is deterministic and bit-reproducible across TS, C#, and GDScript.

## Decision

### 1. Physics constraint: a fourth constraint kind

Add `SkeletonDocument.physicsConstraints: PhysicsConstraint[]`, a REQUIRED array (empty when a rig has none),
mirroring `ikConstraints`/`transformConstraints`/`pathConstraints`:

```
PhysicsConstraint {
  name: string;
  bone: string;                 // the ONE bone this constraint simulates (both the driven and the reference)
  channels: PhysicsChannel[];   // non-empty, unique subset of ['x','y','rotation','scaleX','shearX']
  step: number;                 // > 0; the FIXED simulation timestep in seconds (authoring default 1/60)
  inertia: number;              // [0,1]; how much the bone lags its own animated motion (follow-through)
  strength: number;             // >= 0; spring stiffness pulling the bone back to its animated pose
  damping: number;              // [0,1]; per-step velocity retention (1 = undamped, 0 = dead)
  mass: number;                 // > 0; inertial mass; larger mass = weaker response to wind and gravity
  wind: number;                 // world +x force added to the skeleton-global wind
  gravity: number;              // world force pulling along -y, added to the skeleton-global gravity
  mix: number;                  // [0,1]; blend of the simulated value over the raw animated pose
  order?: integer(>=0);         // OPTIONAL global solve order across ALL FOUR constraint arrays (see 4)
}

PhysicsChannel = 'x' | 'y' | 'rotation' | 'scaleX' | 'shearX'
```

- **`bone` is a single bone, not an array.** Physics is a per-bone spring: the bone is BOTH the thing driven
  and its own setpoint reference (the setpoint is the bone's animated pose). This is the structural
  difference from IK/transform/path (which name a target plus a driven set) and follows directly from the
  model: there is no external target, only the bone's own animation and world forces.
- **`channels`** is the non-empty, duplicate-free set of the bone's local pose channels the constraint
  simulates. A tail rigged as a chain of bones with `rotation` physics dangles; a floating prop with `x`/`y`
  physics sways; a squash-and-jiggle belly uses `scaleX`; a wobble uses `shearX`. Naming the bone's actual
  local property (`x`, `y`, `rotation`, `scaleX`, `shearX`, matching `schema/bone.ts`) rather than inventing
  a physics-only vocabulary keeps the write-back trivial: a simulated channel is a local delta on exactly
  that bone property. `scaleY` and `shearY` are deliberately OMITTED (see Alternatives): the five channels
  are the justified expressive set, and a rigger animates the paired axis with a second channel if needed.
- **`step`** is the fixed timestep `dt` in seconds, carried IN the constraint (not a runtime global) so the
  simulation rate is DOCUMENT DATA and therefore part of the deterministic contract. The authoring default
  is `1/60`, matching the effects `simulationDt` discipline (`effects/schema/effect.ts`). `step > 0` is a
  structural refinement (`PHYSICS_STEP_RANGE`); a zero or negative step has no integer step clock.
- **`inertia`** in `[0,1]` is the follow-through knob: `0` means the bone rigidly tracks its animation (no
  secondary motion), `1` means the bone fully resists following an animated jump and then springs to catch
  up (maximum whip). It is applied ONCE per frame as a fractional carry of the pose delta (section 2.4), so
  it is the momentum-injection term, distinct from `damping` (which only removes energy).
- **`strength`** `>= 0` is the spring stiffness `k`: higher snaps the bone back to its pose faster (a stiff
  tail), lower lets it drift (a loose rope). `strength = 0` is a free channel with no restoring force
  (pure inertia and damping). Negative is `PHYSICS_STRENGTH_RANGE` (a repelling spring is unstable and
  unphysical). This is a structural refinement mirroring `IK_SOFTNESS_RANGE`.
- **`damping`** in `[0,1]` is the per-step velocity retention: `1` retains all velocity (undamped, rings
  forever), `0` kills velocity every step (dead, no oscillation). Because `step` is fixed, `damping` is
  applied as a single per-step multiply `v = v * damping` (no `dt` in the damping term; the fixed `step` is
  absorbed into the authored value). This is the numerically bounded, bit-exact choice; a `v -= v * c * dt`
  drag form would reintroduce a `dt` product and an unbounded coefficient for no expressive gain.
  `PHYSICS_DAMPING_RANGE` guards the range.
- **`mass`** `> 0` is the inertial mass. External world forces produce an acceleration `force / mass`, so a
  HEAVIER bone responds LESS to wind and gravity (documented explicitly to resolve the classic force vs
  acceleration ambiguity: gravity and wind are treated as FORCES here, not accelerations, which makes `mass`
  a monotonic, meaningful knob). `mass <= 0` is `PHYSICS_MASS_RANGE` (a division by zero or a sign flip).
  `mass` does NOT scale the spring term (`strength` is already the per-mass stiffness), so `strength` and
  `mass` are independent knobs (stiffness and weight) and neither is redundant.
- **`wind`, `gravity`** are the world-space force inputs, unbounded finite numbers. `wind` is a world `+x`
  force; `gravity` pulls along world `-y` (a positive `gravity` pulls down). They are ADDED to the
  skeleton-global defaults (section 5), so the block sets ambient weather and each constraint adds its local
  bias. They feed the `x` and `y` channels only (section 2.3); a bone with no simulated translation channel
  feels no direct external force (its rotation/scale/shear physics is pure spring plus inertia).
- **`mix`** in `[0,1]` is the output blend `lerp(target, p, mix)`: `1` is fully simulated, `0` is the raw
  animated pose (physics off). It is MULTIPLIED by the skeleton-global mix (section 5), giving the
  "global-and-per-constraint mix" the brief requires: the global block is a master fader, each constraint
  its own fader, and the product is applied. `PHYSICS_MIX_RANGE` guards the range (definition and keyed).
- **`order`** is the same optional shared solve order as ADR-0009 section 1.3 and ADR-0011 section 2.3, now
  spanning FOUR arrays (section 4).

`channels` non-empty is `PHYSICS_CHANNELS_EMPTY` and a repeated channel is `PHYSICS_CHANNEL_DUPLICATE`, both
structural custom refinements assigned to the CONSTRAINT check family (mirroring `PATH_BONES_EMPTY`). The
bone reference (`PHYSICS_BONE_MISSING`) is semantic (CONSTRAINT family).

### 2. The deterministic integrator (pinned operation by operation)

This is the heart of the ADR and the contract every runtime (TS reference, Unity C#, Godot) MUST reproduce
bit for bit in IEEE-754 `f64`. It mirrors `emitter-solve.ts` exactly: an integer step clock schedules an
integer number of fixed steps, and each step is a semi-implicit (symplectic) Euler update in a pinned
arithmetic order. Positions, velocities, and the trig projection live on the float epsilon path (like the
emitter's particle positions); only the STEP COUNT is an integer-exact event.

#### 2.1 State (per constraint)

- Per simulated channel `c`: `p_c` (the simulated value) and `v_c` (the velocity).
- Per channel `c`: `targetPrev_c` (last frame's setpoint, for the inertia carry).
- One `accFixed` integer fixed-point step accumulator for the whole constraint (one clock, all channels
  step together).

Initialized on constraint activation to `p_c = target_c`, `v_c = 0`, `targetPrev_c = target_c`,
`accFixed = 0` (the bone starts at rest on its pose; section 6 covers re-initialization).

#### 2.2 The integer step clock (mirrors `SPAWN_FIXED_ONE`)

```
STEP_FIXED_ONE = 65536                                       // 2^16 fixed-point one, identical to the emitter

// once per FRAME, given the frame delta time frameDt (seconds):
stepsFixed = roundHalfAwayFromZero(frameDt / step * STEP_FIXED_ONE)   // one divide, one multiply, one round
accFixed  += stepsFixed                                     // integer add
n          = accFixed >> 16                                 // integer steps to run this frame
accFixed  -= n << 16                                        // keep the fractional remainder exactly
```

`roundHalfAwayFromZero` is the SAME rule the emitter uses (`effects/emitter-solve.ts`); `frameDt` and `step`
are non-negative, so the tie case never bends, but the explicit rule is pinned so a native runtime matches.
`n` is an integer-exact function of accumulated time: two runtimes stepping the same `frameDt` sequence run
the identical number of steps, so the simulation cannot drift by a fractional step. Under conformance
sampling `frameDt` is a constant `1 / sampleFps`, and the accumulator carries the exact remainder between
frames. Only the per-step float math below is on the epsilon path.

#### 2.3 Per-frame precompute (once per frame, held constant across the frame's `n` steps)

Sample the constraint's keyable channels at the frame time (section 7), then combine with the skeleton
globals (section 5) to get `strength`, `damping`, `inertia`, `mass`, `windEff`, `gravityEff`, `mixEff`.
Project the world force into the bone's local frame using the bone's CURRENT world rotation (post-animation,
pre-physics), obtained via `resolveWorld(bone)` and decomposed with the ADR-0003 `decomposeWorld` routine
(`rotation = atan2(c, a)`), shared verbatim across runtimes:

```
theta   = decomposeWorld(resolveWorld(bone)).rotation      // radians; the SAME primitive ADR-0003 pins
cs      = cos(theta)
sn      = sin(theta)
Fx      = windEff                                          // world +x
Fy      = -gravityEff                                      // world -y (positive gravity pulls down)
fLocalX = Fx * cs + Fy * sn                                // world force rotated into the bone's local x axis
fLocalY = -Fx * sn + Fy * cs                               // ... and local y axis
aExt_x  = fLocalX / mass
aExt_y  = fLocalY / mass
aExt_rotation = 0                                          // external forces feed translation only (see below)
aExt_scaleX   = 0
aExt_shearX   = 0
```

External forces feed the `x` and `y` channels only. A single bone has no first-principles lever arm, moment
of inertia, or compliance for gravity to torque, stretch, or shear it directly; those effects emerge through
the rig (a parent's translation physics propagates to children) and through inertia, not through an invented
per-bone torque/compliance model. So `rotation`, `scaleX`, `shearX` are pure spring-plus-inertia oscillators
(exactly what secondary-motion jiggle is), and the external-force model stays a clean 2D world-force
projection. `resolveWorld` and the trig are evaluated ONCE per frame, not per step, both for determinism (a
single pinned evaluation) and to keep the per-step loop allocation-free and cheap (Lane B, PP-B7).

#### 2.4 Per-frame inertia carry (once per frame, before the step loop), per channel `c`

```
target_c    = the sampled animated-pose setpoint for channel c this frame
delta       = target_c - targetPrev_c
p_c         = p_c + delta * (1 - inertia)                  // inertia=0 -> p tracks target; inertia=1 -> p lags fully
targetPrev_c = target_c
```

(Skipped and replaced by a hard reset on a detected teleport, section 6.)

#### 2.5 The fixed step (semi-implicit / symplectic Euler), run `n` times, per channel `c`

Each numbered line is a single `f64` operation evaluated left to right, with NO fused multiply-add (a native
runtime MUST NOT contract `a * b + c` into an FMA, because FMA changes the rounding and would desync). This
is the identical order and integrator as the emitter's per-particle step (`accel, then drag, then position`):

```
1. disp = target_c - p_c            // displacement from the setpoint
2. acc  = disp * strength           // spring acceleration
3. acc  = acc + aExt_c              // add the external acceleration (0 for rotation/scaleX/shearX)
4. v_c  = v_c + acc * step          // symplectic velocity integrate (uses the NEW acceleration)
5. v_c  = v_c * damping             // per-step velocity retention
6. p_c  = p_c + v_c * step          // symplectic position integrate (uses the NEW velocity)
```

Semi-implicit Euler updates velocity first and then advances position with the JUST-updated velocity (line 6
reads the line 4/5 result), which is the energy-stable, symplectic choice and is exactly what the emitter
does. The `target_c` setpoint is constant across the frame's `n` steps (animation does not advance mid-frame).

#### 2.6 Output write-back, per channel `c`, after the `n` steps

```
out_c = target_c + (p_c - target_c) * mixEff               // lerp(target, p, mixEff), pinned as target + (p-target)*mix
```

`out_c` is the LOCAL value written to the bone's channel `c`. Physics writes LOCAL only, consistent with
ADR-0003 ("constraints write local; step 4 recomputes world from local"). Physics solves in solve-order step
3 alongside the other constraints, LAST by default (IK, then transform, then path, then physics; section 4),
so its setpoint is the pose produced by the earlier constraints and its local write is seen by the step-4
world pass. Deform, skinning, and rendering (steps 5 to 6) are unchanged.

### 3. Pose space, not world space (justified)

The simulation runs in the bone's LOCAL (pose) space: `p_c` is a local channel value, and the only world
quantity consumed is the one-shot rotation `theta` used to project world forces into local `x`/`y`. This is
the deliberate choice over a world-space simulation:

- The output is a LOCAL delta the solve writes directly (ADR-0003), keeping "constraints write local"
  uniform across IK, transform, path, and physics and keeping the step-4 world pass a clean single forward
  pass.
- The per-step integrator is a scalar per channel (six pinned float ops), which minimizes the cross-language
  arithmetic surface that must bit-agree. A world-space simulation would decompose and recompose the bone's
  world matrix every step and solve world-to-local on write, multiplying the per-step op count and the drift
  risk for no expressive gain.
- The world force projection reuses the ADR-0003 `decomposeWorld` primitive already reimplemented and
  conformance-locked in every runtime, so it introduces no new cross-language primitive.

### 4. The shared constraint order now spans four arrays

The optional `order` (ADR-0009 section 1.3, ADR-0011 section 2.3) is a single dense-unique permutation of
`[0, N)` over the COMBINED constraint set, which now spans `ikConstraints`, then `transformConstraints`,
then `pathConstraints`, then `physicsConstraints` (constraint names are unique across ALL FOUR arrays, one
namespace, so one order space). All-or-none and the dense-permutation rule are unchanged
(`CONSTRAINT_ORDER_INVALID`); the order validator is extended to enumerate the fourth array. Omitted
everywhere means the default order: all IK, then all transform, then all path, then all physics, each in
array order (physics is secondary motion layered on the final posed skeleton, so it defaults LAST; Lane B
owns the sort). Constraint-name uniqueness (`CONSTRAINT_NAME_DUPLICATE`) and skin-scoped `constraints`
resolution (`SKIN_CONSTRAINT_UNKNOWN`, ADR-0009 section 5) are likewise extended to include physics
constraints in the combined name set.

### 5. Skeleton-level physics settings (global gravity, wind, and the master mix)

Add an OPTIONAL `SkeletonDocument.physics` block (like `metadata`: absent means the identity defaults):

```
PhysicsSettings {
  gravity: number;   // world default gravity, ADDED to each constraint's gravity
  wind: number;      // world default wind, ADDED to each constraint's wind
  mix: number;       // [0,1] master mix, MULTIPLIED into each constraint's mix
}
```

The per-constraint combine (section 2.3) is:

```
windEff    = physics.wind    + constraint.wind        // ambient plus local bias
gravityEff = physics.gravity + constraint.gravity
mixEff     = clamp01(physics.mix * constraint.mix)    // master fader times local fader
```

When the block is absent the defaults are `gravity = 0`, `wind = 0`, `mix = 1` (so `windEff`/`gravityEff`
reduce to the per-constraint value and `mixEff` to the per-constraint mix). The three fields are REQUIRED
WITHIN the block (a total shape: if you author global physics you set all three), keeping downstream code
free of per-field fallbacks; the BLOCK is optional so a rig with no global weather adds nothing. `mix` reuses
the `PHYSICS_MIX_RANGE` refinement. The migration does NOT inject this block (its absence is valid).

This block is what makes the "global-and-per-constraint mix" real: one master `mix` scales every constraint,
and a single `wind`/`gravity` pair sets scene weather that each constraint biases, which is how an author
tunes a whole character's liveliness or turns all physics off with one fader.

### 6. Reset semantics (skin change and teleport)

Physics carries velocity across frames, so a discontinuity in the setpoint (a skin swap that repositions the
bone, or an animation cut that teleports it) would fling the bone unless the state is reset. The pinned
semantics:

- **Activation / (re)start.** On constraint creation, animation (re)start, or first evaluation, initialize
  as in section 2.1 (`p_c = target_c`, `v_c = 0`, `targetPrev_c = target_c`, `accFixed = 0`): the bone
  starts at rest on its pose.
- **Skin change.** When the active skin changes such that this constraint's skin-scoped activation changes
  (the constraint becomes newly active, or the bound bone's skin-scoped participation changes, ADR-0009
  section 5), reset as at activation. A skin swap can teleport a bone; carrying stale velocity would sling
  it across the frame.
- **Teleport.** Each frame, before the inertia carry (section 2.4), measure the setpoint TRANSLATION jump:
  if both `x` and `y` are simulated, `d = sqrt(dx*dx + dy*dy)`; if only one translation channel is
  simulated, `d = |delta|` of that channel; if no translation channel is simulated, `d` is the magnitude of
  the bone's local setup-to-pose `(x, y)` delta. If `d > RESET_DISTANCE`, treat the frame as a teleport:
  set `p_c = target_c` and `v_c = 0` for EVERY channel and SKIP the inertia carry this frame (the bone
  snaps to the new pose at rest rather than whipping across the gap). A non-finite setpoint likewise resets.

`RESET_DISTANCE` is a pinned model constant expressed in the bone's local translation units; its default is
owned by the PP-B7 solve ADR (a solve constant, deliberately NOT a 0.6.0 format field: v1 keeps the schema
minimal and adds no author knob for teleport sensitivity), and its default MUST be a distance a bone would
never traverse in one animation frame under normal motion (so ordinary keyframed movement never trips it,
only a cut or a skin swap does). Promoting `RESET_DISTANCE` to a per-constraint or per-skeleton format field
is a later additive stage if authoring feedback demands it. This ADR fixes the SEMANTICS (what a reset does
and when it fires); PP-B7 fixes the exact default constant under the behavior-change gate.

### 7. Physics-constraint timelines

Add `Animation.physics: Record<constraintName, Keyframe<PhysicsFrame>[]>`, a REQUIRED record (empty when an
animation keys none), mirroring `ik`/`transform`/`path`:

```
PhysicsFrame {           // a PARTIAL record; a frame may key any subset of these channels
  mix?: number;          // [0,1]
  inertia?: number;      // [0,1]
  strength?: number;     // >= 0
  damping?: number;      // [0,1]
  wind?: number;         // finite
  gravity?: number;      // finite
}
```

The keyable set is `{ mix, inertia, strength, damping, wind, gravity }`: the dynamic knobs an author wants
to animate (a gust of `wind`, a `strength` that stiffens for a beat, a `mix` that fades physics in). Three
fields are DELIBERATELY NOT keyable:

- **`step`** is the determinism anchor. The integer step clock (section 2.2) accumulates fractional steps
  against a FIXED `step`; keying it mid-animation would change the step size between frames and break the
  bit-exact accumulation. `step` is constant for the life of the constraint, so it is structural only.
- **`mass`** is a static inertial property of the bone; keeping it constant avoids re-deriving the
  force-to-acceleration scale per frame and keeps the keyable set to the expressive knobs.
- **`channels`** (the simulated set) is structural: adding or removing a simulated channel mid-animation is a
  rig change, not an animation value, and would require creating or discarding channel state mid-run.

The constraint `name` a `physics` timeline keys must reference an existing PHYSICS constraint
(`ANIM_PHYSICS_UNKNOWN`, ANIM family, mirroring `ANIM_PATH_UNKNOWN`). Present `mix`/`inertia`/`damping`
channels are range-checked to `[0, 1]` and `strength` to `>= 0` with the SAME refinements as the constraint
definition (so a keyed value faults with the same `PHYSICS_*_RANGE` code); `wind`/`gravity` are unbounded
finite. Frames are strict-ascending interpolated value timelines (format-contract section 4.8), range and
order checked like the other constraint timelines. The MEANING of an absent channel during a frame (hold the
setup value, per the standard timeline model) is solve semantics owned by `runtime-core`; the format assigns
none.

### 8. New error codes

Ten codes are added to `FORMAT_ERROR_CODES`, appended after the F3 set (array order is not semantic; the
frozen-union guard test is updated to match).

| Code | Family | Layer | Fault |
|---|---|---|---|
| `PHYSICS_STEP_RANGE` | SCHEMA | structural refinement | `step <= 0` (no valid fixed timestep) |
| `PHYSICS_INERTIA_RANGE` | SCHEMA | structural refinement | `inertia` outside `[0, 1]` (definition or frame) |
| `PHYSICS_STRENGTH_RANGE` | SCHEMA | structural refinement | `strength < 0` (definition or frame) |
| `PHYSICS_DAMPING_RANGE` | SCHEMA | structural refinement | `damping` outside `[0, 1]` (definition or frame) |
| `PHYSICS_MASS_RANGE` | SCHEMA | structural refinement | `mass <= 0` (a division by zero or sign flip) |
| `PHYSICS_MIX_RANGE` | SCHEMA | structural refinement | a physics `mix` (definition, settings, or frame) outside `[0, 1]` |
| `PHYSICS_CHANNELS_EMPTY` | CONSTRAINT | structural refinement | the simulated channel set is empty |
| `PHYSICS_CHANNEL_DUPLICATE` | CONSTRAINT | structural refinement | a channel is listed more than once |
| `PHYSICS_BONE_MISSING` | CONSTRAINT | semantic | the bound bone does not resolve |
| `ANIM_PHYSICS_UNKNOWN` | ANIM | semantic | a physics timeline references a missing physics constraint |

The six `*_RANGE` codes are SCHEMA-family structural refinements (like `IK_SOFTNESS_RANGE`, `PATH_MIX_RANGE`,
and the other mix ranges); distinct codes per parameter so a reviewer sees which knob faulted.
`PHYSICS_CHANNELS_EMPTY`/`PHYSICS_CHANNEL_DUPLICATE` are structural custom refinements assigned to the
CONSTRAINT family (like `PATH_BONES_EMPTY`): the layer is structural, the CHECK family is CONSTRAINT.
`PHYSICS_BONE_MISSING` and `ANIM_PHYSICS_UNKNOWN` are semantic. Each code ships with a committed negative
fixture named exactly by the code (format-contract WP-F.10) and a family entry in the corpus family map.

### 9. Classification and version

Adding the REQUIRED root `physicsConstraints` array and the REQUIRED per-animation `physics` record means a
0.5.0 document (which has neither) no longer satisfies the new schema. By format-contract section 10.2 that
is a BREAKING change; pre-1.0 (section 10.3) a breaking change bumps MINOR and ships a written, tested
migration. Therefore `CURRENT_FORMAT_VERSION` moves `0.5.0 -> 0.6.0`; `SUPPORTED_FORMAT_MAJOR` stays 0; the
migration key moves `5 -> 6` so the gate routes a 0.5.x (and, through the existing chain, every older
document) through migration.

The required-not-optional choice for `physicsConstraints` and `physics` (the timeline) follows
ADR-0008/ADR-0009/ADR-0011: it matches a total document/animation shape, keeps downstream code free of `?? []`
/`?? {}` fallbacks, and a one-step migration makes old documents loadable at zero authoring cost. The OPTIONAL
skeleton `physics` SETTINGS block is the one exception (like `metadata`): its absence is a meaningful default
(no global weather, unit master mix), so it stays optional and the migration injects nothing for it. The
physics CONSTRAINT fields, the settings block, and the `order` addition are all new-and-unreferenced by a
0.5.0 document, so the migration injects only the two empty collections.

### 10. Migration 0.5.x to 0.6.0

Register the step `{ fromKey: 5, toKey: 6, targetVersion: '0.6.0' }`:

```
migrate(doc):
  inject physicsConstraints: [] on the root (preserve an existing array if already present);
  for each animation, inject physics: {} (preserve an existing record if already present);
  set formatVersion = '0.6.0';
  recompute hash over the new canonical content IFF the source hash was non-empty
  (a draft with hash '' stays a draft; hash '' is a HASH_ABSENT warning, not an error).
```

The transform is pure, forward-only, and defensive: it reads an existing value when present (so a
mislabeled-but-already-0.6.0-shaped document migrates idempotently) and supplies the empty default
otherwise. The hash MUST be recomputed because the canonical content includes `formatVersion`, the new root
array, and the new per-animation record. `runMigrations` already validates only the fully migrated result
against the current schema (ADR-0008 section 7), so a 0.1.x document walks the full six-step chain and only
the 0.6.0 result is validated. The skeleton `physics` settings block is NOT injected (absent is valid).

### 11. Process (format-contract section 11 checklist)

This ADR covers items 1 to 2 (necessity, classification). The implementing commits complete items 3 to 14:
the Zod schemas (`schema/constraint.ts` physics constraint, channel enum, parameter refinements, and settings
block; `schema/animation.ts` physics timeline; `schema/document.ts` root array and optional settings), the
ten new codes assigned to families with tests, the semantic and structural validators (`validate/physics.ts`,
the extended `validate/constraints.ts` order/name checks, `validate/semantic.ts` skin/anim extensions), the
migration plus its tests, the golden corpus (an F4 positive completeness fixture `f4-complete.json` plus one
negative fixture per new code, named by the code), the `CURRENT_FORMAT_VERSION` bump, the CHANGELOG and
README updates, and the frozen-union and barrel-surface guard tests kept in sync. Conformance fixtures and
the solve are Lane B (PP-B7), landed after this stage merges.

## Consequences

- `packages/format` receives a purely additive diff: the `PhysicsConstraint` shape and the
  `physicsConstraints` root array, the optional skeleton `physics` settings block, the `physics` animation
  timeline, their validators, and the 0.5.x to 0.6.0 migration. No existing field is removed or repurposed,
  so Law 3 holds through the version bump plus migration mechanism. `assert-format-version-stable.mjs` sees
  `0.5.0 -> 0.6.0` and requires THIS ADR (which references `0.6.0`) to pass, which is the intended gate.
- Blast radius (recorded, not fixed here; the orchestrator sequences the downstream lanes): every package
  that CONSTRUCTS a `SkeletonDocument` or an `Animation` literal (runtime-core, conformance, document-core,
  mcp-server, runtime-web, editor) must add the empty `physicsConstraints: []` root array and the empty
  `physics: {}` per-animation record, or run its input through the migration. New surfaces (physics
  constraints, the settings block, physics timelines) are opt-in and break no existing constructor.
  Documents on disk load unchanged via the migration.
- Lane B (PP-B7) owns the physics solve: the fixed-`step` semi-implicit integration exactly as section 2
  pins it, the integer step clock, the world-force projection, the inertia carry, the reset semantics and
  the `RESET_DISTANCE` default, the mix write-back, and the default IK-then-transform-then-path-then-physics
  order. Physics is deterministic and SEEDLESS (unlike the emitter's PRNG chain): the same document plus the
  same `frameDt` sequence yields the identical state on every runtime. This ADR deliberately leaves the
  runtime to Lane B and scopes the format to shape, reference validity, and the pinned model contract.

## Alternatives considered

- **Verlet integration** (position-based, velocity implicit from position history). Rejected: it carries no
  explicit velocity state, so the teleport reset and skin-change reset (section 6) would have to reset a
  position HISTORY rather than a single `v_c = 0`, and injecting the inertia carry and per-step damping is
  awkward without an explicit velocity. Semi-implicit Euler keeps clean, resettable `(p, v)` state and is the
  integrator the emitter already pins, so the two stepped systems share one determinism story.
- **RK4** (four force evaluations per step). Rejected: the force here is a cheap linear spring, so at the
  small fixed `step` RK4 buys negligible accuracy while QUADRUPLING the per-step arithmetic surface that must
  bit-agree across three languages, and RK4 is not symplectic (its energy drift differs from the emitter's
  semi-implicit convention). More ops to bit-match for no expressive gain.
- **Explicit (forward) Euler** (advance position with the OLD velocity). Rejected: it injects energy and goes
  unstable for stiff springs (high `strength`), and it diverges from the emitter's semi-implicit order.
  Semi-implicit is stable and matches the house convention.
- **World-space simulation.** Rejected (section 3): it would decompose and recompose the bone's world matrix
  every step and solve world-to-local on write, multiplying the per-step op count and the cross-language
  drift surface, for no expressive gain over pose-space plus a one-shot force projection.
- **A per-bone gravity torque and stretch/shear compliance** (so gravity directly rotates, stretches, and
  shears a single bone). Rejected: a single bone has no first-principles lever arm, moment of inertia, or
  compliance tensor; modeling them would invent parameters (rest length, area, stiffness matrices) the
  format does not carry, and the effect is better produced by the rig (parent translation physics propagating
  to children) and by inertia. External forces feed translation only; rotation/scale/shear are pure
  oscillators, which is exactly what secondary jiggle is.
- **A single collapsed `PHYSICS_RANGE` code** for all out-of-range parameters. Rejected: distinct per-knob
  codes (`PHYSICS_STEP_RANGE`, `PHYSICS_MASS_RANGE`, and the four `[0,1]` factor codes) tell a reviewer
  exactly which parameter faulted, matching the `IK_SOFTNESS_RANGE`/`PATH_MIX_RANGE` precedent of a code per
  distinct kind.
- **`scaleY` and `shearY` channels.** Rejected for v1: `x`, `y`, `rotation`, `scaleX`, `shearX` are the
  justified expressive set for secondary motion (translation sway, dangle, squash, wobble); the paired axes
  add little a rigger cannot get by simulating the listed axis, and omitting them halves the channel surface.
  Adding them later is purely additive (a wider enum, no breaking change).
- **A skeleton-global physics rate instead of a per-constraint `step`.** Rejected: a global rate would make
  `step` a runtime concern rather than document data, so two runtimes with different global defaults would
  desync. Carrying `step` in the constraint makes the timestep part of the deterministic contract, which is
  the whole point of pinning it.
- **Making `physicsConstraints`/`physics` optional to avoid the migration and blast radius.** Rejected for
  the same reasons as ADR-0008/ADR-0009/ADR-0011: the pre-1.0 migration-key gate routes old documents
  through migration regardless, so a migration is needed anyway, and optional collections would litter
  downstream code with `?? []`/`?? {}` and diverge from the total-shape discipline. The one optional addition
  (the skeleton `physics` SETTINGS block) is optional precisely because its absence is a meaningful default,
  the same call as `metadata`.
