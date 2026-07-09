extends RefCounted
# Loads a committed rig, its sample spec, and its expected fixture, runs the shared GDScript solve at the
# spec times, and compares against the fixture using the exact A.5 tolerance policy. Integer / structural
# quantities (sample count, per index time, animation id, bone set, mesh set, vertex count, blend mode)
# compare EXACT; the world affines, mesh vertices, and slot colors compare within tolerance.

const RigReader = preload("res://core/rig_reader.gd")
const BuildPose = preload("res://core/build_pose.gd")
const Sample = preload("res://core/sample.gd")
const MeshSample = preload("res://core/mesh_sample.gd")
const Affine = preload("res://core/affine.gd")
const Pose = preload("res://core/pose.gd")
const Tolerance = preload("res://tests/tolerance.gd")
const RepoPaths = preload("res://tests/repo_paths.gd")


class Result:
	var failures: Array = []
	var max_basis_error: float = 0.0
	var max_translation_error: float = 0.0
	var max_vertex_error: float = 0.0
	var max_color_error: float = 0.0
	var lane_comparisons: int = 0

	func ok() -> bool:
		return failures.size() == 0


static func run(rig_id: String) -> Result:
	var result := Result.new()

	var rig_text := FileAccess.get_file_as_string(RepoPaths.rig_json(rig_id))
	var parsed = RigReader.parse(rig_text)
	if parsed is RigReader.RigReadError:
		result.failures.append("[%s] rig read error: %s" % [rig_id, parsed.message])
		return result
	var document = parsed

	var spec = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.sample_spec(rig_id)))
	var fixture = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.fixture(rig_id)))
	var pose_times: Array = spec["poseTimes"]
	var samples: Array = fixture["samples"]
	var animation_id: String = spec["animation"]

	if pose_times.size() != samples.size():
		result.failures.append(
			"[%s] sample count mismatch: spec has %d poseTimes, fixture has %d samples"
			% [rig_id, pose_times.size(), samples.size()]
		)
		return result

	var pose := BuildPose.build(document)
	var bone_index_by_name := {}
	for i in range(pose.bone_names.size()):
		bone_index_by_name[pose.bone_names[i]] = i
	var slot_index_by_name := {}
	for i in range(pose.slot_names.size()):
		slot_index_by_name[pose.slot_names[i]] = i
	var slot_blend_by_name := {}
	for slot in document.slots:
		slot_blend_by_name[slot.name] = slot.blend_mode

	var max_mesh_lanes := _max_mesh_lanes(samples)
	var vertex_scratch := PackedFloat32Array()
	if max_mesh_lanes > 0:
		vertex_scratch.resize(max_mesh_lanes)

	for s in range(samples.size()):
		var sample: Dictionary = samples[s]
		var time: float = sample["time"]
		if time != float(pose_times[s]):
			result.failures.append(
				"[%s] sample %d time mismatch: spec %s, fixture %s" % [rig_id, s, pose_times[s], time]
			)
			continue
		if String(sample["animation"]) != animation_id:
			result.failures.append(
				"[%s] sample at t=%s animation mismatch: spec '%s', fixture '%s'"
				% [rig_id, time, animation_id, sample["animation"]]
			)
			continue

		Sample.sample_skeleton(document, animation_id, time, pose)

		var expected_bones: Dictionary = sample["bones"]
		for bone_name in expected_bones:
			if not bone_index_by_name.has(bone_name):
				result.failures.append(
					"[%s] bone '%s' at t=%s is not in the solved pose" % [rig_id, bone_name, time]
				)
				continue
			_compare_affine(result, rig_id, time, bone_name, expected_bones[bone_name], pose, bone_index_by_name[bone_name])

		_compare_meshes(result, rig_id, document, animation_id, time, sample, pose, vertex_scratch)
		_compare_slots(result, rig_id, time, sample, pose, slot_index_by_name, slot_blend_by_name)

	return result


