extends RefCounted
# Transform constraint (mirrors packages/runtime-core/src/solve/transform-constraint.ts and runtimes/unity
# TransformConstraintSolve.cs, ADR-0003 section 5, variants per ADR-0009 section 1.2 / ADR-0010 section 3):
# default reads WORLD, blends in WORLD, writes LOCAL. The `local` flag switches the space (the bone's own
# local components); the `relative` flag switches the composition (a mix-scaled offset added to the bone's
# current value). Default (local false, relative false) is the exact ADR-0003 solve, so pre-variant
# fixtures are byte-identical.

const Affine = preload("res://core/affine.gd")
const AffineChannels = preload("res://core/affine_channels.gd")
const Scalar = preload("res://core/scalar.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Pose = preload("res://core/pose.gd")


# Blend one channel model toward a target under the mix and offset (ADR-0010 section 3). Absolute:
# resultCh = lerp(boneCh, targetCh, mix) + offset. Relative: resultCh = boneCh + mix * (targetCh + offset).
static func _blend_channels(bone_channels, target_channels, mix: Pose.TransformMix, offset: Pose.TransformOffset, relative: bool):
	var out := AffineChannels.WorldChannels.new()
	if relative:
		out.rotation = bone_channels.rotation + (mix.rotate * (target_channels.rotation + offset.rotation))
		out.x = bone_channels.x + (mix.x * (target_channels.x + offset.x))
		out.y = bone_channels.y + (mix.y * (target_channels.y + offset.y))
		out.scale_x = bone_channels.scale_x + (mix.scale_x * (target_channels.scale_x + offset.scale_x))
		out.scale_y = bone_channels.scale_y + (mix.scale_y * (target_channels.scale_y + offset.scale_y))
		out.shear_y = bone_channels.shear_y + (mix.shear_y * (target_channels.shear_y + offset.shear_y))
		return out
	out.rotation = Scalar.lerp_f(bone_channels.rotation, target_channels.rotation, mix.rotate) + offset.rotation
	out.x = Scalar.lerp_f(bone_channels.x, target_channels.x, mix.x) + offset.x
	out.y = Scalar.lerp_f(bone_channels.y, target_channels.y, mix.y) + offset.y
	out.scale_x = Scalar.lerp_f(bone_channels.scale_x, target_channels.scale_x, mix.scale_x) + offset.scale_x
	out.scale_y = Scalar.lerp_f(bone_channels.scale_y, target_channels.scale_y, mix.scale_y) + offset.scale_y
	out.shear_y = Scalar.lerp_f(bone_channels.shear_y, target_channels.shear_y, mix.shear_y) + offset.shear_y
	return out


static func solve(pose: Pose, bone_index: int, target_index: int, mix: Pose.TransformMix, offset: Pose.TransformOffset, is_local: bool, relative: bool) -> void:
	if is_local:
		# Local variant: read and write the bone's LOCAL components directly, no world round-trip.
		var target_local := AffineChannels.decompose_world(ResolveWorld.local_mat(pose, target_index))
		var bone_local := AffineChannels.decompose_world(ResolveWorld.local_mat(pose, bone_index))
		var blended_local := AffineChannels.compose_world(_blend_channels(bone_local, target_local, mix, offset, relative))
		ResolveWorld.write_local_mat(pose, bone_index, blended_local)
		return

	var target_channels := AffineChannels.decompose_world(ResolveWorld.resolve_mat(pose, target_index))
	var bone_channels := AffineChannels.decompose_world(ResolveWorld.resolve_mat(pose, bone_index))
	var blended := AffineChannels.compose_world(_blend_channels(bone_channels, target_channels, mix, offset, relative))

	# Convert the blended WORLD matrix to LOCAL: local = inverse(parentWorld) * blendedWorld.
	var parent := pose.parent_indices[bone_index]
	var local: PackedFloat64Array
	if parent < 0:
		local = blended
	else:
		local = Affine.multiply(Affine.invert(ResolveWorld.parent_world_mat(pose, bone_index)), blended)
	ResolveWorld.write_local_mat(pose, bone_index, local)
