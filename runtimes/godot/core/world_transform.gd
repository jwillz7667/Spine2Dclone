extends RefCounted
# Solve steps 1 and 4 (mirrors packages/runtime-core/src/skeleton/world-transform.ts and runtimes/unity
# WorldTransform.cs).

const Affine = preload("res://core/affine.gd")
const TransformMode = preload("res://core/transform_mode.gd")
const Pose = preload("res://core/pose.gd")


# Solve step 1 (reset to setup pose): write each bone's local matrix from its captured setup transform.
static func reset_to_setup_pose(pose: Pose) -> void:
	var setup := pose.setup
	var local := pose.local
	var bone_count := pose.bone_count
	for i in range(bone_count):
		var s := i * Pose.SETUP_STRIDE
		Affine.compose_into(
			local,
			i * Affine.MAT2X3_STRIDE,
			setup[s],
			setup[s + 1],
			setup[s + 2],
			setup[s + 3],
			setup[s + 4],
			setup[s + 5],
			setup[s + 6]
		)


# Solve step 4 (world transforms): a single forward pass. A root's world matrix equals its local matrix;
# every other bone inherits its parent's world transform per its transformMode. The pass relies on the
# validated parent precedes child ordering (parentIndex < i).
static func compute_world_transforms(pose: Pose) -> void:
	var local := pose.local
	var world := pose.world
	var parent_indices := pose.parent_indices
	var transform_modes := pose.transform_modes
	var bone_count := pose.bone_count
	for i in range(bone_count):
		var offset := i * Affine.MAT2X3_STRIDE
		var parent := parent_indices[i]
		if parent < 0:
			Affine.copy_into(world, offset, local, offset)
		elif transform_modes[i] == TransformMode.NORMAL:
			Affine.multiply_into(world, offset, world, parent * Affine.MAT2X3_STRIDE, local, offset)
		else:
			TransformMode.world_from_parent_by_mode(
				world, offset, world, parent * Affine.MAT2X3_STRIDE, local, offset, transform_modes[i]
			)
