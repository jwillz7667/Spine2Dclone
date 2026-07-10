extends RefCounted
# Timeline curve evaluation and the solve side track representation (mirrors
# packages/runtime-core/src/skeleton/curve.ts and runtimes/unity Curve.cs, LAW 4). This is our first
# principles bezier easing: the cubic is sampled on build into a fixed (x, y) table; sampling brackets by
# x and lerps y. No iterative root finding, deterministic. The 10 segment table is mirrored exactly.

const Document = preload("res://core/document.gd")
const Prepared = preload("res://core/prepared.gd")

# The piecewise linear resolution of the bezier easing curve. A committed design constant.
const BEZIER_SEGMENTS := 10
const BEZIER_POINTS := BEZIER_SEGMENTS + 1

const CURVE_LINEAR := 0
const CURVE_STEPPED := 1
const CURVE_BEZIER := 2

enum TransformMixChannel { MIX_ROTATE, MIX_X, MIX_Y, MIX_SCALE_X, MIX_SCALE_Y, MIX_SHEAR_Y }

enum IkDepthChannel { STRETCH, COMPRESS }

enum PathChannel { POSITION, SPACING, MIX_ROTATE, MIX_X, MIX_Y }


# A cubic bezier coordinate at parameter s, expanded form (no fused multiply add reassociation, so other
# runtimes match the operation order). P0 and P3 are the implicit easing endpoints (0 and 1).
static func _bezier_1d(p0: float, p1: float, p2: float, p3: float, s: float) -> float:
	var u := 1.0 - s
	return (u * u * u * p0) + (3.0 * u * u * s * p1) + (3.0 * u * s * s * p2) + (s * s * s * p3)


static func _append_bezier_table(out_lanes: Array, cx1: float, cy1: float, cx2: float, cy2: float) -> void:
	var previous_x := -INF
	for k in range(BEZIER_SEGMENTS + 1):
		var s := float(k) / float(BEZIER_SEGMENTS)
		var x := _bezier_1d(0.0, cx1, cx2, 1.0, s)
		var y := _bezier_1d(0.0, cy1, cy2, 1.0, s)
		if x < previous_x:
			push_error(
				"bezier x table is not non-decreasing at s=%s (x=%s < previous %s); control x must be "
				% [s, x, previous_x] + "within [0, 1] (validator CURVE_BEZIER_X_RANGE)"
			)
		previous_x = x
		out_lanes.append(x)
		out_lanes.append(y)


# Evaluate the eased y for normalized input nx in (0, 1], reading the packed (x, y) table at base_index.
static func eval_bezier_y(table: PackedFloat64Array, base_index: int, nx: float) -> float:
	var lo := 0
	var hi := BEZIER_POINTS - 1
	while lo < hi:
		var mid := (lo + hi) >> 1
		if table[base_index + (mid * 2)] >= nx:
			hi = mid
		else:
			lo = mid + 1
	var j := 1 if lo == 0 else lo
	var k := j - 1
	var x0 := table[base_index + (k * 2)]
	var x1 := table[base_index + (j * 2)]
	var y0 := table[base_index + (k * 2) + 1]
	var y1 := table[base_index + (j * 2) + 1]
	var span := x1 - x0
	if span <= 0.0:
		return y0
	return y0 + (((y1 - y0) * (nx - x0)) / span)


# Build a standalone packed bezier table (BEZIER_POINTS (x, y) pairs). Used by the unit checks.
static func build_bezier_table(cx1: float, cy1: float, cx2: float, cy2: float) -> PackedFloat64Array:
	var lanes := []
	_append_bezier_table(lanes, cx1, cy1, cx2, cy2)
	return PackedFloat64Array(lanes)


# curves is an Array of Document.Curve; times and values are PackedFloat64Array.
static func _build_track(
	key_count: int,
	component_count: int,
	times: PackedFloat64Array,
	curves: Array,
	values: PackedFloat64Array
) -> Prepared.PreparedTrack:
	var curve_kinds := PackedByteArray()
	curve_kinds.resize(key_count)
	var bezier_base := PackedInt32Array()
	bezier_base.resize(key_count)
	for i in range(key_count):
		bezier_base[i] = -1

	var bezier_lanes := []
	for i in range(key_count):
		var kind: int = curves[i].kind
		if kind == Document.CurveKind.BEZIER:
			curve_kinds[i] = CURVE_BEZIER
			# Only a non final keyframe has an outgoing segment to ease; the last curve is ignored.
			if i < key_count - 1:
				bezier_base[i] = bezier_lanes.size()
				var c: Document.TimelineCurve = curves[i]
				_append_bezier_table(bezier_lanes, c.cx1, c.cy1, c.cx2, c.cy2)
		elif kind == Document.CurveKind.STEPPED:
			curve_kinds[i] = CURVE_STEPPED
		else:
			curve_kinds[i] = CURVE_LINEAR

	var track := Prepared.PreparedTrack.new()
	track.key_count = key_count
	track.component_count = component_count
	track.times = times
	track.values = values
	track.curve_kinds = curve_kinds
	track.bezier_base = bezier_base
	track.bezier_table = PackedFloat64Array(bezier_lanes)
	return track


