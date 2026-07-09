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
	var sampled_mix: float
	var sampled_bend_positive: bool

	func _init(n: String, indices: PackedInt32Array, target: int, mix: float, bend: bool) -> void:
		name = n
		bone_indices = indices
		target_index = target
		base_mix = mix
		base_bend_positive = bend
		sampled_mix = mix
		sampled_bend_positive = bend


# A transform constraint resolved against the pose.
class ResolvedTransformConstraint:
	var name: String
	var bone_indices: PackedInt32Array
	var target_index: int
	var base_mix: TransformMix
	var offset: TransformOffset
	var sampled_mix: TransformMix

	func _init(n: String, indices: PackedInt32Array, target: int, mix: TransformMix, off: TransformOffset) -> void:
		name = n
		bone_indices = indices
		target_index = target
		base_mix = mix
		offset = off
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
var slot_setup_attachment: Array
var slot_attachment: Array

var ik_constraints: Array
var transform_constraints: Array

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
	slot_setup_attachment = []
	slot_setup_attachment.resize(slot_count)
	slot_attachment = []
	slot_attachment.resize(slot_count)

	ik_constraints = the_ik_constraints
	transform_constraints = the_transform_constraints


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
