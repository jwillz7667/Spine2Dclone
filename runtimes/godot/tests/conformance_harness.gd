extends RefCounted
# Loads a committed rig, its sample spec, and its expected fixture, runs the shared GDScript solve at the
# spec times, and compares against the fixture using the exact A.5 tolerance policy. Integer / structural
# quantities (sample count, per index time, animation id, bone set, mesh set, vertex count, blend mode)
# compare EXACT; the world affines, mesh vertices, and slot colors compare within tolerance.

const RigReader = preload("res://core/rig_reader.gd")
const BuildPose = preload("res://core/build_pose.gd")
const Sample = preload("res://core/sample.gd")
const MeshSample = preload("res://core/mesh_sample.gd")
const Sequence = preload("res://core/sequence.gd")
const EventFire = preload("res://core/event_fire.gd")
const AttachmentGeometry = preload("res://core/attachment_geometry.gd")
const Affine = preload("res://core/affine.gd")
const Pose = preload("res://core/pose.gd")
const Tolerance = preload("res://tests/tolerance.gd")
const RepoPaths = preload("res://tests/repo_paths.gd")

# The exhaustive member allowlists (mirror the .strict() fixtureSchema in schema/fixture.ts). A fixture or
# sample carrying any member outside these sets is rejected: a NEW capture lane (future corpus growth)
# then fails LOUDLY here instead of being silently skipped, forcing the harness to grow a comparison.
const ALLOWED_TOP_LEVEL := ["rigId", "rigHash", "specHash", "coreVersion", "toolchain", "generatedBy", "samples", "events"]
const ALLOWED_SAMPLE := ["time", "animation", "loop", "bones", "meshes", "slots", "drawOrder", "sequences", "clips", "boxes", "points"]


class Result:
	var failures: Array = []
	var max_basis_error: float = 0.0
	var max_translation_error: float = 0.0
	var max_vertex_error: float = 0.0
	var max_color_error: float = 0.0
	var max_event_float_error: float = 0.0
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
	_require_known_members(result, rig_id, fixture, ALLOWED_TOP_LEVEL, "root")
	for sample in fixture["samples"]:
		_require_known_members(result, rig_id, sample, ALLOWED_SAMPLE, "sample")
	if not result.ok():
		return result

	var pose_times: Array = spec["poseTimes"]
	var samples: Array = fixture["samples"]
	var animation_id: String = spec["animation"]
	# The optional per-sample sequence-frame lane opt-in (ADR-0011 section 2): the slots whose resolved
	# sequence frame the fixture captures. Empty (or absent) means the rig captures no sequences, so the
	# sequence comparison is a no-op and every pre-existing rig behaves exactly as before.
	var capture_sequences: Array = spec.get("captureSequences", [])
	# The optional per-sample active-skin lane (ADR-0011 section 4), parallel to poseTimes: entry i is the
	# active skin (a String or null) when sampling poseTimes[i]. Absent means null everywhere, so every
	# pre-existing rig samples with no active skin exactly as before.
	var active_skins: Array = spec.get("activeSkins", [])

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

	# PP-B2 geometry-attachment capture targets (ADR-0012), resolved once from the sample-spec. Each list is
	# empty unless the spec opts in (rig-clipping / rig-hit-point), so every other rig is a no-op here.
	var clip_targets := _resolve_clip_targets(result, rig_id, document, spec, slot_index_by_name)
	var box_targets := _resolve_box_targets(result, rig_id, document, spec, slot_index_by_name)
	var point_targets := _resolve_point_targets(result, rig_id, document, spec, slot_index_by_name)
	var hit_probes: Array = spec.get("hitProbes", [])
	var clipped_scratch := PackedInt32Array()
	clipped_scratch.resize(pose.slot_count)
	if not result.ok():
		return result

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

		var active_skin = active_skins[s] if s < active_skins.size() else null
		Sample.sample_skeleton(document, animation_id, time, pose, active_skin)

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
		_compare_draw_order(result, rig_id, time, sample, pose)
		_compare_sequences(result, rig_id, document, animation_id, time, sample, pose, capture_sequences)
		_compare_clips(result, rig_id, time, sample, pose, clip_targets, clipped_scratch)
		_compare_boxes(result, rig_id, time, sample, pose, box_targets, hit_probes)
		_compare_points(result, rig_id, time, sample, pose, point_targets)

	_compare_events(result, rig_id, document, animation_id, spec, fixture)

	return result


