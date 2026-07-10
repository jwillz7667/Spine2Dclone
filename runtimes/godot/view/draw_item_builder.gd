extends RefCounted
# Gathers the world-space draw items from an ALREADY-solved pose, in DRAW ORDER (solve-order step 6; mirrors
# runtimes/unity DrawItemBuilder.cs and render-preview gatherDrawItemsFromPose). It reads the render-only
# geometry from the RenderModel and the world positions from the solve (region_geometry for regions,
# mesh_sample for meshes), so the drawn geometry is the behavioral oracle's output and cannot drift. The
# caller must have solved the pose to the SAME (animation_id, sample_time) it passes here.

const Affine = preload("res://core/affine.gd")
const Document = preload("res://core/document.gd")
const MeshSample = preload("res://core/mesh_sample.gd")
const Sequence = preload("res://core/sequence.gd")
const Pose = preload("res://core/pose.gd")
const RenderModel = preload("res://view/render_model.gd")
const AtlasIndex = preload("res://view/atlas_index.gd")
const RegionGeometry = preload("res://view/region_geometry.gd")
const DrawItem = preload("res://view/draw_item.gd")

# The linked-mesh chain is validator-guaranteed acyclic; this bound is a defensive stop for an unvalidated
# document, mirroring the core solve's lenience.
const MAX_LINKED_MESH_DEPTH := 256


# A reusable, growable pool of draw items plus the per-frame vertex scratch, so a per-frame host allocates
# nothing in steady state. count is the number of live items this frame (indices [0, count) are valid, in
# draw order).
class SkeletonDrawList:
	extends RefCounted
	var count: int = 0
	var vertex_scratch: PackedFloat32Array = PackedFloat32Array()
	var _pool: Array = []  # Array[DrawItem]

	func reset() -> void:
		count = 0

	func item(index: int):
		return _pool[index]

	func next():
		if count == _pool.size():
			_pool.append(DrawItem.new())
		var result = _pool[count]
		count += 1
		return result

	func ensure_vertex_scratch(lanes: int) -> PackedFloat32Array:
		if vertex_scratch.size() < lanes:
			vertex_scratch.resize(lanes)
		return vertex_scratch


# Turn a resolved integer sequence frame into an atlas region NAME (ADR-0009 section 3): the attachment path
# concatenated with (start + frame_index) rendered in base 10 and LEFT-padded with '0' to at least `digits`
# characters (never truncated). Character-for-character the render-preview / runtime-web sequenceRegionName.
static func render_sequence_name(path: String, sequence: RenderModel.RenderSequence, frame_index: int) -> String:
	var value := sequence.start + frame_index
	var digits_string := str(value)
	while digits_string.length() < sequence.digits:
		digits_string = "0" + digits_string
	return path + digits_string


# Convenience: gather into a fresh list (allocates). The Node2D renderer and tests use build_into with a
# reused SkeletonDrawList for zero steady-state allocation.
static func build(document, render_model: RenderModel.RenderModel, atlas: AtlasIndex, pose: Pose, skin_name: String, animation_id, sample_time: float) -> SkeletonDrawList:
	var list := SkeletonDrawList.new()
	build_into(document, render_model, atlas, pose, skin_name, animation_id, sample_time, list)
	return list


# Gather into a reused list (zero steady-state allocation). Clears the list, then appends one draw item per
# drawable slot in draw order.
static func build_into(document, render_model: RenderModel.RenderModel, atlas: AtlasIndex, pose: Pose, skin_name: String, animation_id, sample_time: float, out_list: SkeletonDrawList) -> void:
	out_list.reset()
	var skin = render_model.find_skin(skin_name)
	if skin == null:
		return

	for position in range(pose.slot_count):
		var slot_index := pose.draw_order[position]
		var bone_index := pose.slot_bone_indices[slot_index]
		if bone_index < 0:
			continue

		var active_name = pose.slot_attachment[slot_index]
		if active_name == null:
			continue

		var slot = document.slots[slot_index]
		var attachment = skin.find(slot.name, active_name)
		if attachment == null or attachment.kind == RenderModel.KIND_NON_DRAWING:
			continue

		_emit_drawable(document, render_model, atlas, pose, skin, skin_name, animation_id, sample_time, position, slot_index, bone_index, slot, active_name, attachment, out_list)


