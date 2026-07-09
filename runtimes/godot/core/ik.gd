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


# Write a new local rotation while preserving the bone's other local channels.
static func _blend_local_rotation(pose: Pose, bone_index: int, solved_rot_deg: float, mix: float) -> void:
	var current := Affine.decompose(ResolveWorld.local_mat(pose, bone_index))
	var blended_rot := current.rotation_deg + (mix * Scalar.wrap_degrees(solved_rot_deg - current.rotation_deg))
	Affine.compose_into(
		pose.local,
		bone_index * Affine.MAT2X3_STRIDE,
		current.x,
		current.y,
		blended_rot,
		current.scale_x,
		current.scale_y,
		current.shear_x_deg,
		0.0
	)


# One bone IK: rotate the bone so its X axis aims at the target world position.
static func solve_ik_one_bone(pose: Pose, bone_index: int, target_world_x: float, target_world_y: float, mix: float) -> void:
	if mix <= 0.0:
		return
	var world := ResolveWorld.resolve_mat(pose, bone_index)
	var dx := target_world_x - world[4]
	var dy := target_world_y - world[5]
	if ((dx * dx) + (dy * dy)) < EPSILON:
		return
	var world_angle := atan2(dy, dx)
	var solved_rot_deg := _world_dir_to_local_rot_deg(ResolveWorld.parent_world_mat(pose, bone_index), world_angle)
	_blend_local_rotation(pose, bone_index, solved_rot_deg, mix)


# Two bone IK via the law of cosines (ADR-0003 section 4). The chain base is the parent bone's world
# origin, the joint is the parent's tip, and the tip is the child's tip. bend_positive selects which of
# the two mirror solutions.
static func solve_ik_two_bone(
	pose: Pose,
	parent_index: int,
	child_index: int,
	target_world_x: float,
	target_world_y: float,
	bend_positive: bool,
	mix: float
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

	var cos_angle1 := Scalar.clampd(
		((distance * distance) + (len1 * len1) - (len2 * len2)) / (2.0 * len1 * distance), -1.0, 1.0
	)
	var angle1 := acos(cos_angle1)
	var cos_angle2 := Scalar.clampd(
		((len1 * len1) + (len2 * len2) - (distance * distance)) / (2.0 * len1 * len2), -1.0, 1.0
	)
	var angle2 := acos(cos_angle2)

	var bend := 1.0 if bend_positive else -1.0
	var phi1 := base_angle + (bend * angle1)
	var phi2 := phi1 + (bend * (angle2 - PI))

	_blend_local_rotation(
		pose, parent_index, _world_dir_to_local_rot_deg(ResolveWorld.parent_world_mat(pose, parent_index), phi1), mix
	)
	_blend_local_rotation(
		pose, child_index, _world_dir_to_local_rot_deg(ResolveWorld.resolve_mat(pose, parent_index), phi2), mix
	)
