extends RefCounted
# Physics constraint SOLVE (mirrors packages/runtime-core/src/solve/physics-constraint.ts and runtimes/unity,
# ADR-0014 PP-B7). A physics constraint drives ONE bone with a per-channel damped-driven harmonic oscillator
# so secondary motion (tails, ropes, jiggle) emerges deterministically from the animated pose plus world
# forces. It solves in step 3 alongside the other constraints, LAST by default (IK, then transform, then path,
# then physics), writing LOCAL only (ADR-0003), so the step-4 world pass reproduces the intended world. It is
# the ONE constraint kind that steps over time, so it uses the fixed-timestep integer step clock and semi-
# implicit (symplectic) Euler EXACTLY as the emitter solve pins them: bit-reproducible within a runtime,
# tolerance-parity across TS/C#/GDScript. Seedless (no PRNG, no clock, no allocation per frame; all state is
# the pre-allocated per-constraint arrays created at skeleton build). NO fused multiply-add: each numbered op
# is one f64 op in the same order the TS oracle runs, so a native runtime cannot desync on rounding.

const Affine = preload("res://core/affine.gd")
const Scalar = preload("res://core/scalar.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Pose = preload("res://core/pose.gd")

# Fixed-point one (2^16) for the integer step accumulator, IDENTICAL to the emitter (SPAWN_FIXED_ONE). The
# step count is an integer-exact function of accumulated time, so two runtimes stepping the same frameDt
# sequence run the identical number of steps and cannot drift by a fractional step (ADR section 2.2).
const PHYSICS_STEP_FIXED_ONE := 65536

# The teleport reset threshold (ADR-0014 section 6), in the bone's LOCAL translation units. A per-frame
# setpoint TRANSLATION jump larger than this is treated as a cut / skin swap, not motion: the bone snaps to
# the new pose at rest rather than whipping across the gap.
const PHYSICS_RESET_DISTANCE := 1000.0

# Channel codes (ADR-0014 section 1), the simulated subset of a bone's LOCAL pose channels. The value is the
# code stored per simulated channel in ResolvedPhysicsConstraint.channel_codes.
const PHYSICS_CHANNEL_X := 0
const PHYSICS_CHANNEL_Y := 1
const PHYSICS_CHANNEL_ROTATION := 2
const PHYSICS_CHANNEL_SCALEX := 3
const PHYSICS_CHANNEL_SHEARX := 4

# Map a channel code to its lane in the decomposed local-transform scratch [x, y, rotationDeg, scaleX, scaleY,
# shearXDeg, shearYDeg] (SETUP_STRIDE layout). rotation/scaleX/shearX are DEGREES/linear scalars, exactly the
# format's stored fields, so the write-back is a local delta on that bone property. shearX is lane 5 (lane 4
# is the held scaleY), which is why this indirection exists.
const CHANNEL_SCRATCH_LANE := [0, 1, 2, 3, 5]

# Solver-owned scratch, reused across calls so the solve allocates nothing. The solve is single-threaded and
# never re-entrant (no physics constraint nests inside another), so static scratch is safe, matching
# resolve_world.gd's convention.
static var _local_scratch: PackedFloat64Array = PackedFloat64Array()  # decomposed local channels (SETUP_STRIDE)
static var _target_scratch: PackedFloat64Array = PackedFloat64Array()  # sampled setpoint per simulated channel (5)
static var _world_scratch: PackedFloat64Array = PackedFloat64Array()  # the bone's current world matrix (MAT2X3)


static func _ensure_scratch() -> void:
	if _local_scratch.size() != Pose.SETUP_STRIDE:
		_local_scratch.resize(Pose.SETUP_STRIDE)
	if _target_scratch.size() != 5:
		_target_scratch.resize(5)
	if _world_scratch.size() != Affine.MAT2X3_STRIDE:
		_world_scratch.resize(Affine.MAT2X3_STRIDE)


# Round-half-away-from-zero, the SAME single rounding rule the emitter uses. frameDt and step are non-negative
# here (validated), so the tie case never bends, but the explicit rule is pinned so a native runtime matches
# bit-for-bit.
static func round_half_away_from_zero(value: float) -> float:
	return -floor(-value + 0.5) if value < 0.0 else floor(value + 0.5)


# The integer number of fixed steps a frame of `frame_dt` seconds schedules against a `step`-second clock, in
# fixed-point (>> 16 to recover the integer step count, the remainder carried in the accumulator). One divide,
# one multiply, one round (ADR section 2.2). Exported as the cross-language integer primitive (seed-prng-crc-
# vectors.json physicsStepFixed): a native runtime asserts its own value equals this. int() in GDScript is
# 64-bit, matching the TS accumulator width.
static func physics_steps_fixed(frame_dt: float, step: float) -> int:
	return int(round_half_away_from_zero((frame_dt / step) * PHYSICS_STEP_FIXED_ONE))


# Decompose a bone's LOCAL matrix into the seven format channels [x, y, rotationDeg, scaleX, scaleY, shearXDeg,
# shearYDeg], written into _local_scratch. This is affine.decompose's TRS+shear parameterization (shearY fixed
# to 0), but computed allocation-free and with sqrt(a*a+b*b) rather than a hypot library call so the C#/GDScript
# mirrors use the identical formula. compose_into of the result reproduces the matrix to f64 round-off.
static func _decompose_local_into(local: PackedFloat64Array, offset: int) -> void:
	var a := local[offset]
	var b := local[offset + 1]
	var c := local[offset + 2]
	var d := local[offset + 3]
	var scale_x := sqrt((a * a) + (b * b))
	var x_axis_angle := atan2(b, a)  # == rotation (shearY fixed to 0)
	var y_axis_angle := atan2(d, c)
	var shear_x := x_axis_angle + (PI / 2.0) - y_axis_angle
	var scale_y := sqrt((c * c) + (d * d)) * cos(shear_x)
	_local_scratch[0] = local[offset + 4]  # x
	_local_scratch[1] = local[offset + 5]  # y
	_local_scratch[2] = x_axis_angle * Scalar.RAD_TO_DEG  # rotation, degrees
	_local_scratch[3] = scale_x
	_local_scratch[4] = scale_y
	_local_scratch[5] = shear_x * Scalar.RAD_TO_DEG  # shearX, degrees
	_local_scratch[6] = 0.0  # shearY (held at the decomposition convention)


static func _clamp01(value: float) -> float:
	if value < 0.0:
		return 0.0
	if value > 1.0:
		return 1.0
	return value


# Initialize (or re-initialize) a constraint's simulation state to REST on the current animated pose (ADR
# section 2.1): p_c = target_c, v_c = 0, targetPrev_c = target_c, accFixed = 0. Called on the first evaluation
# and on any activation edge (skin change / re-activation, ADR section 6).
static func _init_to_rest(constraint, channel_count: int) -> void:
	for ci in range(channel_count):
		var target := _target_scratch[ci]
		constraint.p[ci] = target
		constraint.v[ci] = 0.0
		constraint.target_prev[ci] = target
	constraint.acc_fixed = 0
	constraint.initialized = true


# Solve one physics constraint against the pose for a frame of `frame_dt` seconds (ADR-0014 section 2). Reads
# the bone's current LOCAL channels (the setpoint the earlier constraints produced), steps the per-channel
# damped spring on the integer step clock, and writes the mixed result back to LOCAL. The per-frame sampled
# scratch (mix/inertia/strength/damping/wind/gravity) was written by step 2; step/mass are static. Allocation-
# free: decompose/target/world go into module scratch, the (p, v, targetPrev) state and accumulator live on
# the pre-allocated constraint.
static func solve(pose: Pose, constraint, frame_dt: float) -> void:
	var bone_index: int = constraint.bone_index
	if bone_index < 0:
		return
	_ensure_scratch()
	var channel_codes: PackedInt32Array = constraint.channel_codes
	var channel_count := channel_codes.size()

	var local_offset := bone_index * Affine.MAT2X3_STRIDE
	_decompose_local_into(pose.local, local_offset)

	# The setpoint per simulated channel (the current animated + earlier-constraint local value).
	var non_finite := false
	for ci in range(channel_count):
		var target := _local_scratch[CHANNEL_SCRATCH_LANE[channel_codes[ci]]]
		_target_scratch[ci] = target
		if not is_finite(target):
			non_finite = true

	# Combine the sampled per-constraint knobs with the skeleton globals (ADR section 2.3 / section 5).
	var settings = pose.physics_settings
	var strength: float = constraint.sampled_strength
	var damping: float = constraint.sampled_damping
	var inertia: float = constraint.sampled_inertia
	var mass: float = constraint.base_mass
	var step: float = constraint.base_step
	var wind_eff: float = settings.wind + constraint.sampled_wind
	var gravity_eff: float = settings.gravity + constraint.sampled_gravity
	var mix_eff := _clamp01(settings.mix * constraint.sampled_mix)

	# Activation / (re)start: initialize to rest on the pose, then this frame runs its steps from rest (ADR
	# section 6). Under conformance frame 0 has frameDt 0, so the bone sits exactly on its pose.
	var just_init := false
	if not constraint.initialized:
		_init_to_rest(constraint, channel_count)
		just_init = true

	# Teleport reset (ADR section 6): a setpoint TRANSLATION jump larger than PHYSICS_RESET_DISTANCE (or a
	# non-finite setpoint) is a cut / skin swap, not motion. Snap to the new pose at rest and skip the inertia
	# carry this frame. Measured BEFORE the inertia carry, only on an already-initialized frame.
	var teleport := false
	if not just_init:
		var d: float
		if constraint.simulates_x and constraint.simulates_y:
			var dx: float = _target_scratch[constraint.channel_x] - constraint.target_prev[constraint.channel_x]
			var dy: float = _target_scratch[constraint.channel_y] - constraint.target_prev[constraint.channel_y]
			d = sqrt((dx * dx) + (dy * dy))
		elif constraint.simulates_x:
			d = absf(_target_scratch[constraint.channel_x] - constraint.target_prev[constraint.channel_x])
		elif constraint.simulates_y:
			d = absf(_target_scratch[constraint.channel_y] - constraint.target_prev[constraint.channel_y])
		else:
			# No translation channel simulated: the proxy jump is the bone's local setup-to-pose (x, y) delta.
			var setup_base := bone_index * Pose.SETUP_STRIDE
			var dx := _local_scratch[0] - pose.setup[setup_base]
			var dy := _local_scratch[1] - pose.setup[setup_base + 1]
			d = sqrt((dx * dx) + (dy * dy))
		if non_finite or d > PHYSICS_RESET_DISTANCE:
			for ci in range(channel_count):
				var target := _target_scratch[ci]
				constraint.p[ci] = target
				constraint.v[ci] = 0.0
				constraint.target_prev[ci] = target
			teleport = true

	# Per-frame inertia carry (ADR section 2.4): the bone lags its own animated motion by (1 - inertia) of the
	# pose delta. Skipped on the init frame (targetPrev == target, a no-op anyway) and on a teleport.
	if not just_init and not teleport:
		for ci in range(channel_count):
			var target := _target_scratch[ci]
			var delta: float = target - constraint.target_prev[ci]
			constraint.p[ci] = constraint.p[ci] + (delta * (1.0 - inertia))
			constraint.target_prev[ci] = target

	# Per-frame external-force precompute (ADR section 2.3): project world wind (+x) and gravity (-y) into the
	# bone's local frame using its CURRENT world rotation (post-animation, pre-physics), ONCE per frame.
	# External forces feed the x and y channels only; rotation/scaleX/shearX are pure spring+inertia oscillators
	# (aExt 0). Skipped entirely when no translation channel is simulated, so a rotation-only constraint touches
	# no transcendental (fully cross-language exact) and pays nothing.
	var a_ext_x := 0.0
	var a_ext_y := 0.0
	if constraint.simulates_x or constraint.simulates_y:
		ResolveWorld.resolve(pose, bone_index, _world_scratch, 0)
		# theta is the bone's world X-axis angle, decomposeWorld's rotation = atan2(c, a) with a = m0, c = m1.
		var theta := atan2(_world_scratch[1], _world_scratch[0])
		var cs := cos(theta)
		var sn := sin(theta)
		var fx := wind_eff  # world +x
		var fy := -gravity_eff  # world -y (positive gravity pulls down)
		var f_local_x := (fx * cs) + (fy * sn)
		var f_local_y := (-fx * sn) + (fy * cs)
		a_ext_x = f_local_x / mass
		a_ext_y = f_local_y / mass

	# The integer step clock (ADR section 2.2): schedule an integer number of fixed steps, carry the exact
	# fractional remainder. n is an integer-exact function of accumulated time, so no fractional-step drift.
	var steps_fixed := physics_steps_fixed(frame_dt, step)
	var acc_fixed: int = constraint.acc_fixed + steps_fixed
	var n := acc_fixed >> 16
	constraint.acc_fixed = acc_fixed - (n << 16)

	# Integrate and write back per channel. Each numbered op is a single f64 op (NO fused multiply-add). This is
	# the identical semi-implicit (symplectic) Euler order as the emitter's per-particle step.
	for ci in range(channel_count):
		var code: int = channel_codes[ci]
		var target := _target_scratch[ci]
		var a_ext := a_ext_x if code == PHYSICS_CHANNEL_X else (a_ext_y if code == PHYSICS_CHANNEL_Y else 0.0)
		var p: float = constraint.p[ci]
		var v: float = constraint.v[ci]
		for s in range(n):
			var disp: float = target - p  # 1. displacement from the setpoint
			var acc: float = disp * strength  # 2. spring acceleration
			acc = acc + a_ext  # 3. add the external acceleration (0 for rotation/scaleX/shearX)
			v = v + (acc * step)  # 4. symplectic velocity integrate (uses the NEW acceleration)
			v = v * damping  # 5. per-step velocity retention
			p = p + (v * step)  # 6. symplectic position integrate (uses the NEW velocity)
		constraint.p[ci] = p
		constraint.v[ci] = v
		# Output write-back (ADR section 2.6): lerp(target, p, mixEff), pinned as target + (p - target) * mix.
		_local_scratch[CHANNEL_SCRATCH_LANE[code]] = target + ((p - target) * mix_eff)

	# Recompose the LOCAL matrix from the (physics-adjusted) channels (ADR section 2.6): step 4 recomputes the
	# world from this local, so physics stays a pure local write consistent with IK/transform/path.
	Affine.compose_into(
		pose.local,
		local_offset,
		_local_scratch[0],
		_local_scratch[1],
		_local_scratch[2],
		_local_scratch[3],
		_local_scratch[4],
		_local_scratch[5],
		_local_scratch[6]
	)
