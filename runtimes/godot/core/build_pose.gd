extends RefCounted
# Build a Pose from a rig document (mirrors packages/runtime-core/src/skeleton/build-pose.ts and
# runtimes/unity BuildPose.cs). It allocates the buffers once, captures each bone's setup transform and
# each slot's setup color, active attachment name, and driving bone, resolves parent/slot bone names to
# indices, and resolves the IK/transform constraints to bone indices in document array order. A name that
# does not resolve is captured as -1 and skipped by the solve rather than crashing.

const Document = preload("res://core/document.gd")
const Pose = preload("res://core/pose.gd")
const TransformMode = preload("res://core/transform_mode.gd")


static func build(document: Document.SkeletonDocument) -> Pose:
	var bones := document.bones
	var bone_count := bones.size()
	var bone_names := []
	bone_names.resize(bone_count)
	for i in range(bone_count):
		bone_names[i] = bones[i].name

	var slots := document.slots
	var slot_count := slots.size()
	var slot_names := []
	slot_names.resize(slot_count)
	for i in range(slot_count):
		slot_names[i] = slots[i].name

	var index_by_name := {}
	for i in range(bone_count):
		index_by_name[bone_names[i]] = i

	var ik_constraints := []
	for constraint in document.ik_constraints:
		ik_constraints.append(_resolve_ik(constraint, index_by_name))

	var transform_constraints := []
	for constraint in document.transform_constraints:
		transform_constraints.append(_resolve_transform(constraint, index_by_name))

	var pose := Pose.new(bone_count, bone_names, slot_count, slot_names, ik_constraints, transform_constraints)

	for i in range(bone_count):
		var bone = bones[i]
		pose.parent_indices[i] = -1 if bone.parent == null else _lookup(index_by_name, bone.parent)
		pose.transform_modes[i] = TransformMode.from_name(bone.transform_mode)
		pose.bone_length[i] = bone.length
		var b := i * Pose.SETUP_STRIDE
		pose.setup[b] = bone.x
		pose.setup[b + 1] = bone.y
		pose.setup[b + 2] = bone.rotation
		pose.setup[b + 3] = bone.scale_x
		pose.setup[b + 4] = bone.scale_y
		pose.setup[b + 5] = bone.shear_x
		pose.setup[b + 6] = bone.shear_y

	for i in range(slot_count):
		var slot = slots[i]
		pose.slot_bone_indices[i] = _lookup(index_by_name, slot.slot_bone)
		var b := i * Pose.SLOT_COLOR_STRIDE
		pose.slot_setup_color[b] = slot.color.r
		pose.slot_setup_color[b + 1] = slot.color.g
		pose.slot_setup_color[b + 2] = slot.color.b
		pose.slot_setup_color[b + 3] = slot.color.a
		pose.slot_setup_attachment[i] = slot.attachment

	return pose


static func _lookup(index_by_name: Dictionary, name) -> int:
	return index_by_name.get(name, -1)


static func _resolve_bone_indices(names: PackedStringArray, index_by_name: Dictionary) -> PackedInt32Array:
	var indices := PackedInt32Array()
	indices.resize(names.size())
	for i in range(names.size()):
		indices[i] = _lookup(index_by_name, names[i])
	return indices


static func _resolve_ik(constraint, index_by_name: Dictionary) -> Pose.ResolvedIkConstraint:
	return Pose.ResolvedIkConstraint.new(
		constraint.name,
		_resolve_bone_indices(constraint.bones, index_by_name),
		_lookup(index_by_name, constraint.target),
		constraint.mix,
		constraint.bend_positive,
		constraint.softness,
		constraint.stretch,
		constraint.compress,
		constraint.uniform,
		constraint.order
	)


static func _resolve_transform(constraint, index_by_name: Dictionary) -> Pose.ResolvedTransformConstraint:
	var base_mix := Pose.TransformMix.new(
		constraint.mix_rotate,
		constraint.mix_x,
		constraint.mix_y,
		constraint.mix_scale_x,
		constraint.mix_scale_y,
		constraint.mix_shear_y
	)
	var offset := Pose.TransformOffset.new(
		constraint.offset_rotation,
		constraint.offset_x,
		constraint.offset_y,
		constraint.offset_scale_x,
		constraint.offset_scale_y,
		constraint.offset_shear_y
	)
	return Pose.ResolvedTransformConstraint.new(
		constraint.name,
		_resolve_bone_indices(constraint.bones, index_by_name),
		_lookup(index_by_name, constraint.target),
		base_mix,
		offset,
		constraint.local,
		constraint.relative,
		constraint.order
	)
