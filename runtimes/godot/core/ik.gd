extends RefCounted
# IK constraints (mirrors packages/runtime-core/src/solve/ik.ts and runtimes/unity Ik.cs, ADR-0003
# section 4): read WORLD positions, write LOCAL rotation, blended by mix in [0, 1]. IK never writes
# translation, scale, shear, or a world matrix; it only rotates. A matrix value is a PackedFloat64Array
# of six lanes [a, b, c, d, tx, ty].

const Affine = preload("res://core/affine.gd")
const Scalar = preload("res://core/scalar.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Pose = preload("res://core/pose.gd")

# Below this a length or a target offset is degenerate and skipped, so no division by zero.
const EPSILON := 1e-12


# Convert a desired WORLD direction angle (radians) into the LOCAL rotation (degrees) that makes the
# bone's local X axis point that way under the given parent world frame.
static func _world_dir_to_local_rot_deg(parent_world: PackedFloat64Array, world_angle_rad: float) -> float:
	var wx := cos(world_angle_rad)
	var wy := sin(world_angle_rad)
	var inv := Affine.invert(parent_world)
	var local_x := (inv[0] * wx) + (inv[2] * wy)
	var local_y := (inv[1] * wx) + (inv[3] * wy)
	return atan2(local_y, local_x) * Scalar.RAD_TO_DEG


# Write a new local rotation (and optionally scale local X by a factor) while preserving the bone's other
# local channels (ADR-0010 section 2). mix = 0 reproduces the current matrix exactly (zero delta, and the
# scale factor collapses to 1); mix = 1 lands on the solved rotation and the full scale factor.
# scale_x_mul = 1 (no stretch/compress) leaves scaleX untouched at every mix, so a non-stretching solve is
# byte-identical to the pre-F2 rotation-only write.
static func _blend_local_rotation(
	pose: Pose, bone_index: int, solved_rot_deg: float, mix: float, scale_x_mul: float
) -> void:
	var current := Affine.decompose(ResolveWorld.local_mat(pose, bone_index))
	var blended_rot := current.rotation_deg + (mix * Scalar.wrap_degrees(solved_rot_deg - current.rotation_deg))
	var blended_scale_x := current.scale_x * (1.0 + (mix * (scale_x_mul - 1.0)))
	Affine.compose_into(
		pose.local,
		bone_index * Affine.MAT2X3_STRIDE,
		current.x,
		current.y,
		blended_rot,
		blended_scale_x,
		current.scale_y,
		current.shear_x_deg,
		0.0
	)


# Soft-reach remap of the base-to-target distance for the two-bone angle solve (ADR-0010 section 2.3). It
# eases the chain into full extension so the joint does not pop straight as the target crosses the
# reachable boundary. Below the soft band (or with softness 0) it is the identity, so softness 0 is the
# exact hard solve. The result is floored at EPSILON so a pathological softness > reach cannot drive the
# cosine denominators negative.
static func _soft_reach_distance(distance: float, reach: float, softness: float) -> float:
	if softness <= 0.0:
		return distance
	var band_start := reach - softness
	if distance <= band_start:
		return distance
	var eased := reach - (softness * exp(-(distance - band_start) / softness))
	return EPSILON if eased < EPSILON else eased


# One bone IK: rotate the bone so its X axis aims at the target world position. stretch (target beyond the
# bone's length) and compress (target closer than its length) scale local X by d / len so the single
# segment reaches the target; the default (both false) leaves scale at 1 and the write is the pre-F2
# rotation-only aim.
static func solve_ik_one_bone(
	pose: Pose,
	bone_index: int,
	target_world_x: float,
	target_world_y: float,
	mix: float,
	stretch: bool,
	compress: bool
) -> void:
	if mix <= 0.0:
		return
	var world := ResolveWorld.resolve_mat(pose, bone_index)
	var dx := target_world_x - world[4]
	var dy := target_world_y - world[5]
	var distance_sq := (dx * dx) + (dy * dy)
	if distance_sq < EPSILON:
		return
	var world_angle := atan2(dy, dx)
	var solved_rot_deg := _world_dir_to_local_rot_deg(ResolveWorld.parent_world_mat(pose, bone_index), world_angle)

	# The bone's world length is its setup length scaled by its world X-axis magnitude.
	var length := pose.bone_length[bone_index] * Affine.hypot(world[0], world[1])
	var scale_x_mul := 1.0
	if length >= EPSILON:
		var distance := sqrt(distance_sq)
		if (stretch and distance > length) or (compress and distance < length):
			scale_x_mul = distance / length
	_blend_local_rotation(pose, bone_index, solved_rot_deg, mix, scale_x_mul)


# Two bone IK via the law of cosines (ADR-0003 section 4, depth per ADR-0010 section 2). The chain base is
# the parent bone's world origin, the joint is the parent's tip, and the tip is the child's tip.
# bend_positive selects which of the two mirror solutions. Depth controls: stretch lengthens the chain
# straight to a target beyond full reach; compress shrinks it to a target closer than its fold boundary;
# uniform selects whether stretch scales both bones or only the parent; softness eases the approach to full
# extension. With all at their defaults this is the exact ADR-0003 hard solve.
static func solve_ik_two_bone(
	pose: Pose,
	parent_index: int,
	child_index: int,
	target_world_x: float,
	target_world_y: float,
	bend_positive: bool,
	mix: float,
	softness: float,
	stretch: bool,
	compress: bool,
	uniform: bool
) -> void:
	if mix <= 0.0:
		return
	var parent_world := ResolveWorld.resolve_mat(pose, parent_index)
	var child_world := ResolveWorld.resolve_mat(pose, child_index)
	var len1 := pose.bone_length[parent_index] * Affine.hypot(parent_world[0], parent_world[1])
	var len2 := pose.bone_length[child_index] * Affine.hypot(child_world[0], child_world[1])
	if len1 < EPSILON or len2 < EPSILON:
		return

	var base_x := parent_world[4]
	var base_y := parent_world[5]
	var to_target_x := target_world_x - base_x
	var to_target_y := target_world_y - base_y
	var distance: float = max(Affine.hypot(to_target_x, to_target_y), EPSILON)
	var base_angle := atan2(to_target_y, to_target_x)
	var reach := len1 + len2

	# Stretch: the target is beyond full reach and the chain may lengthen. It straightens (both bones aim
	# at the target) and scales the PARENT bone's local X so the straightened tip lands on the target; the
	# child rides the parent's scale through transform inheritance (ADR-0010 section 2.1).
	if stretch and distance > reach:
		var parent_scale_mul: float
		var child_scale_mul: float
		if uniform:
			parent_scale_mul = distance / reach
			child_scale_mul = 1.0
		else:
			parent_scale_mul = (distance - len2) / len1
			child_scale_mul = len1 / (distance - len2)
		_blend_local_rotation(
			pose,
			parent_index,
			_world_dir_to_local_rot_deg(ResolveWorld.parent_world_mat(pose, parent_index), base_angle),
			mix,
			parent_scale_mul
		)
		_blend_local_rotation(
			pose,
			child_index,
			_world_dir_to_local_rot_deg(ResolveWorld.resolve_mat(pose, parent_index), base_angle),
			mix,
			child_scale_mul
		)
		return

	# Compress: the target is closer than the chain can reach by folding (inside the dead zone of radius
	# |len1 - len2|). The law of cosines below already folds the chain; compress additionally scales the
	# PARENT by d/dead so the folded tip, riding it through inheritance, shrinks to reach the near target
	# (ADR-0010 section 2.2). Softness does not apply to this near-base case. dead == 0 (equal segments)
	# leaves the ADR-0003 hard fold.
	var dead: float = abs(len1 - len2)
	var parent_scale_mul := 1.0
	var solve_distance := _soft_reach_distance(distance, reach, softness)
	if compress and dead >= EPSILON and distance < dead:
		parent_scale_mul = distance / dead
		solve_distance = distance

	# solve_distance carries the soft-reach ease near full extension; the aim direction (base_angle) always
	# points at the true target.
	var cos_angle1 := Scalar.clampd(
		((solve_distance * solve_distance) + (len1 * len1) - (len2 * len2)) / (2.0 * len1 * solve_distance), -1.0, 1.0
	)
	var angle1 := acos(cos_angle1)
	var cos_angle2 := Scalar.clampd(
		((len1 * len1) + (len2 * len2) - (solve_distance * solve_distance)) / (2.0 * len1 * len2), -1.0, 1.0
	)
	var angle2 := acos(cos_angle2)

	var bend := 1.0 if bend_positive else -1.0
	var phi1 := base_angle + (bend * angle1)
	var phi2 := phi1 + (bend * (angle2 - PI))

	_blend_local_rotation(
		pose,
		parent_index,
		_world_dir_to_local_rot_deg(ResolveWorld.parent_world_mat(pose, parent_index), phi1),
		mix,
		parent_scale_mul
	)
	_blend_local_rotation(
		pose, child_index, _world_dir_to_local_rot_deg(ResolveWorld.resolve_mat(pose, parent_index), phi2), mix, 1.0
	)
