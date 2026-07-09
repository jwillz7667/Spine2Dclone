extends RefCounted
# Transform constraint (mirrors packages/runtime-core/src/solve/transform-constraint.ts and runtimes/unity
# TransformConstraintSolve.cs, ADR-0003 section 5): read WORLD, blend in WORLD, write LOCAL. Per channel
# mix blends the constrained bone's would be world channels toward the target's world channels; per
# channel offsets add on top.

const Affine = preload("res://core/affine.gd")
const AffineChannels = preload("res://core/affine_channels.gd")
const Scalar = preload("res://core/scalar.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Pose = preload("res://core/pose.gd")


static func solve(pose: Pose, bone_index: int, target_index: int, mix: Pose.TransformMix, offset: Pose.TransformOffset) -> void:
	var target_channels := AffineChannels.decompose_world(ResolveWorld.resolve_mat(pose, target_index))
	var bone_channels := AffineChannels.decompose_world(ResolveWorld.resolve_mat(pose, bone_index))

	# worldCh = lerp(boneWorldCh, targetWorldCh, mixCh) + offsetCh. Plain (not shortest path) lerp on
	# rotation/shearY, exactly as the contract specifies.
	var blended_channels := AffineChannels.WorldChannels.new()
	blended_channels.rotation = Scalar.lerp_f(bone_channels.rotation, target_channels.rotation, mix.rotate) + offset.rotation
	blended_channels.x = Scalar.lerp_f(bone_channels.x, target_channels.x, mix.x) + offset.x
	blended_channels.y = Scalar.lerp_f(bone_channels.y, target_channels.y, mix.y) + offset.y
	blended_channels.scale_x = Scalar.lerp_f(bone_channels.scale_x, target_channels.scale_x, mix.scale_x) + offset.scale_x
	blended_channels.scale_y = Scalar.lerp_f(bone_channels.scale_y, target_channels.scale_y, mix.scale_y) + offset.scale_y
	blended_channels.shear_y = Scalar.lerp_f(bone_channels.shear_y, target_channels.shear_y, mix.shear_y) + offset.shear_y

	var blended := AffineChannels.compose_world(blended_channels)

	# Convert the blended WORLD matrix to LOCAL: local = inverse(parentWorld) * blendedWorld.
	var parent := pose.parent_indices[bone_index]
	var local: PackedFloat64Array
	if parent < 0:
		local = blended
	else:
		local = Affine.multiply(Affine.invert(ResolveWorld.parent_world_mat(pose, bone_index)), blended)
	ResolveWorld.write_local_mat(pose, bone_index, local)