static func _emit_drawable(document, render_model: RenderModel.RenderModel, atlas: AtlasIndex, pose: Pose, skin, skin_name: String, animation_id, sample_time: float, render_position: int, slot_index: int, bone_index: int, slot, active_name: String, attachment: RenderModel.RenderAttachment, out_list: SkeletonDrawList) -> void:
	var attachment_color := _attachment_color(attachment)
	var color_base := slot_index * Pose.SLOT_COLOR_STRIDE
	var slot_color := pose.slot_color
	var item = out_list.next()
	item.slot_index = slot_index
	item.render_position = render_position
	item.tint = Color(
		slot_color[color_base] * attachment_color.r,
		slot_color[color_base + 1] * attachment_color.g,
		slot_color[color_base + 2] * attachment_color.b,
		1.0)
	item.alpha = slot_color[color_base + 3] * attachment_color.a
	item.blend = slot.blend_mode

	if pose.slot_has_dark_color[slot_index] == 1:
		var slot_dark := pose.slot_dark_color
		item.dark = Color(slot_dark[color_base], slot_dark[color_base + 1], slot_dark[color_base + 2], 1.0)
	else:
		item.dark = null

	var region_path := _resolve_region_path(document, pose, animation_id, sample_time, slot.name, attachment)
	item.region_path = region_path
	item.page_file = atlas.page_file(region_path)

	if attachment.kind == RenderModel.KIND_REGION:
		_emit_region(pose, atlas, bone_index, attachment.region, region_path, item)
	else:
		_emit_mesh(document, render_model, atlas, pose, skin_name, skin, animation_id, sample_time, bone_index, slot.name, active_name, attachment, region_path, item, out_list)


static func _emit_region(pose: Pose, atlas: AtlasIndex, bone_index: int, region: RenderModel.RenderRegion, region_path: String, item) -> void:
	item.ensure_capacity(4, RegionGeometry.QUAD_TRIANGLES.size())
	var bone_world := Affine.read(pose.world, bone_index * Affine.MAT2X3_STRIDE)
	var trim = atlas.trim(region_path)
	RegionGeometry.region_world_corners(bone_world, region, trim, item.world_positions)

	for corner in range(4):
		var uv := atlas.map_uv(region_path, RegionGeometry.QUAD_UVS[corner * 2], RegionGeometry.QUAD_UVS[(corner * 2) + 1])
		item.page_uvs[corner * 2] = uv.x
		item.page_uvs[(corner * 2) + 1] = uv.y

	for i in range(RegionGeometry.QUAD_TRIANGLES.size()):
		item.triangles[i] = RegionGeometry.QUAD_TRIANGLES[i]


static func _emit_mesh(document, render_model: RenderModel.RenderModel, atlas: AtlasIndex, pose: Pose, skin_name: String, skin, animation_id, sample_time: float, bone_index: int, slot_name: String, active_name: String, attachment: RenderModel.RenderAttachment, region_path: String, item, out_list: SkeletonDrawList) -> void:
	var source = _resolve_render_source_mesh(render_model, skin, skin_name, slot_name, attachment)
	if source == null:
		item.ensure_capacity(0, 0)
		return

	var vertex_count: int = source.uvs.size() / 2
	item.ensure_capacity(vertex_count, source.triangles.size())

	var scratch := out_list.ensure_vertex_scratch(vertex_count * 2)
	if animation_id != null:
		MeshSample.sample_mesh_vertices(document, animation_id, sample_time, pose, skin_name, slot_name, active_name, scratch)
	else:
		var core_mesh = _resolve_core_source_mesh(document, skin_name, slot_name, active_name)
		if core_mesh == null:
			item.ensure_capacity(0, 0)
			return
		MeshSample.skin_mesh_into(core_mesh, pose, bone_index, scratch)

	for v in range(vertex_count):
		item.world_positions[v * 2] = scratch[v * 2]
		item.world_positions[(v * 2) + 1] = scratch[(v * 2) + 1]
		var uv := atlas.map_uv(region_path, source.uvs[v * 2], source.uvs[(v * 2) + 1])
		item.page_uvs[v * 2] = uv.x
		item.page_uvs[(v * 2) + 1] = uv.y

	for i in range(source.triangles.size()):
		item.triangles[i] = source.triangles[i]