# Reject any member of a parsed fixture object that is outside the allowlist (the .strict() analogue). A
# new capture lane fails loudly here rather than being silently dropped.
static func _require_known_members(result: Result, rig_id: String, obj: Dictionary, allowed: Array, context: String) -> void:
	for key in obj:
		if not allowed.has(key):
			result.failures.append(
				"[%s] fixture %s has unknown member '%s'; the harness has no comparison for it "
				% [rig_id, context, key] + "(add one rather than skipping the lane)"
			)


# Compare one sample's resolved render order (ADR-0008, PP-B4): an integer permutation, EXACT. Present
# only when the sample-spec captures it; absent samples short-circuit.
static func _compare_draw_order(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose) -> void:
	if not sample.has("drawOrder"):
		return
	var expected: Array = sample["drawOrder"]
	if expected.size() != pose.slot_count:
		result.failures.append(
			"[%s] draw order length mismatch at t=%s: expected %d, actual %d"
			% [rig_id, time, expected.size(), pose.slot_count]
		)
		return
	for i in range(expected.size()):
		result.lane_comparisons += 1
		if pose.draw_order[i] != int(expected[i]):
			result.failures.append(
				"[%s] draw order mismatch at t=%s, position %d: expected %d, actual %d"
				% [rig_id, time, i, int(expected[i]), pose.draw_order[i]]
			)


# Compare one sample's resolved sequence frames (ADR-0009 section 3, ADR-0011 section 2): for each slot the
# sample-spec opted in via captureSequences, resolve the discrete integer frame and compare it EXACT against
# the fixture's `sequences` lane, index by index (slot name AND frame). Present only when the spec captures
# sequences; a rig that captures none short-circuits with both sides empty, so pre-existing rigs are
# untouched. The fixture entry order MUST match captureSequences, so a misordering fails loudly here.
static func _compare_sequences(result: Result, rig_id: String, document, animation_id: String, time: float, sample: Dictionary, pose: Pose, capture_sequences: Array) -> void:
	var expected: Array = sample["sequences"] if sample.has("sequences") else []
	if capture_sequences.size() != expected.size():
		result.failures.append(
			"[%s] sequence lane length mismatch at t=%s: spec captures %d slot(s), fixture has %d entry(ies)"
			% [rig_id, time, capture_sequences.size(), expected.size()]
		)
		return
	for i in range(capture_sequences.size()):
		var slot_name := String(capture_sequences[i])
		var want: Dictionary = expected[i]
		var want_slot := String(want["slot"])
		if slot_name != want_slot:
			result.failures.append(
				"[%s] sequence lane slot mismatch at t=%s, position %d: spec '%s', fixture '%s'"
				% [rig_id, time, i, slot_name, want_slot]
			)
			continue
		var actual := Sequence.sample_slot_sequence_frame(document, animation_id, time, pose, slot_name)
		var want_frame := int(want["frame"])
		result.lane_comparisons += 1
		if actual != want_frame:
			result.failures.append(
				"[%s] sequence frame mismatch for slot '%s' at t=%s: expected %d, actual %d"
				% [rig_id, slot_name, time, want_frame, actual]
			)


