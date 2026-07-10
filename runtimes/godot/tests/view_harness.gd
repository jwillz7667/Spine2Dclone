extends RefCounted
# Ties the engine-agnostic GDScript VIEW layer (view/*) to the committed conformance corpus, the twin of the
# runtimes/unity ViewConformanceTests. The view's mesh world positions come from the SAME mesh_sample calls
# the solve harness asserts, so gathering the draw items and comparing their world geometry to the fixtures
# proves the view path does not drift. Draw ORDER (solve-order step 6) is asserted structurally; region
# placement and atlas UV mapping have focused unit checks (the GDScript port of the C# ViewGeometryTests);
# the buffer assembler's batching invariants are checked over the whole corpus.

const RepoPaths = preload("res://tests/repo_paths.gd")
const Tolerance = preload("res://tests/tolerance.gd")
const RigReader = preload("res://core/rig_reader.gd")
const BuildPose = preload("res://core/build_pose.gd")
const Sample = preload("res://core/sample.gd")
const Pose = preload("res://core/pose.gd")
const Affine = preload("res://core/affine.gd")

const RenderModelReader = preload("res://view/render_model_reader.gd")
const RenderModel = preload("res://view/render_model.gd")
const AtlasIndex = preload("res://view/atlas_index.gd")
const RegionGeometry = preload("res://view/region_geometry.gd")
const DrawItemBuilder = preload("res://view/draw_item_builder.gd")
const MeshBufferAssembler = preload("res://view/mesh_buffer_assembler.gd")

const DEFAULT_SKIN := "default"


class Result:
	var failures: Array = []
	var comparisons: int = 0

	func ok() -> bool:
		return failures.is_empty()

	func fail(message: String) -> void:
		failures.append(message)


# Run the view comparisons for one rig. Loads the rig (solve document + render model + atlas), samples the
# pose at the spec times (mirroring the conformance harness, physics frame delta included), gathers the draw
# items, and compares mesh world positions, draw order, blend/tint, and sequence names against the fixture.
static func run(rig_id: String) -> Result:
	var result := Result.new()

	var rig_text := FileAccess.get_file_as_string(RepoPaths.rig_json(rig_id))
	var document = RigReader.parse(rig_text)
	if document is RigReader.RigReadError:
		result.fail("[%s] rig read error: %s" % [rig_id, document.message])
		return result

	var render_model = RenderModelReader.parse(rig_text)
	if render_model is RenderModelReader.RenderModelReadError:
		result.fail("[%s] render model read error: %s" % [rig_id, render_model.message])
		return result

	var atlas := AtlasIndex.new(render_model.atlas)
	var pose := BuildPose.build(document)

	var slot_index_by_name := {}
	for i in range(pose.slot_names.size()):
		slot_index_by_name[pose.slot_names[i]] = i

	var spec = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.sample_spec(rig_id)))
	var fixture = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.fixture(rig_id)))
	var pose_times: Array = spec["poseTimes"]
	var animation_id := String(spec["animation"])
	var active_skins: Array = spec.get("activeSkins", [])
	var samples: Array = fixture["samples"]

	var draw_list := DrawItemBuilder.SkeletonDrawList.new()
	var batches := MeshBufferAssembler.RenderBatchSet.new()

	for s in range(samples.size()):
		var sample: Dictionary = samples[s]
		var time := float(sample["time"])
		var active_skin = active_skins[s] if s < active_skins.size() else null
		var frame_dt := 0.0 if s == 0 else float(pose_times[s]) - float(pose_times[s - 1])
		Sample.sample_skeleton(document, animation_id, time, pose, active_skin, frame_dt)

		DrawItemBuilder.build_into(document, render_model, atlas, pose, DEFAULT_SKIN, animation_id, time, draw_list)

		_compare_meshes(result, rig_id, time, sample, pose, draw_list, slot_index_by_name)
		_compare_draw_order(result, rig_id, time, draw_list, pose)
		_compare_slots(result, rig_id, time, sample, pose, draw_list, slot_index_by_name, render_model)
		_compare_sequences(result, rig_id, time, sample, pose, draw_list, slot_index_by_name, render_model)
		_compare_batches(result, rig_id, time, draw_list, batches)

	return result


