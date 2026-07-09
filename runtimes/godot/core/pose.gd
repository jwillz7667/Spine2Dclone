extends RefCounted
# Pre allocated, index addressed storage for a skeleton solve (mirrors packages/runtime-core/src/
# skeleton/pose.ts and runtimes/unity Pose.cs). Every buffer is sized once and reused across solves.
# Bones are stored in document order, which the format validator guarantees is parent before child.
# Packed numeric buffers are PackedFloat64Array (passed by reference, mutated in place by the solve).

const Affine = preload("res://core/affine.gd")

# f64 lanes per bone setup transform: x, y, rotation, scaleX, scaleY, shearX, shearY (degrees for angles).
const SETUP_STRIDE := 7
# f64 lanes per slot color: r, g, b, a in [0, 1].
const SLOT_COLOR_STRIDE := 4


# The per channel mix of a transform constraint. Mutable: step 2 blends the sampled mix in place. Degrees
# for rotate and shear_y.
class TransformMix:
	var rotate: float
	var x: float
	var y: float
	var scale_x: float
	var scale_y: float
	var shear_y: float

	func _init(r: float, tx: float, ty: float, sx: float, sy: float, shy: float) -> void:
		rotate = r
		x = tx
		y = ty
		scale_x = sx
		scale_y = sy
		shear_y = shy

	func copy_from(source: TransformMix) -> void:
		rotate = source.rotate
		x = source.x
		y = source.y
		scale_x = source.scale_x
		scale_y = source.scale_y
		shear_y = source.shear_y


# The per channel offset of a transform constraint (degrees for rotation and shear_y). Set once at build.
class TransformOffset:
	var rotation: float
	var x: float
	var y: float
	var scale_x: float
	var scale_y: float
	var shear_y: float

	func _init(r: float, tx: float, ty: float, sx: float, sy: float, shy: float) -> void:
		rotation = r
		x = tx
		y = ty
		scale_x = sx
		scale_y = sy
		shear_y = shy


# An IK constraint resolved against the pose. Chain bones and target are stored as BONE INDICES so step 3
# never re resolves names per frame. sampled_mix and sampled_bend_positive are the per frame scratch step
# 2 writes and step 3 reads.
class ResolvedIkConstraint:
	var name: String
	var bone_indices: PackedInt32Array
	var target_index: int
	var base_mix: float
	var base_bend_positive: bool
	# Depth controls from the constraint definition (ADR-0009 section 1.1, ADR-0010 section 2). base_* are
	# the definition values; the sampled_* scratch carries the per-frame values (softness/stretch/compress
	# may be keyed, uniform is static). Defaults (softness 0, all false) reproduce the ADR-0003 hard solve.
	var base_softness: float
	var base_stretch: bool
	var base_compress: bool
	var uniform: bool
	# The explicit combined-set solve order (ADR-0009 section 1.3), or -1 when this constraint carries none.
	var order: int
	var sampled_mix: float
	var sampled_bend_positive: bool
	var sampled_softness: float
	var sampled_stretch: bool
	var sampled_compress: bool

	func _init(
		n: String,
		indices: PackedInt32Array,
		target: int,
		mix: float,
		bend: bool,
		softness: float,
		stretch: bool,
		compress: bool,
		is_uniform: bool,
		the_order: int
	) -> void:
		name = n
		bone_indices = indices
		target_index = target
		base_mix = mix
		base_bend_positive = bend
		base_softness = softness
		base_stretch = stretch
		base_compress = compress
		uniform = is_uniform
		order = the_order
		sampled_mix = mix
		sampled_bend_positive = bend
		sampled_softness = softness
		sampled_stretch = stretch
		sampled_compress = compress


# A transform constraint resolved against the pose.
class ResolvedTransformConstraint:
	var name: String
	var bone_indices: PackedInt32Array
	var target_index: int
	var base_mix: TransformMix
	var offset: TransformOffset
	# Variant flags (ADR-0009 section 1.2); default false/false is the ADR-0003 world absolute blend. The
	# variant solve is a later PP-B5 slice (ADR-0010 section 3); the flags are carried so the resolve stays
	# total. order is the explicit combined-set solve order (section 1.3), or -1 when it carries none.
	var local: bool
	var relative: bool
	var order: int
	var sampled_mix: TransformMix

	func _init(
		n: String,
		indices: PackedInt32Array,
		target: int,
		mix: TransformMix,
		off: TransformOffset,
		is_local: bool,
		is_relative: bool,
		the_order: int
	) -> void:
		name = n
		bone_indices = indices
		target_index = target
		base_mix = mix
		offset = off
		local = is_local
		relative = is_relative
		order = the_order
		sampled_mix = TransformMix.new(mix.rotate, mix.x, mix.y, mix.scale_x, mix.scale_y, mix.shear_y)


var bone_count: int
var bone_names: Array
var parent_indices: PackedInt32Array
var transform_modes: PackedInt32Array
var setup: PackedFloat64Array
var local: PackedFloat64Array
var blend_local: PackedFloat64Array
var bone_touched: PackedByteArray
var world: PackedFloat64Array
var bone_length: PackedFloat64Array

var slot_count: int
var slot_names: Array
var slot_bone_indices: PackedInt32Array
var slot_setup_color: PackedFloat64Array
var slot_color: PackedFloat64Array
var slot_attachment_win_weight: PackedFloat64Array
var ik_bend_win_weight: PackedFloat64Array
# One f64 per IK constraint each: the discrete greater-weight-wins winner weights for that constraint's
# sampled stretch and compress depth flags this frame (ADR-0010 section 2.4), reset to -1 by begin_blend,
# exactly like ik_bend_win_weight.
var ik_stretch_win_weight: PackedFloat64Array
var ik_compress_win_weight: PackedFloat64Array
var slot_setup_attachment: Array
var slot_attachment: Array