static func build_scalar_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		values[i] = keys[i].value
		curves.append(keys[i].curve)
	return _build_track(key_count, 1, times, curves, values)


static func build_vec2_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count * 2)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		values[i * 2] = keys[i].x
		values[(i * 2) + 1] = keys[i].y
		curves.append(keys[i].curve)
	return _build_track(key_count, 2, times, curves, values)


static func build_color_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count * 4)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		var color: Document.Rgba = keys[i].color
		values[i * 4] = color.r
		values[(i * 4) + 1] = color.g
		values[(i * 4) + 2] = color.b
		values[(i * 4) + 3] = color.a
		curves.append(keys[i].curve)
	return _build_track(key_count, 4, times, curves, values)


# One split component bone track (ADR-0009 section 4.1): a single scalar lane read from a { value }
# keyframe (translateX/Y, scaleX/Y, shearX/Y). The apply layer composes it as add (translate, shear) or
# multiply (scale) onto the setup lane, matching the joint channel's per-component math. Mirrors
# buildComponentTrack in curve.ts.
static func build_component_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		values[i] = keys[i].value
		curves.append(keys[i].curve)
	return _build_track(key_count, 1, times, curves, values)


# The split rgb slot color track (ADR-0009 section 4.2): three lanes from an { rgb } keyframe. Alpha rides
# the separate alpha track (build_alpha_track), so this writes only lanes 0..2. Mirrors buildRgbTrack.
static func build_rgb_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count * 3)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		values[i * 3] = keys[i].r
		values[(i * 3) + 1] = keys[i].g
		values[(i * 3) + 2] = keys[i].b
		curves.append(keys[i].curve)
	return _build_track(key_count, 3, times, curves, values)


# The split alpha slot color track (ADR-0009 section 4.2): one lane from an { alpha } keyframe (read into
# a ScalarKeyframe.value by the reader). Mirrors buildAlphaTrack in curve.ts.
static func build_alpha_track(keys: Array) -> Prepared.PreparedTrack:
	var key_count := keys.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = keys[i].time
		values[i] = keys[i].value
		curves.append(keys[i].curve)
	return _build_track(key_count, 1, times, curves, values)


static func build_ik_mix_track(frames: Array) -> Prepared.PreparedTrack:
	var key_count := frames.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = frames[i].time
		values[i] = frames[i].mix
		curves.append(frames[i].curve)
	return _build_track(key_count, 1, times, curves, values)


# The bendPositive channel is stepped: no curve, no eased value, only the 0/1 flag held until the next key.
static func build_bend_track(frames: Array) -> Prepared.PreparedStepBoolTrack:
	var key_count := frames.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedByteArray()
	values.resize(key_count)
	for i in range(key_count):
		times[i] = frames[i].time
		values[i] = 1 if frames[i].bend_positive else 0
	var track := Prepared.PreparedStepBoolTrack.new()
	track.key_count = key_count
	track.times = times
	track.values = values
	return track


# The optional keyable softness channel of an IK timeline (ADR-0010 section 2.4): built from ONLY the
# frames that key softness (it is optional on the IkFrame). Interpolated by its curve like mix. Returns
# null when no frame keys it, so the constraint's base softness holds.
static func build_ik_softness_track(frames: Array):
	var present := []
	for i in range(frames.size()):
		if frames[i].softness != null:
			present.append(frames[i])
	if present.size() == 0:
		return null

	var key_count := present.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = present[i].time
		values[i] = float(present[i].softness)
		curves.append(present[i].curve)
	return _build_track(key_count, 1, times, curves, values)