static func _attachment_color(attachment: RenderModel.RenderAttachment) -> Color:
	match attachment.kind:
		RenderModel.KIND_REGION:
			return attachment.region.color
		RenderModel.KIND_MESH:
			return attachment.mesh.color
		RenderModel.KIND_LINKED:
			return attachment.linked_mesh.color
		_:
			return Color(1, 1, 1, 1)


static func _attachment_path(attachment: RenderModel.RenderAttachment) -> String:
	match attachment.kind:
		RenderModel.KIND_REGION:
			return attachment.region.path
		RenderModel.KIND_MESH:
			return attachment.mesh.path
		RenderModel.KIND_LINKED:
			return attachment.linked_mesh.path
		_:
			return ""


# Resolve the atlas region NAME to draw: the base attachment path, or, for a sequence attachment, the name of
# the frame the sequence resolves to (setup frame at setup pose, else the mode-resolved frame from the slot's
# sequence timeline). Mirrors the sequence branch of gatherDrawItemsFromPose.
static func _resolve_region_path(document, pose: Pose, animation_id, sample_time: float, slot_name: String, attachment: RenderModel.RenderAttachment) -> String:
	var base_path := _attachment_path(attachment)
	if attachment.sequence == null:
		return base_path

	var sequence: RenderModel.RenderSequence = attachment.sequence
	var frame_index: int
	if animation_id == null:
		frame_index = sequence.setup_index
	else:
		frame_index = Sequence.sample_slot_sequence_frame(document, animation_id, sample_time, pose, slot_name)
	if frame_index >= 0:
		return render_sequence_name(base_path, sequence, frame_index)
	return base_path


# Resolve a mesh drawable's SOURCE render mesh (uvs/triangles): a plain mesh is itself; a linked mesh walks
# the parent chain (parent on the same slot in skin `linked.skin ?? current`) to the root mesh. Returns null
# when the chain never reaches a mesh (an unvalidated document).
static func _resolve_render_source_mesh(render_model: RenderModel.RenderModel, skin, skin_name: String, slot_name: String, attachment: RenderModel.RenderAttachment):
	if attachment.kind == RenderModel.KIND_MESH:
		return attachment.mesh
	if attachment.kind != RenderModel.KIND_LINKED:
		return null

	var node = attachment
	var current_skin := skin_name
	for hop in range(MAX_LINKED_MESH_DEPTH):
		if node.kind == RenderModel.KIND_MESH:
			return node.mesh
		if node.kind != RenderModel.KIND_LINKED:
			return null
		var linked: RenderModel.RenderLinkedMesh = node.linked_mesh
		var parent_skin_name = linked.skin if linked.skin != null else current_skin
		var parent_skin = render_model.find_skin(parent_skin_name)
		var parent = null
		if parent_skin != null:
			parent = parent_skin.find(slot_name, linked.parent)
		if parent == null:
			return null
		node = parent
		current_skin = parent_skin_name

	return null


# Resolve the CORE source MeshAttachment (with its vertex stream) for the setup-pose skinning path
# (animation_id == null): a plain mesh is itself; a linked mesh walks the core document's parent chain. The
# animated path never calls this (sample_mesh_vertices resolves the chain internally).
static func _resolve_core_source_mesh(document, skin_name: String, slot_name: String, attachment_name: String):
	var current_skin := skin_name
	var current_name := attachment_name
	for hop in range(MAX_LINKED_MESH_DEPTH):
		var attachment = _find_core_attachment(document, current_skin, slot_name, current_name)
		if attachment == null:
			return null
		if attachment.type == "mesh" and attachment.mesh != null:
			return attachment.mesh
		if attachment.type != "linkedmesh" or attachment.linked_parent == null:
			return null
		if attachment.linked_skin != null:
			current_skin = attachment.linked_skin
		current_name = attachment.linked_parent

	return null


static func _find_core_attachment(document, skin_name: String, slot_name: String, attachment_name: String):
	for skin in document.skins:
		if skin.name != skin_name:
			continue
		if not skin.attachments.has(slot_name):
			return null
		var by_slot: Dictionary = skin.attachments[slot_name]
		return by_slot.get(attachment_name, null)
	return null