# The resolved render order (ADR-0008 draw order, PP-B4): draw_order[render_position] = slot_index,
# render_position 0 furthest back. Reset to slot_setup_draw_order (identity) each frame (step 1) and
# overwritten by the active draw-order key (step 2). draw_order_win_weight is a length-1 buffer holding
# the discrete winner weight (reset to -1 each frame), so a greater-weight layer wins the reorder.
var draw_order: PackedInt32Array
var slot_setup_draw_order: PackedInt32Array
var draw_order_win_weight: PackedFloat64Array

var ik_constraints: Array
var transform_constraints: Array
# The explicit combined-set solve schedule (ADR-0009 section 1.3, ADR-0010 section 1) or null when no
# constraint carries an order. When present it is a dense permutation of [0, N) (N = total constraints):
# solve_order[position] is a constraint CODE, code < ik_constraints.size() selecting ik_constraints[code],
# else transform_constraints[code - ik_constraints.size()]. Step 3 walks it in position order. Null keeps
# the exact ADR-0003 two-phase (all IK, then all transform) path. Precomputed once at build.
var solve_order = null  # PackedInt32Array or null

# Reused scratch for sampled deform offsets (grows only when a larger mesh is sampled).
var deform_scratch: PackedFloat64Array = PackedFloat64Array()

# Prepared animations cached by Animation object identity, so the first sample builds it and every later
# sample reuses it.
var prepared_animations: Dictionary = {}


func _init(
	the_bone_count: int,
	the_bone_names: Array,
	the_slot_count: int,
	the_slot_names: Array,
	the_ik_constraints: Array,
	the_transform_constraints: Array
) -> void:
	bone_count = the_bone_count
	bone_names = the_bone_names
	parent_indices = _int_buffer(bone_count)
	transform_modes = _int_buffer(bone_count)
	setup = _float_buffer(bone_count * SETUP_STRIDE)
	local = _float_buffer(bone_count * Affine.MAT2X3_STRIDE)
	blend_local = _float_buffer(bone_count * SETUP_STRIDE)
	bone_touched = _byte_buffer(bone_count)
	world = _float_buffer(bone_count * Affine.MAT2X3_STRIDE)
	bone_length = _float_buffer(bone_count)

	slot_count = the_slot_count
	slot_names = the_slot_names
	slot_bone_indices = _int_buffer(slot_count)
	slot_setup_color = _float_buffer(slot_count * SLOT_COLOR_STRIDE)
	slot_color = _float_buffer(slot_count * SLOT_COLOR_STRIDE)
	slot_attachment_win_weight = _float_buffer(slot_count)
	ik_bend_win_weight = _float_buffer(the_ik_constraints.size())
	ik_stretch_win_weight = _float_buffer(the_ik_constraints.size())
	ik_compress_win_weight = _float_buffer(the_ik_constraints.size())
	slot_setup_attachment = []
	slot_setup_attachment.resize(slot_count)
	slot_attachment = []
	slot_attachment.resize(slot_count)
	draw_order = _identity_draw_order(slot_count)
	slot_setup_draw_order = _identity_draw_order(slot_count)
	draw_order_win_weight = _float_buffer(1)

	ik_constraints = the_ik_constraints
	transform_constraints = the_transform_constraints
	solve_order = _build_solve_order(the_ik_constraints, the_transform_constraints)


# Precompute the explicit combined-set solve schedule (ADR-0010 section 1). Returns null when no constraint
# carries an order (the ADR-0003 two-phase default). When ANY carries one, the format guarantees a dense
# unique permutation of [0, N); this builds the position->code map from that. It is defensive against an
# unvalidated document: a partial, duplicated, gapped, or out-of-range assignment falls back to null (the
# safe document-order default) rather than producing a corrupt schedule.
static func _build_solve_order(ik: Array, transform: Array):
	var total := ik.size() + transform.size()
	if total == 0:
		return null

	var any_order := false
	for i in range(ik.size()):
		if ik[i].order >= 0:
			any_order = true
	for i in range(transform.size()):
		if transform[i].order >= 0:
			any_order = true
	if not any_order:
		return null

	var codes := PackedInt32Array()
	codes.resize(total)
	for i in range(total):
		codes[i] = -1
	for i in range(ik.size()):
		if not _place_order(codes, total, ik[i].order, i):
			return null
	for j in range(transform.size()):
		if not _place_order(codes, total, transform[j].order, ik.size() + j):
			return null
	return codes


static func _place_order(codes: PackedInt32Array, total: int, order: int, code: int) -> bool:
	if order < 0 or order >= total or codes[order] != -1:
		return false
	codes[order] = code
	return true


static func _float_buffer(n: int) -> PackedFloat64Array:
	var a := PackedFloat64Array()
	a.resize(n)
	return a


static func _int_buffer(n: int) -> PackedInt32Array:
	var a := PackedInt32Array()
	a.resize(n)
	return a


static func _byte_buffer(n: int) -> PackedByteArray:
	var a := PackedByteArray()
	a.resize(n)
	return a


static func _identity_draw_order(n: int) -> PackedInt32Array:
	var a := PackedInt32Array()
	a.resize(n)
	for i in range(n):
		a[i] = i
	return a
