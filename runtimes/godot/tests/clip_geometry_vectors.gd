extends RefCounted
# The clip-geometry cross-language golden (PP-B2, ADR-0012 section 3): the GDScript Sutherland-Hodgman
# triangle clipper must reproduce every ring in packages/conformance/src/cross-language/
# clip-geometry-vectors.json (the same single-source mechanism the integer PRNG/CRC vectors use). Each case
# gives a clip polygon (also the local polygon for the convexity / ear-clip decision) and a triangle-list
# input; the expected output is ringCount, and per ring the sourceTri index, vertexCount, flat positions,
# and per-vertex barycentrics. ringCount / vertexCount / sourceTri / the convex flag compare EXACT;
# positions and barycentrics ride the VERTEX tolerance. A failure flips the run sentinel to FAIL.

const AttachmentGeometry = preload("res://core/attachment_geometry.gd")
const Tolerance = preload("res://tests/tolerance.gd")
const RepoPaths = preload("res://tests/repo_paths.gd")


class Result:
	var failures: Array = []
	var checked: int = 0

	func ok() -> bool:
		return failures.size() == 0


static func run() -> Result:
	var result := Result.new()
	var doc = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.clip_geometry_vectors()))
	if doc == null or typeof(doc) != TYPE_DICTIONARY or not doc.has("cases"):
		result.failures.append("clip-geometry-vectors.json missing or malformed")
		return result

	for case in doc["cases"]:
		result.checked += 1
		_check_case(result, case)
	return result


static func _check_case(result: Result, case: Dictionary) -> void:
	var name := String(case["name"])
	var polygon := _to_f64(case["polygon"])
	var tri_verts := _to_f64(case["triVerts"])
	var tri_indices := _to_i32(case["triIndices"])
	var expected: Dictionary = case["expected"]

	var prepared = AttachmentGeometry.prepare_clipping(polygon)
	if prepared.convex != bool(case["convex"]):
		result.failures.append(
			"[%s] convex flag mismatch: expected %s, actual %s" % [name, str(bool(case["convex"])), str(prepared.convex)]
		)

	var buffers = AttachmentGeometry.make_clip_buffers()
	var clip_result = AttachmentGeometry.clip_triangle_list(prepared, polygon, tri_verts, tri_indices, buffers)

	var expected_ring_count := int(expected["ringCount"])
	if clip_result.ring_count != expected_ring_count:
		result.failures.append(
			"[%s] ringCount mismatch: expected %d, actual %d" % [name, expected_ring_count, clip_result.ring_count]
		)
		return

	var expected_rings: Array = expected["rings"]
	var vertex_base := 0
	for r in range(expected_ring_count):
		var want_ring: Dictionary = expected_rings[r]
		var want_source_tri := int(want_ring["sourceTri"])
		var want_vertex_count := int(want_ring["vertexCount"])

		var actual_source_tri: int = buffers.ring_source_tri[r]
		var actual_vertex_count: int = buffers.ring_vertex_count[r]
		if actual_source_tri != want_source_tri:
			result.failures.append(
				"[%s] ring %d sourceTri mismatch: expected %d, actual %d" % [name, r, want_source_tri, actual_source_tri]
			)
		if actual_vertex_count != want_vertex_count:
			result.failures.append(
				"[%s] ring %d vertexCount mismatch: expected %d, actual %d" % [name, r, want_vertex_count, actual_vertex_count]
			)
			# Cannot walk positions safely if the count diverged; skip this ring's numeric compare.
			continue

		var want_positions: Array = want_ring["positions"]
		var want_bary: Array = want_ring["bary"]
		for v in range(want_vertex_count):
			var out_vertex := vertex_base + v
			_check_value(result, name, "ring %d vertex %d x" % [r, v], buffers.positions[out_vertex * 2], float(want_positions[v * 2]))
			_check_value(result, name, "ring %d vertex %d y" % [r, v], buffers.positions[out_vertex * 2 + 1], float(want_positions[v * 2 + 1]))
			_check_value(result, name, "ring %d vertex %d b0" % [r, v], buffers.bary[out_vertex * 3], float(want_bary[v * 3]))
			_check_value(result, name, "ring %d vertex %d b1" % [r, v], buffers.bary[out_vertex * 3 + 1], float(want_bary[v * 3 + 1]))
			_check_value(result, name, "ring %d vertex %d b2" % [r, v], buffers.bary[out_vertex * 3 + 2], float(want_bary[v * 3 + 2]))
		vertex_base += want_vertex_count


static func _check_value(result: Result, case_name: String, label: String, actual: float, expected: float) -> void:
	if not Tolerance.VERTEX.within(actual, expected):
		result.failures.append(
			"[%s] %s drifts: expected %s, actual %s" % [case_name, label, str(expected), str(actual)]
		)


static func _to_f64(values: Array) -> PackedFloat64Array:
	var out := PackedFloat64Array()
	out.resize(values.size())
	for i in range(values.size()):
		out[i] = float(values[i])
	return out


static func _to_i32(values: Array) -> PackedInt32Array:
	var out := PackedInt32Array()
	out.resize(values.size())
	for i in range(values.size()):
		out[i] = int(values[i])
	return out