# Sweep the sample-spec eventStep and compare the fired-event log to the committed fixture (ADR-0008,
# PP-B4). name / int / string / time are EXACT; the float payload rides the EVENT_FLOAT tolerance. The log
# is ordered, so entries are matched index by index. Present only when the spec sets eventStep.
static func _compare_events(result: Result, rig_id: String, document, animation_id: String, spec: Dictionary, fixture: Dictionary) -> void:
	if not spec.has("eventStep"):
		return
	var expected: Array = fixture["events"] if fixture.has("events") else []
	var step: Dictionary = spec["eventStep"]

	var animation = document.find_animation(animation_id)
	if animation == null:
		result.failures.append("[%s] event sweep animation '%s' not found" % [rig_id, animation_id])
		return

	var timeline = EventFire.prepare_event_timeline(animation, document.events)
	var queue = EventFire.make_event_queue()
	if timeline != null:
		EventFire.collect_fired_events(
			timeline, float(step["from"]), float(step["to"]), float(step["dt"]), bool(spec["loop"]), float(spec["duration"]), queue
		)

	if queue.count != expected.size():
		result.failures.append(
			"[%s] fired-event count mismatch: expected %d, actual %d" % [rig_id, expected.size(), queue.count]
		)
		return

	for i in range(expected.size()):
		var want: Dictionary = expected[i]
		var got = queue.events[i]
		var where := "[%s] event %d ('%s' at t=%s)" % [rig_id, i, str(want["name"]), str(want["time"])]
		result.lane_comparisons += 1

		if got.name != String(want["name"]):
			result.failures.append("%s name mismatch: expected '%s', actual '%s'" % [where, want["name"], got.name])
		if got.time != float(want["time"]):
			result.failures.append("%s time mismatch: expected %s, actual %s" % [where, str(want["time"]), str(got.time)])

		var want_has_int := want.has("int")
		if got.has_int != want_has_int or (got.has_int and int(got.int_value) != int(want["int"])):
			result.failures.append("%s int payload mismatch" % where)

		var want_has_string := want.has("string")
		if got.has_string != want_has_string or (got.has_string and got.string_value != String(want["string"])):
			result.failures.append("%s string payload mismatch" % where)

		var want_has_float := want.has("float")
		if got.has_float != want_has_float:
			result.failures.append("%s float presence mismatch" % where)
		elif got.has_float:
			var delta := absf(got.float_value - float(want["float"]))
			result.max_event_float_error = max(result.max_event_float_error, delta)
			if not Tolerance.EVENT_FLOAT.within(got.float_value, float(want["float"])):
				result.failures.append(
					"%s float payload drifts: expected %s, actual %s" % [where, str(want["float"]), str(got.float_value)]
				)


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

		# Keyable two-color dark tint (ADR-0009 section 4.3, ADR-0011 section 3): the fixture carries a `dark`
		# RGBA array ONLY for a slot with a setup darkColor. Compare presence (structural) against the pose's
		# slot_has_dark_color flag, then each resolved dark lane on the COLOR tolerance. Absent-on-both (every
		# pre-existing rig) is a no-op, so untouched rigs behave exactly as before.
		var expected_has_dark: bool = expected_slot.has("dark")
		var actual_has_dark: bool = pose.slot_has_dark_color[slot_index] == 1
		if expected_has_dark != actual_has_dark:
			result.failures.append(
				"[%s] slot '%s' at t=%s dark presence mismatch: fixture %s, pose %s"
				% [rig_id, slot_name, time, str(expected_has_dark), str(actual_has_dark)]
			)
		elif expected_has_dark:
			var expected_dark: Array = expected_slot["dark"]
			for k in range(Pose.SLOT_COLOR_STRIDE):
				var expected_dark_value := float(expected_dark[k])
				var actual_dark_value := pose.slot_dark_color[base_index + k]
				var dark_delta := absf(actual_dark_value - expected_dark_value)
				result.max_color_error = max(result.max_color_error, dark_delta)
				result.lane_comparisons += 1
				if not Tolerance.COLOR.within(actual_dark_value, expected_dark_value):
					result.failures.append(
						"[%s] slot '%s' dark lane %d at t=%s drifts: expected %s, actual %s, delta %s"
						% [rig_id, slot_name, k, time, str(expected_dark_value), str(actual_dark_value), String.num_scientific(dark_delta)]
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


# ---------------------------------------------------------------------------------------------------
# PP-B2 geometry attachments (ADR-0012): clipping, bounding-box hit testing, point resolution
# ---------------------------------------------------------------------------------------------------

# Look up an attachment by (skin, slot, attachment), or null when the rig does not define it.
static func _lookup_attachment(document, skin_name: String, slot_name: String, attachment_name: String):
	for i in range(document.skins.size()):
		if document.skins[i].name == skin_name:
			var per_slot = document.skins[i].attachments.get(slot_name, null)
			if per_slot == null:
				return null
			return per_slot.get(attachment_name, null)
	return null


# Resolve the clip-capture targets named by the sample-spec (mirrors build-fixture.ts resolveClipTargets):
# the clip attachment plus its slot index and its `end` slot index, with a reused world-polygon scratch.
# A bad capture request fails loudly here (Law 3), matching the TS builder.
static func _resolve_clip_targets(result: Result, rig_id: String, document, spec: Dictionary, slot_index_by_name: Dictionary) -> Array:
	var targets := []
	for entry in spec.get("clips", []):
		var skin_name := String(entry["skin"])
		var slot_name := String(entry["slot"])
		var attachment_name := String(entry["attachment"])
		var attachment = _lookup_attachment(document, skin_name, slot_name, attachment_name)
		if attachment == null or attachment.type != "clipping":
			result.failures.append(
				"[%s] sample-spec captures clip '%s/%s/%s', but it is not a clipping attachment"
				% [rig_id, skin_name, slot_name, attachment_name]
			)
			continue
		if not slot_index_by_name.has(slot_name) or not slot_index_by_name.has(String(attachment.clip_end)):
			result.failures.append(
				"[%s] clip '%s/%s/%s' names a slot the rig lacks (slot or end slot)"
				% [rig_id, skin_name, slot_name, attachment_name]
			)
			continue
		var polygon_scratch := PackedFloat64Array()
		polygon_scratch.resize(attachment.clip_vertices.size())
		targets.append({
			"slot": slot_name,
			"attachment": attachment_name,
			"clip": attachment,
			"clip_slot_index": int(slot_index_by_name[slot_name]),
			"end_slot_index": int(slot_index_by_name[String(attachment.clip_end)]),
			"polygon_scratch": polygon_scratch,
		})
	return targets


static func _resolve_box_targets(result: Result, rig_id: String, document, spec: Dictionary, slot_index_by_name: Dictionary) -> Array:
	var targets := []
	for entry in spec.get("boxes", []):
		var skin_name := String(entry["skin"])
		var slot_name := String(entry["slot"])
		var attachment_name := String(entry["attachment"])
		var attachment = _lookup_attachment(document, skin_name, slot_name, attachment_name)
		if attachment == null or attachment.type != "boundingbox":
			result.failures.append(
				"[%s] sample-spec captures box '%s/%s/%s', but it is not a boundingbox attachment"
				% [rig_id, skin_name, slot_name, attachment_name]
			)
			continue
		if not slot_index_by_name.has(slot_name):
			result.failures.append("[%s] box '%s/%s/%s' names a slot the rig lacks" % [rig_id, skin_name, slot_name, attachment_name])
			continue
		var vertex_scratch := PackedFloat64Array()
		vertex_scratch.resize(attachment.box_vertices.size())
		targets.append({
			"slot": slot_name,
			"attachment": attachment_name,
			"box": attachment,
			"slot_index": int(slot_index_by_name[slot_name]),
			"vertex_scratch": vertex_scratch,
		})
	return targets


static func _resolve_point_targets(result: Result, rig_id: String, document, spec: Dictionary, slot_index_by_name: Dictionary) -> Array:
	var targets := []
	for entry in spec.get("points", []):
		var skin_name := String(entry["skin"])
		var slot_name := String(entry["slot"])
		var attachment_name := String(entry["attachment"])
		var attachment = _lookup_attachment(document, skin_name, slot_name, attachment_name)
		if attachment == null or attachment.type != "point":
			result.failures.append(
				"[%s] sample-spec captures point '%s/%s/%s', but it is not a point attachment"
				% [rig_id, skin_name, slot_name, attachment_name]
			)
			continue
		if not slot_index_by_name.has(slot_name):
			result.failures.append("[%s] point '%s/%s/%s' names a slot the rig lacks" % [rig_id, skin_name, slot_name, attachment_name])
			continue
		targets.append({
			"slot": slot_name,
			"attachment": attachment_name,
			"point": attachment,
			"slot_index": int(slot_index_by_name[slot_name]),
		})
	return targets


# Compare one sample's resolved clip state (ADR-0012 section 3): the world clip polygon (VERTEX) and the
# clipped-slot list (draw-order membership, EXACT in order), captured over the CURRENT draw order exactly as
# build-fixture.ts does. Present only when the spec captures clips; a rig without clips short-circuits.
static func _compare_clips(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, clip_targets: Array, clipped_scratch: PackedInt32Array) -> void:
	var expected: Array = sample["clips"] if sample.has("clips") else []
	if clip_targets.size() != expected.size():
		result.failures.append(
			"[%s] clip lane length mismatch at t=%s: spec captures %d, fixture has %d"
			% [rig_id, time, clip_targets.size(), expected.size()]
		)
		return
	for i in range(clip_targets.size()):
		var target: Dictionary = clip_targets[i]
		var want: Dictionary = expected[i]
		var key := "%s/%s" % [target["slot"], target["attachment"]]
		var polygon_scratch: PackedFloat64Array = target["polygon_scratch"]
		var vertex_count := AttachmentGeometry.resolve_clip_world_polygon_for_slot(pose, target["clip_slot_index"], target["clip"], polygon_scratch)
		var clipped_count := AttachmentGeometry.compute_clipped_slot_range(pose, target["clip_slot_index"], target["end_slot_index"], clipped_scratch)

		# Clipped-slot membership is DISCRETE: compare EXACT in ascending render-position order.
		var want_clipped: Array = want["clippedSlots"]
		var clipped_ok := clipped_count == want_clipped.size()
		if clipped_ok:
			for j in range(clipped_count):
				result.lane_comparisons += 1
				if String(pose.slot_names[clipped_scratch[j]]) != String(want_clipped[j]):
					clipped_ok = false
					break
		if not clipped_ok:
			var actual_names := []
			for j in range(clipped_count):
				actual_names.append(pose.slot_names[clipped_scratch[j]])
			result.failures.append(
				"[%s] clip '%s' clipped-slot mismatch at t=%s: expected %s, actual %s"
				% [rig_id, key, time, str(want_clipped), str(actual_names)]
			)

		# The world polygon rides the VERTEX tolerance, its length compared EXACT.
		var want_poly: Array = want["worldPolygon"]
		if want_poly.size() != vertex_count * 2:
			result.failures.append(
				"[%s] clip '%s' world-polygon length mismatch at t=%s: expected %d lanes, actual %d"
				% [rig_id, key, time, want_poly.size(), vertex_count * 2]
			)
			continue
		for lane in range(want_poly.size()):
			var expected_value := float(want_poly[lane])
			var actual_value := polygon_scratch[lane]
			var delta := absf(actual_value - expected_value)
			result.max_vertex_error = max(result.max_vertex_error, delta)
			result.lane_comparisons += 1
			if not Tolerance.VERTEX.within(actual_value, expected_value):
				result.failures.append(
					"[%s] clip '%s' world-polygon lane %d at t=%s drifts: expected %s, actual %s, delta %s"
					% [rig_id, key, lane, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
				)


# Compare one sample's resolved bounding-box hit-test state (ADR-0012 section 4): the box world vertices
# (VERTEX) and the per-probe even-odd hit booleans (EXACT). Present only when the spec captures boxes.
static func _compare_boxes(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, box_targets: Array, hit_probes: Array) -> void:
	var expected: Array = sample["boxes"] if sample.has("boxes") else []
	if box_targets.size() != expected.size():
		result.failures.append(
			"[%s] box lane length mismatch at t=%s: spec captures %d, fixture has %d"
			% [rig_id, time, box_targets.size(), expected.size()]
		)
		return
	for i in range(box_targets.size()):
		var target: Dictionary = box_targets[i]
		var want: Dictionary = expected[i]
		var key := "%s/%s" % [target["slot"], target["attachment"]]
		var vertex_scratch: PackedFloat64Array = target["vertex_scratch"]
		var vertex_count := AttachmentGeometry.bounding_box_world_vertices_for_slot(pose, target["slot_index"], target["box"], vertex_scratch)

		# Per-probe even-odd hits are DISCRETE: compare EXACT, in the sample-spec probe order.
		var want_hits: Array = want["hits"]
		if want_hits.size() != hit_probes.size():
			result.failures.append(
				"[%s] box '%s' hit-count mismatch at t=%s: fixture has %d, spec has %d probes"
				% [rig_id, key, time, want_hits.size(), hit_probes.size()]
			)
		else:
			for k in range(hit_probes.size()):
				var probe: Array = hit_probes[k]
				var actual_hit := AttachmentGeometry.hit_test_polygon(vertex_scratch, vertex_count, float(probe[0]), float(probe[1]))
				result.lane_comparisons += 1
				if actual_hit != bool(want_hits[k]):
					result.failures.append(
						"[%s] box '%s' hit %d at t=%s mismatch: expected %s, actual %s"
						% [rig_id, key, k, time, str(bool(want_hits[k])), str(actual_hit)]
					)

		var want_verts: Array = want["worldVertices"]
		if want_verts.size() != vertex_count * 2:
			result.failures.append(
				"[%s] box '%s' world-vertex length mismatch at t=%s: expected %d lanes, actual %d"
				% [rig_id, key, time, want_verts.size(), vertex_count * 2]
			)
			continue
		for lane in range(want_verts.size()):
			var expected_value := float(want_verts[lane])
			var actual_value := vertex_scratch[lane]
			var delta := absf(actual_value - expected_value)
			result.max_vertex_error = max(result.max_vertex_error, delta)
			result.lane_comparisons += 1
			if not Tolerance.VERTEX.within(actual_value, expected_value):
				result.failures.append(
					"[%s] box '%s' world-vertex lane %d at t=%s drifts: expected %s, actual %s, delta %s"
					% [rig_id, key, lane, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
				)


# Compare one sample's resolved point world state (ADR-0012 section 2): world x/y ride the VERTEX tolerance,
# world rotation (degrees) rides the ANGLE tolerance. Present only when the spec captures points.
static func _compare_points(result: Result, rig_id: String, time: float, sample: Dictionary, pose: Pose, point_targets: Array) -> void:
	var expected: Array = sample["points"] if sample.has("points") else []
	if point_targets.size() != expected.size():
		result.failures.append(
			"[%s] point lane length mismatch at t=%s: spec captures %d, fixture has %d"
			% [rig_id, time, point_targets.size(), expected.size()]
		)
		return
	for i in range(point_targets.size()):
		var target: Dictionary = point_targets[i]
		var want: Dictionary = expected[i]
		var key := "%s/%s" % [target["slot"], target["attachment"]]
		var world = AttachmentGeometry.resolve_point_world_for_slot(pose, target["slot_index"], target["point"])
		if world == null:
			result.failures.append("[%s] point '%s' at t=%s has no resolvable slot bone" % [rig_id, key, time])
			continue
		_compare_scalar(result, rig_id, "point '%s' world x" % key, time, world.x, float(want["x"]), Tolerance.VERTEX, true)
		_compare_scalar(result, rig_id, "point '%s' world y" % key, time, world.y, float(want["y"]), Tolerance.VERTEX, true)
		_compare_scalar(result, rig_id, "point '%s' world rotation" % key, time, world.rotation_deg, float(want["rotation"]), Tolerance.ANGLE, false)


# Compare one scalar within a tolerance, recording the max vertex error for VERTEX-class lanes.
static func _compare_scalar(result: Result, rig_id: String, label: String, time: float, actual_value: float, expected_value: float, tol, track_vertex: bool) -> void:
	var delta := absf(actual_value - expected_value)
	if track_vertex:
		result.max_vertex_error = max(result.max_vertex_error, delta)
	result.lane_comparisons += 1
	if not tol.within(actual_value, expected_value):
		result.failures.append(
			"[%s] %s at t=%s drifts: expected %s, actual %s, delta %s"
			% [rig_id, label, time, str(expected_value), str(actual_value), String.num_scientific(delta)]
		)