# An optional keyable stepped-boolean depth channel of an IK timeline (stretch or compress, ADR-0010
# section 2.4): built from ONLY the frames that key it, stepped like the bend channel, resolved by the
# discrete greater-weight-wins rule. Returns null when no frame keys it, so the constraint's base holds.
static func build_ik_depth_bool_track(frames: Array, channel: int):
	var present := []
	for i in range(frames.size()):
		if _select_ik_depth(frames[i], channel) != null:
			present.append(frames[i])
	if present.size() == 0:
		return null

	var key_count := present.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedByteArray()
	values.resize(key_count)
	for i in range(key_count):
		times[i] = present[i].time
		values[i] = 1 if _select_ik_depth(present[i], channel) == true else 0
	var track := Prepared.PreparedStepBoolTrack.new()
	track.key_count = key_count
	track.times = times
	track.values = values
	return track


static func _select_ik_depth(frame, channel: int):
	if channel == IkDepthChannel.STRETCH:
		return frame.stretch
	return frame.compress


# One mix channel of a transform constraint timeline, built from ONLY the keyframes that key it. A
# channel no keyframe keys yields null, and step 2 then holds the constraint's base value for it.
static func build_transform_mix_track(frames: Array, channel: int):
	var present := []
	for i in range(frames.size()):
		if _select_channel(frames[i], channel) != null:
			present.append(frames[i])
	if present.size() == 0:
		return null

	var key_count := present.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = present[i].time
		var v = _select_channel(present[i], channel)
		values[i] = 0.0 if v == null else float(v)
		curves.append(present[i].curve)
	return _build_track(key_count, 1, times, curves, values)


static func _select_channel(frame, channel: int):
	match channel:
		TransformMixChannel.MIX_ROTATE:
			return frame.mix_rotate
		TransformMixChannel.MIX_X:
			return frame.mix_x
		TransformMixChannel.MIX_Y:
			return frame.mix_y
		TransformMixChannel.MIX_SCALE_X:
			return frame.mix_scale_x
		TransformMixChannel.MIX_SCALE_Y:
			return frame.mix_scale_y
		_:
			return frame.mix_shear_y


# One channel of a path-constraint timeline (ADR-0011 section 3, ADR-0013): position, spacing, mixRotate,
# mixX, or mixY. Built from ONLY the keyframes that key it (the same absent-channel semantics as the
# transform mix track), each interpolated by its own curve. Returns null when no keyframe keys the channel,
# so step 2 holds the constraint's base value for it. Mirrors buildPathTrack in curve.ts.
static func build_path_track(frames: Array, channel: int):
	var present := []
	for i in range(frames.size()):
		if _select_path_channel(frames[i], channel) != null:
			present.append(frames[i])
	if present.size() == 0:
		return null

	var key_count := present.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count)
	var curves := []
	for i in range(key_count):
		times[i] = present[i].time
		var v = _select_path_channel(present[i], channel)
		values[i] = 0.0 if v == null else float(v)
		curves.append(present[i].curve)
	return _build_track(key_count, 1, times, curves, values)


static func _select_path_channel(frame, channel: int):
	match channel:
		PathChannel.POSITION:
			return frame.position
		PathChannel.SPACING:
			return frame.spacing
		PathChannel.MIX_ROTATE:
			return frame.mix_rotate
		PathChannel.MIX_X:
			return frame.mix_x
		_:
			return frame.mix_y


static func build_deform_track(frames: Array) -> Prepared.PreparedTrack:
	var component_count := 0
	if frames.size() > 0:
		component_count = frames[0].offsets.size()
	var key_count := frames.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var values := PackedFloat64Array()
	values.resize(key_count * component_count)
	var curves := []
	for i in range(key_count):
		times[i] = frames[i].time
		var offsets: PackedFloat64Array = frames[i].offsets
		for c in range(component_count):
			values[(i * component_count) + c] = offsets[c]
		curves.append(frames[i].curve)
	return _build_track(key_count, component_count, times, curves, values)


static func build_attachment_track(frames: Array) -> Prepared.PreparedAttachmentTrack:
	var key_count := frames.size()
	var times := PackedFloat64Array()
	times.resize(key_count)
	var names := []
	names.resize(key_count)
	for i in range(key_count):
		times[i] = frames[i].time
		names[i] = frames[i].name
	var track := Prepared.PreparedAttachmentTrack.new()
	track.key_count = key_count
	track.times = times
	track.names = names
	return track


# The segment index for time t: the greatest i with times[i] <= t, clamped to [0, key_count - 1].
static func find_segment_index(times: PackedFloat64Array, key_count: int, t: float) -> int:
	var last := key_count - 1
	if t <= times[0]:
		return 0
	if t >= times[last]:
		return last
	var lo := 0
	var hi := last
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if times[mid] <= t:
			lo = mid
		else:
			hi = mid
	return lo


