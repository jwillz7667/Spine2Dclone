extends RefCounted
# On demand world resolution (mirrors packages/runtime-core/src/solve/resolve-world.ts and runtimes/unity
# ResolveWorld.cs). At solve step 3 a constraint needs the would be world matrix of a bone while the
# authoritative forward pass is still step 4. This composes the bone's ancestor chain root to bone using
# the SAME multiply routine as step 4, so the world it produces equals what step 4 will produce.

const Affine = preload("res://core/affine.gd")
const TransformMode = preload("res://core/transform_mode.gd")
const Pose = preload("res://core/pose.gd")

# The deepest ancestor chain the walk will follow. Far beyond any real rig depth.
const MAX_CHAIN_DEPTH := 256

# Solver owned scratch, reused across calls so resolution allocates nothing per call. The solve is single
# threaded and this is never called re entrantly, so static scratch is safe.
static var _chain_stack: PackedInt32Array = PackedInt32Array()
static var _accumulator: PackedFloat64Array = PackedFloat64Array()
static var _product: PackedFloat64Array = PackedFloat64Array()


static func _ensure_scratch() -> void:
	if _chain_stack.size() != MAX_CHAIN_DEPTH:
		_chain_stack.resize(MAX_CHAIN_DEPTH)
	if _accumulator.size() != Affine.MAT2X3_STRIDE:
		_accumulator.resize(Affine.MAT2X3_STRIDE)
	if _product.size() != Affine.MAT2X3_STRIDE:
		_product.resize(Affine.MAT2X3_STRIDE)


# Write bone_index's world matrix into output[out_offset .. out_offset + 5].
static func resolve(pose: Pose, bone_index: int, output: PackedFloat64Array, out_offset: int) -> void:
	_ensure_scratch()
	var parent_indices := pose.parent_indices
	var transform_modes := pose.transform_modes
	var local := pose.local

	var depth := 0
	var cursor := bone_index
	while cursor >= 0:
		_chain_stack[depth] = cursor
		depth += 1
		cursor = parent_indices[cursor]

	Affine.copy_into(_accumulator, 0, local, _chain_stack[depth - 1] * Affine.MAT2X3_STRIDE)
	var k := depth - 2
	while k >= 0:
		var child_index := _chain_stack[k]
		var child_offset := child_index * Affine.MAT2X3_STRIDE
		if transform_modes[child_index] == TransformMode.NORMAL:
			Affine.multiply_into(_product, 0, _accumulator, 0, local, child_offset)
		else:
			TransformMode.world_from_parent_by_mode(
				_product, 0, _accumulator, 0, local, child_offset, transform_modes[child_index]
			)
		Affine.copy_into(_accumulator, 0, _product, 0)
		k -= 1

	Affine.copy_into(output, out_offset, _accumulator, 0)


# The world matrix of the bone as a fresh matrix value, for the value style call sites.
static func resolve_mat(pose: Pose, bone_index: int) -> PackedFloat64Array:
	var m := PackedFloat64Array()
	m.resize(Affine.MAT2X3_STRIDE)
	resolve(pose, bone_index, m, 0)
	return m


# The world matrix of a bone's PARENT, or identity for a root.
static func parent_world_mat(pose: Pose, bone_index: int) -> PackedFloat64Array:
	var parent := pose.parent_indices[bone_index]
	if parent < 0:
		return Affine.identity()
	return resolve_mat(pose, parent)


static func local_mat(pose: Pose, bone_index: int) -> PackedFloat64Array:
	return Affine.read(pose.local, bone_index * Affine.MAT2X3_STRIDE)


static func write_local_mat(pose: Pose, bone_index: int, m: PackedFloat64Array) -> void:
	Affine.write(pose.local, bone_index * Affine.MAT2X3_STRIDE, m)
