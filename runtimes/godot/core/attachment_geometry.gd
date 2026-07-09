extends RefCounted
# Non-drawing geometry attachments (ADR-0012, PP-B2): clipping evaluation, bounding-box hit testing, and
# point resolution. Mirrors packages/runtime-core/src/skeleton/attachment-geometry.ts FUNCTION FOR FUNCTION
# so the three runtimes (TS, Unity C#, Godot) compute the identical result and the conformance corpus locks
# it. These READ the solved pose (pose.world, pose.draw_order) and never write it, so they are post-step-4
# accessors that change no existing fixture (Law 1: presentation-only, outcome-independent).
#
# In our format a clipping/boundingbox vertex stream is ALWAYS unweighted (no `bones` manifest, unlike a
# mesh), so a polygon vertex's world position is slotBoneWorld * (x, y). A point is a single local
# (x, y, rotation) composed with the slot bone's world. World polygons ride PackedFloat64Array (the f64 the
# TS path uses), the lowest cross-language reordering noise for the ear-clip / inside-test arithmetic.

const Affine = preload("res://core/affine.gd")
const Pose = preload("res://core/pose.gd")

const RAD_TO_DEG := 180.0 / PI
# Subject-vertex stride in the Sutherland-Hodgman ping-pong buffers: x, y, b0, b1, b2.
const SUBJECT_STRIDE := 5


# A point attachment's resolved world state: world position and world rotation in degrees.
class PointWorld:
	var x: float
	var y: float
	var rotation_deg: float

	func _init(the_x: float, the_y: float, the_rotation_deg: float) -> void:
		x = the_x
		y = the_y
		rotation_deg = the_rotation_deg


# The precomputed, pose-independent data for one clip attachment (ADR-0012 section 3.2/3.3): the polygon
# convexity (decided once on the LOCAL polygon, affine invariant) and, for a concave polygon, the ear-clip
# triangle topology (indices into the polygon vertices) reused every frame with world vertices. piece_count
# is 1 (convex) or V-2 (concave); the worst-case bounds size a caller's output pool.
class PreparedClip:
	var vertex_count: int
	var convex: bool
	# Concave only: (V-2)*3 vertex indices, three per ear triangle. Empty for a convex polygon.
	var ear_triangles: PackedInt32Array
	var piece_count: int
	# Worst-case output vertices and rings PER INPUT TRIANGLE (ADR-0012 section 3.3).
	var max_output_vertices_per_tri: int
	var max_rings_per_tri: int


# Pooled output for clip_triangle_list (ADR-0012 section 3.3): the flat output vertex positions and their
# barycentric coordinates (with respect to the source input triangle), the per-ring vertex counts, and the
# per-ring source-triangle index. scratch_a/scratch_b are the Sutherland-Hodgman ping-pong buffers, each
# stride SUBJECT_STRIDE. Every buffer grows only when a larger job than any before appears (size-keyed).
class ClipBuffers:
	var positions: PackedFloat64Array = PackedFloat64Array()
	var bary: PackedFloat64Array = PackedFloat64Array()
	var ring_vertex_count: PackedInt32Array = PackedInt32Array()
	var ring_source_tri: PackedInt32Array = PackedInt32Array()
	var scratch_a: PackedFloat64Array = PackedFloat64Array()
	var scratch_b: PackedFloat64Array = PackedFloat64Array()


# The result of one clip: how many rings and how many total output vertices were written (the caller reads
# ring_vertex_count[0..ring_count) and walks positions/bary in step).
class ClipResult:
	var ring_count: int
	var vertex_count: int

	func _init(the_ring_count: int, the_vertex_count: int) -> void:
		ring_count = the_ring_count
		vertex_count = the_vertex_count


# The world matrix offset of the bone a slot rides, or -1 when the slot or its bone is unknown (a defensive
# value for an unvalidated document; a validated rig always resolves it).
static func slot_bone_offset(pose: Pose, slot_index: int) -> int:
	if slot_index < 0 or slot_index >= pose.slot_count:
		return -1
	var bone_index: int = pose.slot_bone_indices[slot_index]
	return -1 if bone_index < 0 else bone_index * Affine.MAT2X3_STRIDE