# Mesh draw-item world positions match the fixture (within VERTEX tolerance) for the ACTIVE attachment. The
# fixture may also capture a slot's non-active attachments (solve coverage); the view draws only the active
# one, so those are skipped.
static func _compare_meshes(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, draw_list, slot_index_by_name: Dictionary) -> void:
	if not sample.has("meshes"):
		return
	for expected_mesh in sample["meshes"]:
		var slot_name := String(expected_mesh["slot"])
		var attachment_name := String(expected_mesh["attachment"])
		if not slot_index_by_name.has(slot_name):
			result.fail("[%s] mesh slot '%s' at t=%s not in pose" % [rig_id, slot_name, time])
			continue
		var slot_index: int = slot_index_by_name[slot_name]
		if pose.slot_attachment[slot_index] != attachment_name:
			continue

		var item = _find_item(draw_list, slot_index)
		if item == null:
			result.fail("[%s] no draw item for slot '%s' at t=%s" % [rig_id, slot_name, time])
			continue

		var positions: Array = expected_mesh["positions"]
		if item.vertex_count * 2 != positions.size():
			result.fail("[%s] mesh '%s' vertex count at t=%s: fixture %d, view %d" % [rig_id, attachment_name, time, positions.size(), item.vertex_count * 2])
			continue

		for lane in range(positions.size()):
			var expected_value := float(positions[lane])
			var actual_value: float = item.world_positions[lane]
			result.comparisons += 1
			if not Tolerance.VERTEX.within(actual_value, expected_value):
				result.fail("[%s] mesh '%s' lane %d at t=%s drifts: fixture %s, view %s" % [rig_id, attachment_name, lane, time, expected_value, actual_value])


# Every gathered draw item sits at its own render position in the solved draw order (solve-order step 6).
static func _compare_draw_order(result: Result, rig_id: String, time: float, draw_list, pose: Pose) -> void:
	var previous := -1
	for i in range(draw_list.count):
		var item = draw_list.item(i)
		if item.render_position <= previous:
			result.fail("[%s] draw item %d render position %d did not ascend at t=%s" % [rig_id, i, item.render_position, time])
		previous = item.render_position
		result.comparisons += 1
		if pose.draw_order[item.render_position] != item.slot_index:
			result.fail("[%s] draw item %d at t=%s: draw order slot %d, item slot %d" % [rig_id, i, time, pose.draw_order[item.render_position], item.slot_index])


# rig-blendmodes: each region slot's draw item carries the slot's static blend mode EXACTLY and its resolved
# LIGHT tint equals the pose slot color times the (white) attachment color (COLOR tolerance).
static func _compare_slots(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, draw_list, slot_index_by_name: Dictionary, render_model) -> void:
	if not sample.has("slots"):
		return
	for expected_slot in sample["slots"]:
		var slot_name := String(expected_slot["slot"])
		if not slot_index_by_name.has(slot_name):
			continue
		var slot_index: int = slot_index_by_name[slot_name]
		var item = _find_item(draw_list, slot_index)
		if item == null:
			continue

		var expected_blend := String(expected_slot["blendMode"])
		result.comparisons += 1
		if item.blend != expected_blend:
			result.fail("[%s] slot '%s' at t=%s blend: fixture '%s', view '%s'" % [rig_id, slot_name, time, expected_blend, item.blend])

		var color: Array = expected_slot["color"]
		var actual := [item.tint.r, item.tint.g, item.tint.b, item.alpha]
		for k in range(4):
			result.comparisons += 1
			if not Tolerance.COLOR.within(actual[k], float(color[k])):
				result.fail("[%s] slot '%s' color lane %d at t=%s: fixture %s, view %s" % [rig_id, slot_name, k, time, float(color[k]), actual[k]])


# rig-sequences: the region slot's draw item resolves its atlas region NAME through the sequence, matching
# the fixture's resolved integer frame turned into a name (the renderer's naming job).
static func _compare_sequences(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, draw_list, slot_index_by_name: Dictionary, render_model) -> void:
	if not sample.has("sequences"):
		return
	for expected in sample["sequences"]:
		var slot_name := String(expected["slot"])
		if not slot_index_by_name.has(slot_name):
			continue
		var slot_index: int = slot_index_by_name[slot_name]
		var item = _find_item(draw_list, slot_index)
		if item == null:
			continue

		var skin = render_model.find_skin(DEFAULT_SKIN)
		var active_name = pose.slot_attachment[slot_index]
		var attachment = skin.find(slot_name, active_name)
		var expected_name := DrawItemBuilder.render_sequence_name(attachment.region.path, attachment.sequence, int(expected["frame"]))
		result.comparisons += 1
		if item.region_path != expected_name:
			result.fail("[%s] sequence slot '%s' at t=%s: fixture name '%s', view '%s'" % [rig_id, slot_name, time, expected_name, item.region_path])


# The buffer assembler conserves geometry and keeps indices within their batch vertex range.
static func _compare_batches(result: Result, rig_id: String, time: float, draw_list, batches) -> void:
	MeshBufferAssembler.assemble(draw_list, batches)

	var item_vertices := 0
	var item_indices := 0
	for i in range(draw_list.count):
		var item = draw_list.item(i)
		if item.vertex_count == 0 or item.triangle_index_count == 0:
			continue
		item_vertices += item.vertex_count
		item_indices += item.triangle_index_count

	var batch_vertices := 0
	var batch_indices := 0
	for b in range(batches.count):
		var batch = batches.batch(b)
		batch_vertices += batch.vertex_count
		batch_indices += batch.index_count
		for t in range(batch.index_count):
			var index: int = batch.indices[t]
			result.comparisons += 1
			if index < 0 or index >= batch.vertex_count:
				result.fail("[%s] batch %d index %d out of range [0, %d) at t=%s" % [rig_id, b, index, batch.vertex_count, time])

	if item_vertices != batch_vertices or item_indices != batch_indices:
		result.fail("[%s] batching lost geometry at t=%s: items v=%d i=%d, batches v=%d i=%d" % [rig_id, time, item_vertices, item_indices, batch_vertices, batch_indices])


