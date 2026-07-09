extends RefCounted
# Skinning and deform sampling (mirrors packages/runtime-core/src/skeleton/mesh-sample.ts and
# runtimes/unity MeshSample.cs): solve step 5. It REUSES a pose just produced by sample_skeleton, never
# re solving the skeleton. Output vertices are PackedFloat32Array (float32 rounding, matching the TS
# Float32Array the fixtures were generated from).

const Affine = preload("res://core/affine.gd")
const Document = preload("res://core/document.gd")
const Pose = preload("res://core/pose.gd")
const SkinSolve = preload("res://core/skin.gd")
const Deform = preload("res://core/deform.gd")
const Curves = preload("res://core/curve.gd")
const Sample = preload("res://core/sample.gd")


# Skin a mesh into world space using the pose's CURRENT bone world matrices. Weighted meshes skin through
# pose.world directly (the weighted vertex stream stores global bone indices); unweighted meshes ride a
# single slot bone. Writes 2 world space lanes per logical vertex into output and returns the vertex count.
static func skin_mesh_into(mesh, pose: Pose, slot_bone_index: int, output: PackedFloat32Array) -> int:
	var vertex_count: int = mesh.uvs.size() / 2
	var weighted: bool = mesh.bones != null and mesh.bones.size() > 0
	if weighted:
		SkinSolve.solve_skin(mesh, pose.world, output)
	else:
		var slot_bone_world := Affine.read(pose.world, slot_bone_index * Affine.MAT2X3_STRIDE)
		SkinSolve.solve_skin_unweighted(mesh, slot_bone_world, output)
	return vertex_count


# Sample a mesh attachment's FINAL world space vertices at time t (skin, then add deform). Writes 2 lanes
# per vertex into output and returns the vertex count. Returns -1 if the attachment is missing or not a
# mesh (a typed error is pushed).
static func sample_mesh_vertices(
	document: Document.SkeletonDocument,
	animation_id: String,
	t: float,
	pose: Pose,
	skin_name: String,
	slot_name: String,
	attachment_name: String,
	output: PackedFloat32Array
) -> int:
	var mesh = _resolve_mesh(document, skin_name, slot_name, attachment_name)
	if mesh == null:
		return -1
	var animation = document.find_animation(animation_id)
	if animation == null:
		push_error("animation not found: %s" % animation_id)
		return -1

	var slot_index := _index_of(pose.slot_names, slot_name)
	var slot_bone_index := pose.slot_bone_indices[slot_index] if slot_index >= 0 else -1
	var vertex_count := skin_mesh_into(mesh, pose, slot_bone_index, output)

	var prepared = Sample.get_prepared_animation(pose, animation)
	var channel = _find_deform_channel(prepared.deform_channels, skin_name, slot_name, attachment_name)
	if channel != null:
		var offsets := _ensure_deform_scratch(pose, channel.track.component_count)
		_sample_deform_into(channel.track, t, offsets)
		Deform.apply_deform(output, offsets, output, vertex_count)

	return vertex_count


static func _resolve_mesh(document: Document.SkeletonDocument, skin_name: String, slot_name: String, attachment_name: String):
	var skin = null
	for i in range(document.skins.size()):
		if document.skins[i].name == skin_name:
			skin = document.skins[i]
			break

	var attachment = null
	if skin != null:
		var per_slot = skin.attachments.get(slot_name, null)
		if per_slot != null:
			attachment = per_slot.get(attachment_name, null)

	if attachment == null:
		push_error("mesh attachment not-found: %s/%s/%s" % [skin_name, slot_name, attachment_name])
		return null
	if attachment.type != "mesh" or attachment.mesh == null:
		push_error("mesh attachment not-a-mesh: %s/%s/%s" % [skin_name, slot_name, attachment_name])
		return null
	return attachment.mesh


static func _find_deform_channel(channels: Array, skin_name: String, slot_name: String, attachment_name: String):
	for i in range(channels.size()):
		var channel = channels[i]
		if channel.skin == skin_name and channel.slot == slot_name and channel.attachment == attachment_name:
			return channel
	return null


static func _sample_deform_into(track, t: float, output: PackedFloat64Array) -> void:
	var i := Curves.find_segment_index(track.times, track.key_count, t)
	var f := Curves.segment_fraction(track, i, t)
	for c in range(track.component_count):
		output[c] = Curves.segment_component(track, i, f, c)


static func _ensure_deform_scratch(pose: Pose, length: int) -> PackedFloat64Array:
	if pose.deform_scratch.size() < length:
		pose.deform_scratch = PackedFloat64Array()
		pose.deform_scratch.resize(length)
	return pose.deform_scratch


static func _index_of(names: Array, name: String) -> int:
	for i in range(names.size()):
		if names[i] == name:
			return i
	return -1