static func _compare_affine(result: Result, rig_id: String, time: float, bone_name: String, expected: Array, pose: Pose, bone_index: int) -> void:
	var world_offset := bone_index * Affine.MAT2X3_STRIDE
	for lane in range(6):
		var expected_value := float(expected[lane])
		var actual_value := pose.world[world_offset + lane]
		var tol = Tolerance.for_lane(lane)
		var delta := absf(actual_value - expected_value)
		if lane < 4:
			result.max_basis_error = max(result.max_basis_error, delta)
		else:
			result.max_translation_error = max(result.max_translation_error, delta)
		result.lane_comparisons += 1
		if not tol.within(actual_value, expected_value):
			result.failures.append(
				"[%s] bone '%s' world lane %d at t=%s drifts: expected %s, actual %s, delta %s"
				% [rig_id, bone_name, lane, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
			)


static func _compare_meshes(result: Result, rig_id: String, document, animation_id: String, time: float, sample: Dictionary, pose: Pose, vertex_scratch: PackedFloat32Array) -> void:
	if not sample.has("meshes"):
		return
	var meshes: Array = sample["meshes"]
	for expected_mesh in meshes:
		var skin_name := String(expected_mesh["skin"])
		var slot_name := String(expected_mesh["slot"])
		var attachment_name := String(expected_mesh["attachment"])
		var positions: Array = expected_mesh["positions"]

		var vertex_count := MeshSample.sample_mesh_vertices(
			document, animation_id, time, pose, skin_name, slot_name, attachment_name, vertex_scratch
		)
		if vertex_count < 0:
			result.failures.append(
				"[%s] mesh '%s/%s/%s' at t=%s failed to sample" % [rig_id, skin_name, slot_name, attachment_name, time]
			)
			continue
		if vertex_count * 2 != positions.size():
			result.failures.append(
				"[%s] mesh '%s/%s/%s' at t=%s vertex count mismatch: expected %d lanes, actual %d"
				% [rig_id, skin_name, slot_name, attachment_name, time, positions.size(), vertex_count * 2]
			)
			continue

		for lane in range(positions.size()):
			var expected_value := float(positions[lane])
			var actual_value := vertex_scratch[lane]
			var delta := absf(actual_value - expected_value)
			result.max_vertex_error = max(result.max_vertex_error, delta)
			result.lane_comparisons += 1
			if not Tolerance.VERTEX.within(actual_value, expected_value):
				result.failures.append(
					"[%s] mesh '%s/%s/%s' vertex lane %d at t=%s drifts: expected %s, actual %s, delta %s"
					% [rig_id, skin_name, slot_name, attachment_name, lane, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
				)


static func _compare_slots(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, slot_index_by_name: Dictionary, slot_blend_by_name: Dictionary) -> void:
	if not sample.has("slots"):
		return
	var slots: Array = sample["slots"]
	for expected_slot in slots:
		var slot_name := String(expected_slot["slot"])
		if not slot_index_by_name.has(slot_name):
			result.failures.append("[%s] slot '%s' at t=%s is not in the solved pose" % [rig_id, slot_name, time])
			continue
		var slot_index: int = slot_index_by_name[slot_name]

		var expected_blend := String(expected_slot["blendMode"])
		var actual_blend := String(slot_blend_by_name.get(slot_name, ""))
		if expected_blend != actual_blend:
			result.failures.append(
				"[%s] slot '%s' at t=%s blend mode mismatch: expected '%s', actual '%s'"
				% [rig_id, slot_name, time, expected_blend, actual_blend]
			)

		var expected_color: Array = expected_slot["color"]
		var base_index := slot_index * Pose.SLOT_COLOR_STRIDE
		for k in range(Pose.SLOT_COLOR_STRIDE):
			var expected_value := float(expected_color[k])
			var actual_value := pose.slot_color[base_index + k]
			var delta := absf(actual_value - expected_value)
			result.max_color_error = max(result.max_color_error, delta)
			result.lane_comparisons += 1
			if not Tolerance.COLOR.within(actual_value, expected_value):
				result.failures.append(
					"[%s] slot '%s' color lane %d at t=%s drifts: expected %s, actual %s, delta %s"
					% [rig_id, slot_name, k, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
				)


static func _max_mesh_lanes(samples: Array) -> int:
	var m := 0
	for sample in samples:
		if not sample.has("meshes"):
			continue
		for mesh in sample["meshes"]:
			var positions: Array = mesh["positions"]
			if positions.size() > m:
				m = positions.size()
	return m
