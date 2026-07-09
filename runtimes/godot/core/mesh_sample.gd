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
	# A plain mesh resolves to itself; a linked mesh (ADR-0011 section 1) resolves its geometry through the
	# parent chain and its deform key through the `timelines`-sharing chain.
	var resolved = _resolve_mesh_geometry(document, skin_name, slot_name, attachment_name)
	if resolved == null:
		return -1
	var animation = document.find_animation(animation_id)
	if animation == null:
		push_error("animation not found: %s" % animation_id)
		return -1

	var slot_index := _index_of(pose.slot_names, slot_name)
	var slot_bone_index := pose.slot_bone_indices[slot_index] if slot_index >= 0 else -1
	var vertex_count := skin_mesh_into(resolved["geometry"], pose, slot_bone_index, output)

	var prepared = Sample.get_prepared_animation(pose, animation)
	var channel = _find_deform_channel(
		prepared.deform_channels, resolved["deform_skin"], resolved["deform_slot"], resolved["deform_name"]
	)
	if channel != null:
		var offsets := _ensure_deform_scratch(pose, channel.track.component_count)
		_sample_deform_into(channel.track, t, offsets)
		Deform.apply_deform(output, offsets, output, vertex_count)

	return vertex_count


# The linked-mesh chain is guaranteed acyclic by the validator (LINKED_MESH_CYCLE); this bound is a
# defensive stop so an unvalidated document cannot spin forever (mirroring the solve's other lenience).
const MAX_LINKED_MESH_DEPTH := 256


static func _lookup_attachment(document: Document.SkeletonDocument, skin_name: String, slot_name: String, attachment_name: String):
	var skin = null
	for i in range(document.skins.size()):
		if document.skins[i].name == skin_name:
			skin = document.skins[i]
			break
	if skin == null:
		return null
	var per_slot = skin.attachments.get(slot_name, null)
	if per_slot == null:
		return null
	return per_slot.get(attachment_name, null)


# Resolve the geometry mesh to skin plus the (skin, slot, name) key whose deform timeline applies (ADR-0011
# section 1). For a plain mesh this is the identity resolution (itself, its own key); for a linked mesh it
# is the parent-chain geometry root and the `timelines`-sharing deform source. Returns a Dictionary with
# keys geometry/deform_skin/deform_slot/deform_name, or null (with a pushed typed error) when the
# attachment is missing or resolves to a non-mesh.
static func _resolve_mesh_geometry(document: Document.SkeletonDocument, skin_name: String, slot_name: String, attachment_name: String):
	var attachment = _lookup_attachment(document, skin_name, slot_name, attachment_name)
	if attachment == null:
		push_error("mesh attachment not-found: %s/%s/%s" % [skin_name, slot_name, attachment_name])
		return null
	if attachment.type == "mesh":
		return {
			"geometry": attachment.mesh,
			"deform_skin": skin_name,
			"deform_slot": slot_name,
			"deform_name": attachment_name,
		}
	if attachment.type != "linkedmesh":
		push_error("mesh attachment not-a-mesh: %s/%s/%s" % [skin_name, slot_name, attachment_name])
		return null

	# Deform source: walk while the current node is a linked mesh that SHARES its parent's timelines,
	# stopping at the first node with its own timeline (a real mesh, or a linked mesh with timelines false).
	# The slot is shared across the chain; only the skin and name change per hop.
	var deform_skin := skin_name
	var deform_name := attachment_name
	var deform_node = attachment
	var deform_hop := 0
	while deform_hop < MAX_LINKED_MESH_DEPTH and deform_node != null and deform_node.type == "linkedmesh" and deform_node.timelines:
		var parent_skin_d: String = deform_node.linked_skin if deform_node.linked_skin != null else deform_skin
		var parent_name_d: String = deform_node.linked_parent
		var parent_d = _lookup_attachment(document, parent_skin_d, slot_name, parent_name_d)
		if parent_d == null:
			push_error("mesh attachment not-found: %s/%s/%s" % [parent_skin_d, slot_name, parent_name_d])
			return null
		deform_skin = parent_skin_d
		deform_name = parent_name_d
		deform_node = parent_d if parent_d.type == "linkedmesh" else null
		deform_hop += 1

	# Geometry source: walk the parent chain (regardless of timelines) to the root mesh.
	var geometry_skin := skin_name
	var node = attachment
	var geometry_hop := 0
	while geometry_hop < MAX_LINKED_MESH_DEPTH and node.type == "linkedmesh":
		var parent_skin: String = node.linked_skin if node.linked_skin != null else geometry_skin
		var parent = _lookup_attachment(document, parent_skin, slot_name, node.linked_parent)
		if parent == null:
			push_error("mesh attachment not-found: %s/%s/%s" % [parent_skin, slot_name, node.linked_parent])
			return null
		geometry_skin = parent_skin
		node = parent
		geometry_hop += 1
	if node.type != "mesh" or node.mesh == null:
		# The chain never reached a real mesh; report the origin attachment as not-a-mesh rather than
		# skinning a non-geometry (a validator would have rejected this as LINKED_MESH_PARENT_* or _CYCLE).
		push_error("mesh attachment not-a-mesh: %s/%s/%s" % [skin_name, slot_name, attachment_name])
		return null
	return {
		"geometry": node.mesh,
		"deform_skin": deform_skin,
		"deform_slot": slot_name,
		"deform_name": deform_name,
	}


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
