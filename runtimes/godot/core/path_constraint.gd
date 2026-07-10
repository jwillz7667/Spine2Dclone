extends RefCounted
# Path constraint solve (mirrors packages/runtime-core/src/solve/path-constraint.ts and, once it lands,
# runtimes/unity, ADR-0013 PP-B6). A path constraint distributes a list of bones ALONG a target slot's path
# attachment (a piecewise cubic Bezier spline) and orients them, blended per channel by mix_rotate/mix_x/
# mix_y. It runs at solve-order step 3 (before the step-4 world pass), so it resolves the path's WORLD
# control points ON DEMAND from current local state (ResolveWorld), exactly like IK/transform read their
# target world, never from pose.world (not yet written at step 3). It writes bone LOCAL x/y, rotation, and
# (chainScale only) scaleX; step 4 then reproduces the intended world. Pure solve math, no rendering.

const Affine = preload("res://core/affine.gd")
const Scalar = preload("res://core/scalar.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Ik = preload("res://core/ik.gd")
const Pose = preload("res://core/pose.gd")

# Below this a length or curve span is degenerate and skipped, so no division by zero leaves the solver.
const EPSILON := 1e-12

# The pinned per-curve subdivision for the constant-speed world arc-length LUT (ADR-0013 section 3b). A
# fixed count, applied identically in all three runtimes, is the cross-language contract: the LUT is a fixed
# sum of chord lengths plus one linear interpolation, so no iteration count or convergence test can drift
# across language math libraries.
const PATH_CURVE_SUBDIVISIONS := 64


# The prepared, pose-independent geometry of one path attachment (ADR-0013 sections 1 to 3), built ONCE at
# build_pose from the target slot's setup default-skin path attachment. It carries the control-point layout
# (weighted or unweighted, ADR-0002 codec), the derived curve/vertex counts, the committed cumulative
# arc-length table, and the per-frame scratch (world control points, the per-curve arc-length LUT, and, for
# a weighted path, the packed on-demand world buffer). All scratch is allocated here and reused every frame.
class PreparedPathGeometry:
	var closed: bool
	var constant_speed: bool
	var curve_count: int
	# The logical control-point count V (3C+1 open, 3C closed). The world scratch is 2V lanes.
	var vertex_count: int
	# The committed cumulative arc length to the END of each curve (ADR-0011); size == curve_count.
	var lengths: PackedFloat64Array
	var weighted: bool
	# Unweighted: the flat setup-space control points [x0, y0, x1, y1, ...]. Weighted: an empty array (the
	# stream is walked instead).
	var local_vertices: PackedFloat64Array
	# Weighted: the ADR-0002 self-delimiting vertex stream (boneCount, (globalBoneIndex, vx, vy, weight) x
	# boneCount per logical control point). Unweighted: an empty array.
	var stream: PackedFloat64Array
	# Weighted: the ascending referenced-bone manifest (global bone indices), resolved once per frame into
	# bone_world_scratch. Null for an unweighted path. PackedInt32Array or null.
	var manifest_bones = null
	# The slot bone index the unweighted control points ride (-1 when unresolved). Unused for a weighted path.
	var slot_bone_index: int
	# Scratch (allocated once, reused per frame): world control points (2V), the per-curve cumulative-chord
	# LUT (curve_count * (PATH_CURVE_SUBDIVISIONS + 1)), and, weighted only, the packed on-demand world
	# buffer indexed by GLOBAL bone index (bone_count * MAT2X3_STRIDE). bone_world_scratch is null unweighted.
	var world_points: PackedFloat64Array
	var curve_lut: PackedFloat64Array
	var bone_world_scratch = null


# Module scratch reused across all path constraints (single-threaded solve, never re-entrant, matching
# resolve_world.gd's static-scratch convention): per-bone world positions (2N), per-bone tangent angles (N),
# per-bone spacing offsets (N), the point/tangent evaluation buffer (3 lanes: x, y, angle), the unweighted
# slot-bone world matrix (6 lanes), and the (curve, t) mapping output. The bone arrays grow once per larger
# constraint, so steady-state solving of same-or-smaller constraints allocates nothing.
static var _position_scratch := PackedFloat64Array()
static var _tangent_scratch := PackedFloat64Array()
static var _offset_scratch := PackedFloat64Array()
static var _point_scratch := PackedFloat64Array()
static var _slot_world_scratch := PackedFloat64Array()
static var _map_curve: int = 0
static var _map_t: float = 0.0


static func _ensure_scratch(n: int) -> void:
	if _position_scratch.size() < n * 2:
		_position_scratch.resize(n * 2)
	if _tangent_scratch.size() < n:
		_tangent_scratch.resize(n)
	if _offset_scratch.size() < n:
		_offset_scratch.resize(n)
	if _point_scratch.size() < 3:
		_point_scratch.resize(3)
	if _slot_world_scratch.size() < Affine.MAT2X3_STRIDE:
		_slot_world_scratch.resize(Affine.MAT2X3_STRIDE)


# Solve one path constraint against the pose (ADR-0013). Resolves world control points, distributes the
# bones along the arc, orients them per rotate_mode, and writes each bone's local, all blended by the
# per-frame sampled mix channels. A constraint with no prepared path (no resolvable setup path attachment),
# a non-positive-length path, or all-zero mix is a no-op.
static func solve(pose: Pose, constraint) -> void:
	var geom = constraint.path
	if geom == null:
		return
	var bones: PackedInt32Array = constraint.bone_indices
	var n := bones.size()
	if n == 0:
		return

	var mix_rotate: float = constraint.sampled_mix_rotate
	var mix_x: float = constraint.sampled_mix_x
	var mix_y: float = constraint.sampled_mix_y
	if mix_rotate <= 0.0 and mix_x <= 0.0 and mix_y <= 0.0:
		return

	var total_length: float = geom.lengths[geom.curve_count - 1]
	if total_length <= EPSILON:
		return

	_ensure_scratch(n)
	_compute_world_control_points(pose, geom)
	if geom.constant_speed:
		_build_curve_lut(geom)

	var base_position: float = (
		constraint.sampled_position * total_length
		if constraint.position_mode == "percent"
		else constraint.sampled_position
	)
	_compute_spacing_offsets(pose, constraint, total_length, constraint.sampled_spacing)

	# Pass 1: sample the world path position and tangent angle for every bone (pure path samples,
	# independent of the local writes, so chain rotation can read a neighbour's position safely).
	for b in range(n):
		var s := _normalize_position(base_position + _offset_scratch[b], total_length, geom.closed)
		_map_position(geom, s)
		_eval_curve(geom, _map_curve, _map_t, _point_scratch)
		_position_scratch[b * 2] = _point_scratch[0]
		_position_scratch[b * 2 + 1] = _point_scratch[1]
		_tangent_scratch[b] = _point_scratch[2]

	# Pass 2: orient and write each bone.
	var rotate_mode: String = constraint.rotate_mode
	var offset_rad: float = constraint.offset_rotation * Affine.DEG_TO_RAD
	for b in range(n):
		var bone_index := bones[b]
		if bone_index < 0:
			continue
		var px := _position_scratch[b * 2]
		var py := _position_scratch[b * 2 + 1]

		var angle := _tangent_scratch[b]
		var scale_x_mul := 1.0
		if rotate_mode != "tangent" and b < n - 1:
			var nx := _position_scratch[(b + 1) * 2]
			var ny := _position_scratch[(b + 1) * 2 + 1]
			var dx := nx - px
			var dy := ny - py
			if dx * dx + dy * dy > EPSILON:
				angle = atan2(dy, dx)
				if rotate_mode == "chainScale":
					var desired := Affine.hypot(dx, dy)
					var natural := _natural_length(pose, bone_index) * _world_x_scale(pose, bone_index)
					scale_x_mul = desired / natural if natural > EPSILON else 1.0
		_write_bone_local(pose, bone_index, px, py, angle + offset_rad, scale_x_mul, mix_rotate, mix_x, mix_y)


# Fill geom.world_points (2V lanes) with the WORLD positions of the path's control points at solve-order
# step 3, resolving bone worlds on demand (ADR-0013 section 2). Allocation-free.
static func _compute_world_control_points(pose: Pose, geom) -> void:
	var out: PackedFloat64Array = geom.world_points
	if geom.weighted:
		# Resolve each referenced bone's world once into the packed scratch (indexed by global bone index),
		# then walk the ADR-0002 stream exactly as the skin solve does, accumulating in stored influence order.
		var manifest: PackedInt32Array = geom.manifest_bones
		var world: PackedFloat64Array = geom.bone_world_scratch
		for i in range(manifest.size()):
			var bone_index := manifest[i]
			if bone_index >= 0:
				ResolveWorld.resolve(pose, bone_index, world, bone_index * Affine.MAT2X3_STRIDE)
		var stream: PackedFloat64Array = geom.stream
		var length := stream.size()
		var cursor := 0
		var out_index := 0
		while cursor < length:
			var influence_count := int(stream[cursor])
			cursor += 1
			var px := 0.0
			var py := 0.0
			for k in range(influence_count):
				var bone_offset := int(stream[cursor]) * Affine.MAT2X3_STRIDE
				var vx := stream[cursor + 1]
				var vy := stream[cursor + 2]
				var weight := stream[cursor + 3]
				cursor += 4
				var a := world[bone_offset]
				var b := world[bone_offset + 1]
				var c := world[bone_offset + 2]
				var d := world[bone_offset + 3]
				var tx := world[bone_offset + 4]
				var ty := world[bone_offset + 5]
				px += weight * (a * vx + c * vy + tx)
				py += weight * (b * vx + d * vy + ty)
			out[out_index] = px
			out[out_index + 1] = py
			out_index += 2
		return

	# Unweighted: every control point rides the slot's bone: worldPoint = slotBoneWorld * (x, y).
	var bone_index: int = geom.slot_bone_index
	if bone_index < 0:
		return
	ResolveWorld.resolve(pose, bone_index, _slot_world_scratch, 0)
	var a := _slot_world_scratch[0]
	var b := _slot_world_scratch[1]
	var c := _slot_world_scratch[2]
	var d := _slot_world_scratch[3]
	var tx := _slot_world_scratch[4]
	var ty := _slot_world_scratch[5]
	var verts: PackedFloat64Array = geom.local_vertices
	var count := verts.size()
	var i := 0
	while i < count:
		var x := verts[i]
		var y := verts[i + 1]
		out[i] = a * x + c * y + tx
		out[i + 1] = b * x + d * y + ty
		i += 2


# Evaluate the world cubic Bezier of curve `i` at parameter t into (out[0], out[1]) and its tangent ANGLE
# (radians) into out[2] (ADR-0013 section 1). The four control points are cp[3i .. 3i+3]; the end anchor
# wraps modulo V, which for a closed spline returns curve C-1's end to control point 0 and for an open spline
# is a no-op (3(C-1)+3 = V-1 < V). Reads geom.world_points directly (no allocation).
static func _eval_curve(geom, i: int, t: float, out: PackedFloat64Array) -> void:
	var wp: PackedFloat64Array = geom.world_points
	var v: int = geom.vertex_count
	var b0 := i * 3
	var p0 := b0 % v
	var p1 := (b0 + 1) % v
	var p2 := (b0 + 2) % v
	var p3 := (b0 + 3) % v
	var x0 := wp[p0 * 2]
	var y0 := wp[p0 * 2 + 1]
	var x1 := wp[p1 * 2]
	var y1 := wp[p1 * 2 + 1]
	var x2 := wp[p2 * 2]
	var y2 := wp[p2 * 2 + 1]
	var x3 := wp[p3 * 2]
	var y3 := wp[p3 * 2 + 1]
	var u := 1.0 - t
	var c0 := u * u * u
	var c1 := 3.0 * u * u * t
	var c2 := 3.0 * u * t * t
	var c3 := t * t * t
	out[0] = c0 * x0 + c1 * x1 + c2 * x2 + c3 * x3
	out[1] = c0 * y0 + c1 * y1 + c2 * y2 + c3 * y3
	var d0 := 3.0 * u * u
	var d1 := 6.0 * u * t
	var d2 := 3.0 * t * t
	var dx := d0 * (x1 - x0) + d1 * (x2 - x1) + d2 * (x3 - x2)
	var dy := d0 * (y1 - y0) + d1 * (y2 - y1) + d2 * (y3 - y2)
	out[2] = atan2(dy, dx)


# Build the per-curve cumulative-chord LUT in WORLD space (ADR-0013 section 3b), used only for constant
# speed. For each curve, PATH_CURVE_SUBDIVISIONS+1 samples of the world Bezier are chorded and accumulated;
# curve_lut[curve * stride + k] is the cumulative chord length to sub-sample k (entry 0 is always 0).
static func _build_curve_lut(geom) -> void:
	var stride := PATH_CURVE_SUBDIVISIONS + 1
	var lut: PackedFloat64Array = geom.curve_lut
	for i in range(geom.curve_count):
		var base := i * stride
		lut[base] = 0.0
		_eval_curve(geom, i, 0.0, _point_scratch)
		var prev_x := _point_scratch[0]
		var prev_y := _point_scratch[1]
		var acc := 0.0
		for k in range(1, PATH_CURVE_SUBDIVISIONS + 1):
			_eval_curve(geom, i, float(k) / float(PATH_CURVE_SUBDIVISIONS), _point_scratch)
			var x := _point_scratch[0]
			var y := _point_scratch[1]
			acc += Affine.hypot(x - prev_x, y - prev_y)
			lut[base + k] = acc
			prev_x = x
			prev_y = y


# Map an already-normalized arc-length position `s` in [0, L] to a curve index and Bezier parameter t
# (ADR-0013 section 3), writing them into _map_curve / _map_t. Cross-curve selection reads the committed
# cumulative `lengths`; the within-curve fraction becomes t directly (naive per-curve t) or, for constant
# speed, inverts the world LUT.
static func _map_position(geom, s: float) -> void:
	var lengths: PackedFloat64Array = geom.lengths
	var curve_count: int = geom.curve_count
	# Smallest curve whose cumulative end length reaches s (linear scan; curve counts are small and this
	# ports trivially, a monotone search over the committed table, ADR-0013 section 3a).
	var curve := 0
	while curve < curve_count - 1 and lengths[curve] < s:
		curve += 1
	var curve_start := 0.0 if curve == 0 else lengths[curve - 1]
	var curve_len := lengths[curve] - curve_start
	var curve_fraction := Scalar.clampd((s - curve_start) / curve_len, 0.0, 1.0) if curve_len > EPSILON else 0.0
	_map_curve = curve
	if not geom.constant_speed:
		_map_t = curve_fraction
		return
	_map_t = _invert_curve_lut(geom, curve, curve_fraction)


# Invert the world arc-length LUT of `curve` for a target fraction-of-curve in [0, 1], returning the Bezier
# parameter t (ADR-0013 section 3b). Linear interpolation inside the bracketing sub-segment; a zero-length
# curve or sub-segment resolves to the segment start (no division by zero).
static func _invert_curve_lut(geom, curve: int, fraction: float) -> float:
	var stride := PATH_CURVE_SUBDIVISIONS + 1
	var base := curve * stride
	var lut: PackedFloat64Array = geom.curve_lut
	var total := lut[base + PATH_CURVE_SUBDIVISIONS]
	if total <= EPSILON:
		return fraction
	var target_len := fraction * total
	var k := 0
	while k < PATH_CURVE_SUBDIVISIONS - 1 and lut[base + k + 1] < target_len:
		k += 1
	var seg_start := lut[base + k]
	var seg_len := lut[base + k + 1] - seg_start
	var seg_fraction := (target_len - seg_start) / seg_len if seg_len > EPSILON else 0.0
	return (float(k) + seg_fraction) / float(PATH_CURVE_SUBDIVISIONS)


# Normalize a target arc-length position for an open (clamp to [0, L]) or closed (floored-modulo wrap into
# [0, L)) path (ADR-0013 section 4.1). The nested fmod reproduces the JS ((s % L) + L) % L exactly.
static func _normalize_position(s: float, total_length: float, closed: bool) -> float:
	if closed:
		return fmod(fmod(s, total_length) + total_length, total_length)
	return Scalar.clampd(s, 0.0, total_length)


# The setup natural length of a constrained bone (ADR-0013 section 4). pose.bone_length holds each bone's
# setup length; an unresolved bone index contributes 0.
static func _natural_length(pose: Pose, bone_index: int) -> float:
	return pose.bone_length[bone_index] if bone_index >= 0 else 0.0


# Compute the cumulative arc-length offset from bone 0 to bone b for spacing_mode (ADR-0013 section 4) into
# _offset_scratch (n entries). gap[b] is the increment from bone b-1 to bone b.
static func _compute_spacing_offsets(pose: Pose, constraint, total_length: float, spacing: float) -> void:
	var bones: PackedInt32Array = constraint.bone_indices
	var n := bones.size()
	var mode: String = constraint.spacing_mode
	# proportional needs the natural total of the N-1 gap-contributing bones (bones 0 .. N-2).
	var scale := 0.0
	if mode == "proportional":
		var natural_total := 0.0
		for b in range(n - 1):
			natural_total += _natural_length(pose, bones[b])
		scale = spacing / natural_total if natural_total > EPSILON else 0.0
	_offset_scratch[0] = 0.0
	for b in range(1, n):
		var gap: float
		if mode == "fixed":
			gap = spacing
		elif mode == "percent":
			gap = spacing * total_length
		elif mode == "length":
			gap = _natural_length(pose, bones[b - 1])
		else:  # proportional
			gap = _natural_length(pose, bones[b - 1]) * scale
		_offset_scratch[b] = _offset_scratch[b - 1] + gap


# Write a bone's blended local from a target world position and world rotation, expressed in the bone's
# parent world frame and mix-blended per channel (ADR-0013 section 5). mix* = 0 leaves the bone's current
# local exactly; mix* = 1 lands on the target. scale_x_mul = 1 (every mode but chainScale) leaves scaleX.
static func _write_bone_local(
	pose: Pose,
	bone_index: int,
	world_x: float,
	world_y: float,
	world_angle_rad: float,
	scale_x_mul: float,
	mix_rotate: float,
	mix_x: float,
	mix_y: float
) -> void:
	var parent_world := ResolveWorld.parent_world_mat(pose, bone_index)
	var inv := Affine.invert(parent_world)
	var local_x := inv[0] * world_x + inv[2] * world_y + inv[4]
	var local_y := inv[1] * world_x + inv[3] * world_y + inv[5]
	var solved_rot_deg := Ik._world_dir_to_local_rot_deg(parent_world, world_angle_rad)
	var current := Affine.decompose(ResolveWorld.local_mat(pose, bone_index))
	var x := current.x + mix_x * (local_x - current.x)
	var y := current.y + mix_y * (local_y - current.y)
	var rot := current.rotation_deg + mix_rotate * Scalar.wrap_degrees(solved_rot_deg - current.rotation_deg)
	var scale_x := current.scale_x * (1.0 + mix_rotate * (scale_x_mul - 1.0))
	Affine.compose_into(
		pose.local,
		bone_index * Affine.MAT2X3_STRIDE,
		x,
		y,
		rot,
		scale_x,
		current.scale_y,
		current.shear_x_deg,
		0.0
	)


# The current world X-axis magnitude of a bone (its world segment scale), for chainScale length preservation.
static func _world_x_scale(pose: Pose, bone_index: int) -> float:
	var world := ResolveWorld.resolve_mat(pose, bone_index)
	return Affine.hypot(world[0], world[1])