static func _find_item(draw_list, slot_index: int):
	for i in range(draw_list.count):
		if draw_list.item(i).slot_index == slot_index:
			return draw_list.item(i)
	return null


# Focused unit checks (the GDScript port of the C# ViewGeometryTests): region-quad world placement and atlas
# UV mapping, derived by hand so a drift in the port fails here rather than only in a whole-frame comparison.
static func run_geometry_units() -> Result:
	var result := Result.new()

	var region := RenderModel.RenderRegion.new()
	region.path = "r"
	region.x = 0.0
	region.y = 0.0
	region.rotation = 0.0
	region.scale_x = 1.0
	region.scale_y = 1.0
	region.width = 2.0
	region.height = 2.0
	region.color = Color(1, 1, 1, 1)

	# Identity bone world: unit corners (+/-0.5) scaled by 2 -> (-1,-1),(1,-1),(1,1),(-1,1).
	var identity := PackedFloat64Array([1, 0, 0, 1, 0, 0])
	var corners := PackedFloat64Array()
	corners.resize(8)
	RegionGeometry.region_world_corners(identity, region, null, corners)
	_expect_lanes(result, "identity corners", corners, [-1, -1, 1, -1, 1, 1, -1, 1])

	# Bone world scale 3 in x, translate (10, 5): x scaled then +10, y +5.
	var scaled := PackedFloat64Array([3, 0, 0, 1, 10, 5])
	RegionGeometry.region_world_corners(scaled, region, null, corners)
	_expect_lanes(result, "scaled corners", corners, [7, 4, 13, 4, 13, 6, 7, 6])

	# Partial trim: content w=1 at offset_x=1 inside original_w=2 maps unit x to [0, 0.5].
	var trim := {"offset_x": 1.0, "offset_y": 0.0, "w": 1.0, "h": 2.0, "original_w": 2.0, "original_h": 2.0}
	RegionGeometry.region_world_corners(identity, region, trim, corners)
	_expect_lanes(result, "trimmed corners", corners, [0, -1, 1, -1, 1, 1, 0, 1])

	# Atlas UV mapping (unrotated and rotated), page 100 x 200, region x=10 y=20 w=30 h=40.
	var atlas_data := RenderModel.AtlasData.new()
	var page := RenderModel.AtlasPage.new()
	page.file = "page.png"
	page.width = 100.0
	page.height = 200.0
	var unrotated := _make_region("u", 10, 20, 30, 40, false)
	var rotated := _make_region("t", 10, 20, 30, 40, true)
	page.regions.append(unrotated)
	page.regions.append(rotated)
	atlas_data.pages.append(page)
	var atlas := AtlasIndex.new(atlas_data)

	_expect_uv(result, "unrotated (0,0)", atlas.map_uv("u", 0, 0), 0.1, 0.1)
	_expect_uv(result, "unrotated (1,1)", atlas.map_uv("u", 1, 1), 0.4, 0.3)
	# Rotated: stored (h x w) = (40 x 30); (u=0,v=0) -> stored (1,0): px=10+40=50, py=20 -> (0.5, 0.1).
	_expect_uv(result, "rotated (0,0)", atlas.map_uv("t", 0, 0), 0.5, 0.1)
	# Unknown region -> identity uv and no page.
	_expect_uv(result, "unknown identity", atlas.map_uv("missing", 0.25, 0.75), 0.25, 0.75)
	result.comparisons += 1
	if atlas.page_file("missing") != null:
		result.fail("unknown region resolved a page")

	return result


static func _make_region(name: String, x: float, y: float, w: float, h: float, rotated: bool) -> RenderModel.AtlasRegion:
	var region := RenderModel.AtlasRegion.new()
	region.name = name
	region.x = x
	region.y = y
	region.w = w
	region.h = h
	region.rotated = rotated
	region.offset_x = 0.0
	region.offset_y = 0.0
	region.original_w = w
	region.original_h = h
	return region


static func _expect_lanes(result: Result, label: String, actual: PackedFloat64Array, expected: Array) -> void:
	for i in range(expected.size()):
		result.comparisons += 1
		if abs(actual[i] - float(expected[i])) > 1e-9:
			result.fail("%s lane %d: expected %s, got %s" % [label, i, expected[i], actual[i]])


static func _expect_uv(result: Result, label: String, actual: Vector2, u: float, v: float) -> void:
	# map_uv returns a Vector2, which Godot stores in float32; the page UVs feed a texture sampler, so
	# single-precision is the natural (and sufficient) width. Compare within the float32 round-off floor.
	result.comparisons += 1
	if abs(actual.x - u) > 1e-6 or abs(actual.y - v) > 1e-6:
		result.fail("%s: expected (%s, %s), got (%s, %s)" % [label, u, v, actual.x, actual.y])
