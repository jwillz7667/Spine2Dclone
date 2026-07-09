extends RefCounted
# Skinning (mirrors packages/runtime-core/src/solve/skin.ts and runtimes/unity Skin.cs, ADR-0003 section
# 9): solve step 5, before deform. Both paths write (x, y) world space pairs into a caller provided
# PackedFloat32Array and allocate nothing. The output is float32 to mirror the TS Float32Array exactly:
# storing a double into a PackedFloat32Array rounds it to single precision, so the committed fixtures
# (generated from a Float32Array) match to their stored precision.

const Affine = preload("res://core/affine.gd")


# Weighted mesh skinning: for each logical vertex,
#   pos = sum over influences of weight * (boneWorldMatrix[boneIndex] * (vx, vy)),
# accumulated in STORED influence order (the accumulation order is part of the numerical contract).
static func solve_skin(mesh, bone_world_matrices: PackedFloat64Array, output: PackedFloat32Array) -> void:
	var stream: PackedFloat64Array = mesh.vertices
	var length := stream.size()
	var cursor := 0
	var out_index := 0
	while cursor < length:
		var influence_count := int(stream[cursor])
		cursor += 1
		var px := 0.0
		var py := 0.0
		for i in range(influence_count):
			var bone_offset := int(stream[cursor]) * Affine.MAT2X3_STRIDE
			var vx := stream[cursor + 1]
			var vy := stream[cursor + 2]
			var weight := stream[cursor + 3]
			cursor += 4
			var a := bone_world_matrices[bone_offset]
			var b := bone_world_matrices[bone_offset + 1]
			var c := bone_world_matrices[bone_offset + 2]
			var d := bone_world_matrices[bone_offset + 3]
			var tx := bone_world_matrices[bone_offset + 4]
			var ty := bone_world_matrices[bone_offset + 5]
			px += weight * ((a * vx) + (c * vy) + tx)
			py += weight * ((b * vx) + (d * vy) + ty)
		output[out_index] = px
		output[out_index + 1] = py
		out_index += 2


# Unweighted mesh fast path: vertices is a flat [x0, y0, ...] stream of setup space positions rigidly
# attached to the slot's bone, so pos = slotBoneWorld * (x, y).
static func solve_skin_unweighted(mesh, slot_bone_world: PackedFloat64Array, output: PackedFloat32Array) -> void:
	var stream: PackedFloat64Array = mesh.vertices
	var length := stream.size()
	var a := slot_bone_world[0]
	var b := slot_bone_world[1]
	var c := slot_bone_world[2]
	var d := slot_bone_world[3]
	var tx := slot_bone_world[4]
	var ty := slot_bone_world[5]
	var i := 0
	while i < length:
		var x := stream[i]
		var y := stream[i + 1]
		output[i] = (a * x) + (c * y) + tx
		output[i + 1] = (b * x) + (d * y) + ty
		i += 2