# Transform a flat unweighted local vertex stream [x0, y0, ...] into world space by the world matrix at
# world[bone_offset ..]: world_i = slotBoneWorld * (x_i, y_i). Writes 2 world lanes per logical vertex into
# `out` (sized >= vertices.size()) and returns the vertex count. Allocation-free.
static func transform_unweighted_vertices_into(
	vertices: PackedFloat64Array, world: PackedFloat64Array, bone_offset: int, out: PackedFloat64Array
) -> int:
	var a := world[bone_offset]
	var b := world[bone_offset + 1]
	var c := world[bone_offset + 2]
	var d := world[bone_offset + 3]
	var tx := world[bone_offset + 4]
	var ty := world[bone_offset + 5]
	var length := vertices.size()
	var i := 0
	while i < length:
		var x := vertices[i]
		var y := vertices[i + 1]
		out[i] = a * x + c * y + tx
		out[i + 1] = b * x + d * y + ty
		i += 2
	return length / 2


# ---------------------------------------------------------------------------------------------------
# Point attachment (ADR-0012 section 2)
# ---------------------------------------------------------------------------------------------------

# Resolve a point attachment's world position (slotBoneWorld * (x, y)) and world rotation (point.rotation +
# the bone's world x-axis angle). `bone_offset` is the slot bone's world matrix offset. `point` is a
# Document.Attachment carrying point_x/point_y/point_rotation.
static func resolve_point_world(point, world: PackedFloat64Array, bone_offset: int) -> PointWorld:
	var a := world[bone_offset]
	var b := world[bone_offset + 1]
	var c := world[bone_offset + 2]
	var d := world[bone_offset + 3]
	var tx := world[bone_offset + 4]
	var ty := world[bone_offset + 5]
	var x: float = a * point.point_x + c * point.point_y + tx
	var y: float = b * point.point_x + d * point.point_y + ty
	var bone_rotation_deg := atan2(b, a) * RAD_TO_DEG
	return PointWorld.new(x, y, point.point_rotation + bone_rotation_deg)


# Resolve a point attachment for the slot it rides, reading the slot bone's world matrix from the solved
# pose. Returns null when the slot's bone is unknown (a defensive path for an unvalidated document).
static func resolve_point_world_for_slot(pose: Pose, slot_index: int, point):
	var offset := slot_bone_offset(pose, slot_index)
	if offset < 0:
		return null
	return resolve_point_world(point, pose.world, offset)


# ---------------------------------------------------------------------------------------------------
# Bounding-box hit testing (ADR-0012 section 4)
# ---------------------------------------------------------------------------------------------------

# Transform a bounding-box attachment's polygon into world space for the slot it rides, into `out` (sized
# >= box.box_vertices.size()). Returns the vertex count, or -1 when the slot's bone is unknown.
static func bounding_box_world_vertices_for_slot(pose: Pose, slot_index: int, box, out: PackedFloat64Array) -> int:
	var offset := slot_bone_offset(pose, slot_index)
	if offset < 0:
		return -1
	return transform_unweighted_vertices_into(box.box_vertices, pose.world, offset, out)


# Even-odd (crossing-number) point-in-polygon test over a world-space polygon (ADR-0012 section 4). A point
# is inside iff a ray toward +x crosses an odd number of edges; the half-open [yMin, yMax) span convention
# avoids double-counting a shared vertex. Orientation-independent (CW or CCW authored polygon hits
# identically). Allocation-free; the boolean is deterministic (compared EXACT in conformance).
static func hit_test_polygon(world_vertices: PackedFloat64Array, vertex_count: int, px: float, py: float) -> bool:
	var inside := false
	var j := vertex_count - 1
	for i in range(vertex_count):
		var ax := world_vertices[i * 2]
		var ay := world_vertices[i * 2 + 1]
		var bx := world_vertices[j * 2]
		var by := world_vertices[j * 2 + 1]
		if (ay > py) != (by > py) and px < ((bx - ax) * (py - ay)) / (by - ay) + ax:
			inside = not inside
		j = i
	return inside


# ---------------------------------------------------------------------------------------------------
# Clipping evaluation (ADR-0012 section 3)
# ---------------------------------------------------------------------------------------------------