# The interpolation fraction within segment i at time t, honoring the segment's curve.
static func segment_fraction(track: Prepared.PreparedTrack, i: int, t: float) -> float:
	if i + 1 >= track.key_count:
		return 0.0
	var kind := track.curve_kinds[i]
	if kind == CURVE_STEPPED:
		return 0.0
	var t0 := track.times[i]
	var span := track.times[i + 1] - t0
	var nx := (t - t0) / span if span > 0.0 else 0.0
	if nx <= 0.0:
		return 0.0
	if nx > 1.0:
		nx = 1.0
	if kind == CURVE_BEZIER:
		return eval_bezier_y(track.bezier_table, track.bezier_base[i], nx)
	return nx


# Component c of segment i interpolated by fraction f.
static func segment_component(track: Prepared.PreparedTrack, i: int, f: float, c: int) -> float:
	var cc := track.component_count
	var a := track.values[(i * cc) + c]
	if i + 1 >= track.key_count:
		return a
	var b := track.values[((i + 1) * cc) + c]
	return a + ((b - a) * f)


static func sample_attachment_name(track: Prepared.PreparedAttachmentTrack, t: float):
	var i := find_segment_index(track.times, track.key_count, t)
	return track.names[i]


static func sample_step_bool(track: Prepared.PreparedStepBoolTrack, t: float) -> bool:
	var i := find_segment_index(track.times, track.key_count, t)
	return track.values[i] == 1


# The index of the active draw-order key at time t: the LATEST key at or before t (stepped). Returns -1
# when t is below the first key, so NO reorder is active and the setup order holds (ADR-0008; mirrors
# findDrawOrderKeyIndex in curve.ts). Draw-order timelines are short, so a linear scan is used.
static func find_draw_order_key_index(timeline: Prepared.PreparedDrawOrderTimeline, t: float) -> int:
	if timeline.key_count == 0 or t < timeline.times[0]:
		return -1
	for i in range(timeline.key_count - 1, -1, -1):
		if timeline.times[i] <= t:
			return i
	return -1


# Build a prepared draw-order timeline (ADR-0008 section 3, PP-B4): resolve each key's compact
# {slot, offset} list into a FULL render-order permutation ONCE at build time, so step-2 application is a
# single typed-array copy. Mirrors buildDrawOrderTimeline in curve.ts.
static func build_draw_order_timeline(keys: Array, slot_index_by_name: Dictionary, slot_count: int) -> Prepared.PreparedDrawOrderTimeline:
	var timeline := Prepared.PreparedDrawOrderTimeline.new()
	timeline.key_count = keys.size()
	timeline.times = PackedFloat64Array()
	timeline.times.resize(keys.size())
	timeline.orders = []
	for k in range(keys.size()):
		var key = keys[k]
		timeline.times[k] = key.time
		timeline.orders.append(_resolve_draw_order(key.offsets, slot_index_by_name, slot_count))
	return timeline


# Derive ONE key's full render-order permutation from its offset diff (ADR-0008 section 3): each listed
# slot is pinned to its target render position (setup index + offset), every unlisted slot keeps its
# relative setup order filling the remaining positions front to back. The result is order[pos] = slot.
# Out-of-range or unknown-slot entries (only reachable from an unvalidated draft) are skipped
# defensively. Mirrors resolveDrawOrder in curve.ts.
static func _resolve_draw_order(offsets: Array, slot_index_by_name: Dictionary, slot_count: int) -> PackedInt32Array:
	var order := PackedInt32Array()
	order.resize(slot_count)
	for i in range(slot_count):
		order[i] = -1
	var listed := PackedByteArray()
	listed.resize(slot_count)
	for o in range(offsets.size()):
		var entry = offsets[o]
		var slot_index: int = slot_index_by_name.get(entry.slot, -1)
		if slot_index < 0:
			continue
		var target: int = slot_index + int(entry.offset)
		if target < 0 or target >= slot_count:
			continue
		order[target] = slot_index
		listed[slot_index] = 1
	var next_unlisted := 0
	for pos in range(slot_count):
		if order[pos] != -1:
			continue
		while next_unlisted < slot_count and listed[next_unlisted] == 1:
			next_unlisted += 1
		order[pos] = next_unlisted
		next_unlisted += 1
	return order
