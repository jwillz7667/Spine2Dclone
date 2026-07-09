extends RefCounted
# Deform (mirrors packages/runtime-core/src/solve/deform.ts and runtimes/unity Deform.cs, ADR-0003
# section 9): solve step 5, AFTER skinning. The per vertex (dx, dy) offsets are ADDED to the POST SKIN
# world space positions: final_i = skinned_i + (dx_i, dy_i). World space, post skin, additive. output may
# alias skinned (each lane is read before its matching write, so in place is safe). output is
# PackedFloat32Array so the sum rounds to single precision exactly as the TS Float32Array does.


static func apply_deform(skinned: PackedFloat32Array, offsets: PackedFloat64Array, output: PackedFloat32Array, count: int) -> void:
	for i in range(count):
		var x := i * 2
		var y := x + 1
		output[x] = skinned[x] + offsets[x]
		output[y] = skinned[y] + offsets[y]