# Twice the signed area of a flat polygon [x0, y0, ...] over `count` vertices via the shoelace sum; positive
# for a counter-clockwise ring. Used to decide winding for ear-clipping (local) and the per-frame
# convex-piece reorientation (world).
static func _signed_area2(vertices: PackedFloat64Array, offset: int, count: int) -> float:
	var sum := 0.0
	for i in range(count):
		var nxt := (i + 1) % count
		var ix := vertices[offset + i * 2]
		var iy := vertices[offset + i * 2 + 1]
		var nx := vertices[offset + nxt * 2]
		var ny := vertices[offset + nxt * 2 + 1]
		sum += ix * ny - nx * iy
	return sum


# True iff the local polygon is convex: every consecutive-edge cross product shares one sign (collinear
# zeros allowed). A reflection flips all signs together, so this decision is affine invariant.
static func _is_convex_polygon(vertices: PackedFloat64Array, count: int) -> bool:
	var winding_sign := 0
	for i in range(count):
		var ax := vertices[i * 2]
		var ay := vertices[i * 2 + 1]
		var bx := vertices[((i + 1) % count) * 2]
		var by := vertices[((i + 1) % count) * 2 + 1]
		var cx := vertices[((i + 2) % count) * 2]
		var cy := vertices[((i + 2) % count) * 2 + 1]
		var cross := (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
		if cross > 0.0:
			if winding_sign < 0:
				return false
			winding_sign = 1
		elif cross < 0.0:
			if winding_sign > 0:
				return false
			winding_sign = -1
	return true


# Point-in-triangle by three same-side cross-product signs (inclusive of the boundary), for the ear guard.
static func _point_in_triangle(px: float, py: float, ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> bool:
	var d1 := (px - bx) * (ay - by) - (ax - bx) * (py - by)
	var d2 := (px - cx) * (by - cy) - (bx - cx) * (py - cy)
	var d3 := (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
	var has_neg := d1 < 0.0 or d2 < 0.0 or d3 < 0.0
	var has_pos := d1 > 0.0 or d2 > 0.0 or d3 > 0.0
	return not (has_neg and has_pos)


# Ear-clip a concave (or convex) local polygon into triangle index triples (ADR-0012 section 3.2). Standard
# O(V^2) ear clipping over a CCW-normalized index ring; a point-in-triangle guard rejects a candidate ear
# that contains any other polygon vertex. Deterministic (fixed scan order). Returns a flat (V-2)*3 index
# array referencing the ORIGINAL vertex indices, so the topology is reused every frame with world vertices.
static func _ear_clip(vertices: PackedFloat64Array, count: int) -> PackedInt32Array:
	var triangles := PackedInt32Array()
	triangles.resize(max(0, count - 2) * 3)
	if count < 3:
		return triangles

	# Normalize to CCW so the "convex vertex" test (positive cross) is consistent.
	var ccw := _signed_area2(vertices, 0, count) > 0.0
	var indices: Array = []
	for i in range(count):
		indices.append(i if ccw else count - 1 - i)

	var out := 0
	var remaining := indices.size()
	var guard := 0
	var guard_limit := count * count + 1
	while remaining > 3 and guard < guard_limit:
		guard += 1
		var clipped := false
		for k in range(remaining):
			var prev := (k - 1 + remaining) % remaining
			var nxt := (k + 1) % remaining
			var ax: float = vertices[indices[prev] * 2]
			var ay: float = vertices[indices[prev] * 2 + 1]
			var bx: float = vertices[indices[k] * 2]
			var by: float = vertices[indices[k] * 2 + 1]
			var cx: float = vertices[indices[nxt] * 2]
			var cy: float = vertices[indices[nxt] * 2 + 1]
			var cross := (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
			if cross <= 0.0:
				continue  # reflex or collinear: not an ear tip

			var contains_other := false
			for m in range(remaining):
				if m == prev or m == k or m == nxt:
					continue
				if _point_in_triangle(vertices[indices[m] * 2], vertices[indices[m] * 2 + 1], ax, ay, bx, by, cx, cy):
					contains_other = true
					break
			if contains_other:
				continue

			triangles[out] = indices[prev]
			triangles[out + 1] = indices[k]
			triangles[out + 2] = indices[nxt]
			out += 3
			indices.remove_at(k)
			remaining -= 1
			clipped = true
			break
		if not clipped:
			break  # degenerate polygon: stop rather than spin
	if remaining == 3:
		triangles[out] = indices[0]
		triangles[out + 1] = indices[1]
		triangles[out + 2] = indices[2]
	return triangles


# Prepare a clip attachment once: decide convexity on the LOCAL polygon (affine invariant) and, when
# concave, ear-clip its topology (ADR-0012 section 3.2/3.3). Records the worst-case output bounds a caller
# uses to size the clip output pool. A polygon with V < 3 yields piece_count 0 (no clip region). `vertices`
# is the flat local polygon [x0, y0, ...] (Document.Attachment.clip_vertices).
static func prepare_clipping(vertices: PackedFloat64Array) -> PreparedClip:
	var prepared := PreparedClip.new()
	var vertex_count := vertices.size() / 2
	prepared.vertex_count = vertex_count
	if vertex_count < 3:
		prepared.convex = true
		prepared.ear_triangles = PackedInt32Array()
		prepared.piece_count = 0
		prepared.max_output_vertices_per_tri = 0
		prepared.max_rings_per_tri = 0
		return prepared
	var convex := _is_convex_polygon(vertices, vertex_count)
	if convex:
		prepared.convex = true
		prepared.ear_triangles = PackedInt32Array()
		prepared.piece_count = 1
		prepared.max_output_vertices_per_tri = 3 + vertex_count
		prepared.max_rings_per_tri = 1
		return prepared
	var piece_count := vertex_count - 2
	prepared.convex = false
	prepared.ear_triangles = _ear_clip(vertices, vertex_count)
	prepared.piece_count = piece_count
	# Each ear-clip piece is a 3-edge convex triangle, so a clipped subject triangle has at most 6 verts.
	prepared.max_output_vertices_per_tri = 6 * piece_count
	prepared.max_rings_per_tri = piece_count
	return prepared


# Resolve a clip attachment's world-space polygon for the slot it rides, into `out` (sized >= 2*V). Returns
# the vertex count, or -1 when the slot's bone is unknown. `clip` is a Document.Attachment.
static func resolve_clip_world_polygon_for_slot(pose: Pose, slot_index: int, clip, out: PackedFloat64Array) -> int:
	var offset := slot_bone_offset(pose, slot_index)
	if offset < 0:
		return -1
	return transform_unweighted_vertices_into(clip.clip_vertices, pose.world, offset, out)


# The render position of a slot index within the current draw order (pose.draw_order maps render position ->
# slot index), or -1 if absent. Linear scan; the slot count is small.
static func _render_position_of(pose: Pose, slot_index: int) -> int:
	for position in range(pose.slot_count):
		if pose.draw_order[position] == slot_index:
			return position
	return -1


# Compute the clipped slot set for a clip attachment (ADR-0012 section 3.1): the slots at render positions
# pClip+1 .. pEnd inclusive in the CURRENT draw order. Fills `out_slot_indices` (sized >= pose.slot_count)
# with those slot indices in ascending render-position order and returns the count. Empty (returns 0) when
# the end slot is at or before the clip slot, or when either slot is unresolved.
static func compute_clipped_slot_range(pose: Pose, clip_slot_index: int, end_slot_index: int, out_slot_indices: PackedInt32Array) -> int:
	var p_clip := _render_position_of(pose, clip_slot_index)
	var p_end := _render_position_of(pose, end_slot_index)
	if p_clip < 0 or p_end < 0 or p_end <= p_clip:
		return 0
	var count := 0
	for position in range(p_clip + 1, p_end + 1):
		out_slot_indices[count] = pose.draw_order[position]
		count += 1
	return count


# Allocate empty clip buffers; clip_triangle_list grows them to the job's worst case on first use.
static func make_clip_buffers() -> ClipBuffers:
	return ClipBuffers.new()


# Grow the clip buffers to hold a triangle stream of `triangle_count` triangles clipped by `prepared`
# (ADR-0012 section 3.3 worst case). Size-keyed: only reallocates a buffer that is too small.
static func _ensure_clip_capacity(buffers: ClipBuffers, prepared: PreparedClip, triangle_count: int) -> void:
	var max_vertices := triangle_count * prepared.max_output_vertices_per_tri
	var max_rings := triangle_count * prepared.max_rings_per_tri
	# The largest per-pass subject size: 3 + (whole polygon edges) in the convex case, else 6 for a triangle.
	var max_subject := (3 + prepared.vertex_count) if prepared.convex else 6
	if buffers.positions.size() < max_vertices * 2:
		buffers.positions.resize(max_vertices * 2)
	if buffers.bary.size() < max_vertices * 3:
		buffers.bary.resize(max_vertices * 3)
	if buffers.ring_vertex_count.size() < max_rings:
		buffers.ring_vertex_count.resize(max_rings)
	if buffers.ring_source_tri.size() < max_rings:
		buffers.ring_source_tri.resize(max_rings)
	if buffers.scratch_a.size() < max_subject * SUBJECT_STRIDE:
		var scratch_a := PackedFloat64Array()
		scratch_a.resize(max_subject * SUBJECT_STRIDE)
		buffers.scratch_a = scratch_a
		var scratch_b := PackedFloat64Array()
		scratch_b.resize(max_subject * SUBJECT_STRIDE)
		buffers.scratch_b = scratch_b


# Clip a world-space triangle stream against a clip attachment's world polygon (ADR-0012 section 3), the
# geometry operation a CPU rasterizer needs. `world_polygon` is filled by resolve_clip_world_polygon_for_slot;
# `tri_verts` is the flat world xy of the source geometry; `tri_indices` is the flat 3-per-triangle index
# array. Writes, per input triangle, one convex output ring or (concave) one ring per ear-clip piece it
# intersects, into the pooled `buffers`, and returns the ring and vertex counts. Each output vertex carries
# its barycentric coordinates with respect to its source triangle. Deterministic; allocation-free in steady
# state (buffers grow once per larger job).
static func clip_triangle_list(prepared: PreparedClip, world_polygon: PackedFloat64Array, tri_verts: PackedFloat64Array, tri_indices, buffers: ClipBuffers) -> ClipResult:
	var triangle_count: int = tri_indices.size() / 3
	if prepared.piece_count == 0 or triangle_count == 0:
		return ClipResult.new(0, 0)
	_ensure_clip_capacity(buffers, prepared, triangle_count)

	var ring_count := 0
	var vertex_count := 0
	var v := prepared.vertex_count

	for t in range(triangle_count):
		var i0: int = tri_indices[t * 3]
		var i1: int = tri_indices[t * 3 + 1]
		var i2: int = tri_indices[t * 3 + 2]

		if prepared.convex:
			_seed_subject_triangle(tri_verts, i0, i1, i2, buffers.scratch_a)
			# Result is normalized into scratch_b, so emit_ring always reads scratch_b.
			var out_len := _clip_subject_against_convex(buffers, 3, world_polygon, 0, v)
			var written := _emit_ring(buffers, buffers.scratch_b, out_len, t, ring_count, vertex_count)
			if written > 0:
				vertex_count += written
				ring_count += 1
		else:
			for piece in range(prepared.piece_count):
				# Re-seed the subject triangle into scratch_a for each piece (the previous piece's ping-pong
				# overwrote it); each piece intersects the SAME source triangle against a different clip triangle.
				_seed_subject_triangle(tri_verts, i0, i1, i2, buffers.scratch_a)
				var out_len := _clip_subject_against_triangle(buffers, 3, world_polygon, prepared.ear_triangles, piece)
				var written := _emit_ring(buffers, buffers.scratch_b, out_len, t, ring_count, vertex_count)
				if written > 0:
					vertex_count += written
					ring_count += 1
	return ClipResult.new(ring_count, vertex_count)


# Write the three source-triangle corners (positions + canonical barycentrics) into a subject scratch.
static func _seed_subject_triangle(tri_verts: PackedFloat64Array, i0: int, i1: int, i2: int, subject: PackedFloat64Array) -> void:
	_write_subject(subject, 0, tri_verts[i0 * 2], tri_verts[i0 * 2 + 1], 1.0, 0.0, 0.0)
	_write_subject(subject, 1, tri_verts[i1 * 2], tri_verts[i1 * 2 + 1], 0.0, 1.0, 0.0)
	_write_subject(subject, 2, tri_verts[i2 * 2], tri_verts[i2 * 2 + 1], 0.0, 0.0, 1.0)


static func _write_subject(buffer: PackedFloat64Array, vertex_index: int, x: float, y: float, b0: float, b1: float, b2: float) -> void:
	var base := vertex_index * SUBJECT_STRIDE
	buffer[base] = x
	buffer[base + 1] = y
	buffer[base + 2] = b0
	buffer[base + 3] = b1
	buffer[base + 4] = b2


# Clip the subject polygon (seeded in buffers.scratch_a, `subject_len` vertices) against a whole convex clip
# polygon poly[poly_offset ..] over `poly_count` vertices, ping-ponging between scratch_a and scratch_b. The
# clip polygon is reoriented CCW per pass by its signed area (winding rule) so the left-of-edge inside test
# is correct even under a reflecting transform. The result is NORMALIZED into buffers.scratch_b.
static func _clip_subject_against_convex(buffers: ClipBuffers, subject_len: int, poly: PackedFloat64Array, poly_offset: int, poly_count: int) -> int:
	var ccw := _signed_area2(poly, poly_offset, poly_count) >= 0.0
	var src := buffers.scratch_a
	var dst := buffers.scratch_b
	var length := subject_len
	for e in range(poly_count):
		var ai := e if ccw else poly_count - 1 - e
		var bi := ((e + 1) % poly_count) if ccw else (poly_count - 2 - e + poly_count) % poly_count
		var ax := poly[poly_offset + ai * 2]
		var ay := poly[poly_offset + ai * 2 + 1]
		var bx := poly[poly_offset + bi * 2]
		var by := poly[poly_offset + bi * 2 + 1]
		length = _clip_against_edge(src, length, ax, ay, bx, by, dst)
		var swap := src
		src = dst
		dst = swap
		if length == 0:
			break
	return _finish_in_scratch_b(buffers, src, length)


# Clip the subject polygon (seeded in buffers.scratch_a) against one ear-clip triangle piece (three polygon
# vertices named by ear_triangles[piece*3 ..]), ping-ponging between scratch_a and scratch_b. Same
# CCW-reorient-then-left-of-edge rule as the convex path; the result is normalized into buffers.scratch_b.
static func _clip_subject_against_triangle(buffers: ClipBuffers, subject_len: int, poly: PackedFloat64Array, ear_triangles: PackedInt32Array, piece: int) -> int:
	var t0: int = ear_triangles[piece * 3]
	var t1: int = ear_triangles[piece * 3 + 1]
	var t2: int = ear_triangles[piece * 3 + 2]
	var x0 := poly[t0 * 2]
	var y0 := poly[t0 * 2 + 1]
	var x1 := poly[t1 * 2]
	var y1 := poly[t1 * 2 + 1]
	var x2 := poly[t2 * 2]
	var y2 := poly[t2 * 2 + 1]
	var area2 := (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
	# A zero-area (collinear or unfilled) ear piece has no clip region: emit nothing rather than let the
	# zero-length edges pass every subject vertex through as a spurious full ring.
	if area2 == 0.0:
		return 0
	var ccw := area2 >= 0.0
	# Edge endpoints in CCW order (0 -> 1 -> 2 -> 0), reversed when the world piece is CW.
	var px1 := x1 if ccw else x2
	var py1 := y1 if ccw else y2
	var px2 := x2 if ccw else x1
	var py2 := y2 if ccw else y1

	var src := buffers.scratch_a
	var dst := buffers.scratch_b
	var length := subject_len
	length = _clip_against_edge(src, length, x0, y0, px1, py1, dst)
	var swap := src
	src = dst
	dst = swap
	if length > 0:
		length = _clip_against_edge(src, length, px1, py1, px2, py2, dst)
		swap = src
		src = dst
		dst = swap
	if length > 0:
		length = _clip_against_edge(src, length, px2, py2, x0, y0, dst)
		swap = src
		src = dst
		dst = swap
	return _finish_in_scratch_b(buffers, src, length)


# Ensure the final clipped ring lives in buffers.scratch_b (copying it from scratch_a if the last pass landed
# there), so the emitter always reads scratch_b. Returns the vertex count unchanged.
static func _finish_in_scratch_b(buffers: ClipBuffers, result_buffer: PackedFloat64Array, length: int) -> int:
	if result_buffer != buffers.scratch_b and length > 0:
		var total := length * SUBJECT_STRIDE
		for i in range(total):
			buffers.scratch_b[i] = result_buffer[i]
	return length


# Sutherland-Hodgman single-edge clip: keep the part of the subject polygon on the LEFT of (or on) the
# directed edge A -> B. Emits kept vertices and edge-crossing intersections (barycentrics lerped by the
# same t) into `out`; returns the output vertex count. Left-of test: cross(B-A, P-A) >= 0. `out` must be a
# distinct buffer from `subject` (the ping-pong guarantees this).
static func _clip_against_edge(subject: PackedFloat64Array, subject_len: int, ax: float, ay: float, bx: float, by: float, out: PackedFloat64Array) -> int:
	var ex := bx - ax
	var ey := by - ay
	var out_len := 0
	var s_base := (subject_len - 1) * SUBJECT_STRIDE
	var s_inside := ex * (subject[s_base + 1] - ay) - ey * (subject[s_base] - ax) >= 0.0
	for i in range(subject_len):
		var e_base := i * SUBJECT_STRIDE
		var px := subject[e_base]
		var py := subject[e_base + 1]
		var e_inside := ex * (py - ay) - ey * (px - ax) >= 0.0
		if e_inside:
			if not s_inside:
				out_len = _emit_intersection(subject, s_base, e_base, ax, ay, ex, ey, out, out_len)
			_copy_vertex(subject, e_base, out, out_len * SUBJECT_STRIDE)
			out_len += 1
		elif s_inside:
			out_len = _emit_intersection(subject, s_base, e_base, ax, ay, ex, ey, out, out_len)
		s_base = e_base
		s_inside = e_inside
	return out_len


# Emit the intersection of subject edge (S -> E) with the clip line through A along (ex, ey), lerping all
# five subject lanes (x, y, b0, b1, b2) by t = dS / (dS - dE), where d is the signed left-of distance.
static func _emit_intersection(subject: PackedFloat64Array, s_base: int, e_base: int, ax: float, ay: float, ex: float, ey: float, out: PackedFloat64Array, out_len: int) -> int:
	var d_s := ex * (subject[s_base + 1] - ay) - ey * (subject[s_base] - ax)
	var d_e := ex * (subject[e_base + 1] - ay) - ey * (subject[e_base] - ax)
	var denom := d_s - d_e
	var t := d_s / denom if denom != 0.0 else 0.0
	var out_base := out_len * SUBJECT_STRIDE
	for lane in range(SUBJECT_STRIDE):
		var s := subject[s_base + lane]
		var e := subject[e_base + lane]
		out[out_base + lane] = s + t * (e - s)
	return out_len + 1


static func _copy_vertex(src: PackedFloat64Array, src_base: int, dst: PackedFloat64Array, dst_base: int) -> void:
	for lane in range(SUBJECT_STRIDE):
		dst[dst_base + lane] = src[src_base + lane]


# Emit one clipped ring (from the SH scratch) into the pooled output buffers, dropping degenerate rings
# (fewer than 3 vertices, no area). Returns the number of vertices written (0 if dropped).
static func _emit_ring(buffers: ClipBuffers, ring_scratch: PackedFloat64Array, ring_len: int, source_tri: int, ring_index: int, vertex_base: int) -> int:
	if ring_len < 3:
		return 0
	for v in range(ring_len):
		var base := v * SUBJECT_STRIDE
		var out_vertex := vertex_base + v
		buffers.positions[out_vertex * 2] = ring_scratch[base]
		buffers.positions[out_vertex * 2 + 1] = ring_scratch[base + 1]
		buffers.bary[out_vertex * 3] = ring_scratch[base + 2]
		buffers.bary[out_vertex * 3 + 1] = ring_scratch[base + 3]
		buffers.bary[out_vertex * 3 + 2] = ring_scratch[base + 4]
	buffers.ring_vertex_count[ring_index] = ring_len
	buffers.ring_source_tri[ring_index] = source_tri
	return ring_len
