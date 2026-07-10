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
	# The names of the skins that SCOPE this constraint (ADR-0009 section 5, ADR-0011 section 4), or null
	# when no skin lists it (unscoped, always active). A scoped constraint solves only when one of these
	# skins is active (the 'default' skin is always active). Captured once at build. PackedStringArray or null.
	var scope_skins = null
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
		the_order: int,
		the_scope_skins = null
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
		scope_skins = the_scope_skins
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
	# The names of the skins that SCOPE this constraint (ADR-0009 section 5), or null when unscoped
	# (always active). Captured once at build. PackedStringArray or null.
	var scope_skins = null
	var sampled_mix: TransformMix

	func _init(
		n: String,
		indices: PackedInt32Array,
		target: int,
		mix: TransformMix,
		off: TransformOffset,
		is_local: bool,
		is_relative: bool,
		the_order: int,
		the_scope_skins = null
	) -> void:
		name = n
		bone_indices = indices
		target_index = target
		base_mix = mix
		offset = off
		local = is_local
		relative = is_relative
		order = the_order
		scope_skins = the_scope_skins
		sampled_mix = TransformMix.new(mix.rotate, mix.x, mix.y, mix.scale_x, mix.scale_y, mix.shear_y)


# A path constraint resolved against the pose (ADR-0013, PP-B6). bone_indices are the bones distributed
# along the path (document/list order == along-path order). `path` is the prepared spline GEOMETRY (a
# PreparedPathGeometry from path_constraint.gd) built once from the target slot's setup default-skin path
# attachment, or null when no path is resolvable (the constraint is then a no-op). The mode strings, base
# channel values, and offset_rotation come from the constraint definition; the sampled_* scratch is the per-
# frame values step 2 writes (from the path timeline, else the base) and step 3 reads. Built once; the per-
# frame solve allocates nothing. `path` is left untyped so pose.gd does not preload path_constraint.gd (which
# preloads pose.gd), keeping the dependency direction acyclic.
class ResolvedPathConstraint:
	var name: String
	var bone_indices: PackedInt32Array
	var position_mode: String
	var spacing_mode: String
	var rotate_mode: String
	var offset_rotation: float
	var base_position: float
	var base_spacing: float
	var base_mix_rotate: float
	var base_mix_x: float
	var base_mix_y: float
	var path = null  # PreparedPathGeometry or null
	# The explicit combined-set solve order (ADR-0011 section 2.3), or -1 when this constraint carries none.
	var order: int
	# The names of the skins that SCOPE this constraint (ADR-0011 section 4), or null when unscoped (always
	# active). Captured once at build. PackedStringArray/Array or null.
	var scope_skins = null
	var sampled_position: float
	var sampled_spacing: float
	var sampled_mix_rotate: float
	var sampled_mix_x: float
	var sampled_mix_y: float

	func _init(
		n: String,
		indices: PackedInt32Array,
		pos_mode: String,
		sp_mode: String,
		rot_mode: String,
		off_rotation: float,
		base_pos: float,
		base_sp: float,
		base_mr: float,
		base_mx: float,
		base_my: float,
		the_path,
		the_order: int,
		the_scope_skins = null
	) -> void:
		name = n
		bone_indices = indices
		position_mode = pos_mode
		spacing_mode = sp_mode
		rotate_mode = rot_mode
		offset_rotation = off_rotation
		base_position = base_pos
		base_spacing = base_sp
		base_mix_rotate = base_mr
		base_mix_x = base_mx
		base_mix_y = base_my
		path = the_path
		order = the_order
		scope_skins = the_scope_skins
		sampled_position = base_pos
		sampled_spacing = base_sp
		sampled_mix_rotate = base_mr
		sampled_mix_x = base_mx
		sampled_mix_y = base_my


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
# SLOT_COLOR_STRIDE lanes per slot: the setup two-color DARK tint (ADR-0009 section 4.3), the reset source
# for the keyable dark color. A slot with no setup darkColor keeps (0, 0, 0, 1) here (inert). slot_dark_color
# is the resolved dark tint written by the solve; slot_has_dark_color is 1 for slots that declared one.
var slot_setup_dark_color: PackedFloat64Array
var slot_dark_color: PackedFloat64Array
var slot_has_dark_color: PackedByteArray
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
# The document's path constraints (ADR-0013, PP-B6), resolved in document array order. Solved AFTER all IK
# and all transform constraints by default (ADR-0011 section 2.3). Empty for a rig with none.
var path_constraints: Array
# The explicit combined-set solve schedule (ADR-0009 section 1.3, ADR-0010 section 1, ADR-0011 section 2.3)
# or null when no constraint carries an order. When present it is a dense permutation of [0, N) (N = total
# constraints across all THREE arrays): solve_order[position] is a constraint CODE selecting
# ik_constraints[code] when code < ik_count, transform_constraints[code - ik_count] when ik_count <= code <
# ik_count + transform_count, else path_constraints[code - ik_count - transform_count]. Step 3 walks it in
# position order. Null keeps the exact default (all IK, then all transform, then all path) path. Precomputed
# once at build.
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
	the_transform_constraints: Array,
	the_path_constraints: Array
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
	slot_setup_dark_color = _float_buffer(slot_count * SLOT_COLOR_STRIDE)
	slot_dark_color = _float_buffer(slot_count * SLOT_COLOR_STRIDE)
	slot_has_dark_color = _byte_buffer(slot_count)
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
	path_constraints = the_path_constraints
	solve_order = _build_solve_order(the_ik_constraints, the_transform_constraints, the_path_constraints)


# Precompute the explicit combined-set solve schedule (ADR-0010 section 1, ADR-0011 section 2.3, extended to
# a THIRD range for path constraints). Returns null when no constraint carries an order (the default all-IK,
# then all-transform, then all-path path). When ANY carries one, the format guarantees a dense unique
# permutation of [0, N); this builds the position->code map from that. It is defensive against an unvalidated
# document: a partial, duplicated, gapped, or out-of-range assignment falls back to null (the safe document-
# order default) rather than producing a corrupt schedule.
static func _build_solve_order(ik: Array, transform: Array, path: Array):
	var total := ik.size() + transform.size() + path.size()
	if total == 0:
		return null

	var any_order := false
	for i in range(ik.size()):
		if ik[i].order >= 0:
			any_order = true
	for i in range(transform.size()):
		if transform[i].order >= 0:
			any_order = true
	for i in range(path.size()):
		if path[i].order >= 0:
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
	for k in range(path.size()):
		if not _place_order(codes, total, path[k].order, ik.size() + transform.size() + k):
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
