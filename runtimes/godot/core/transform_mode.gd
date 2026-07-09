extends RefCounted
# Bone transformMode inheritance (mirrors packages/runtime-core/src/skeleton/transform-mode.ts and
# runtimes/unity TransformMode.cs). transformMode controls HOW a bone inherits its parent's WORLD
# transform at solve step 4. normal is full inheritance; the other four selectively suppress part of the
# parent's rotation, scale, or reflection. These semantics are our own first principles contract (LAW 4).
# rig-transform-modes exercises every branch below under a rotated, non uniformly scaled, reflected
# animated parent.

const Affine = preload("res://core/affine.gd")

const NORMAL := 0
const ONLY_TRANSLATION := 1
const NO_ROTATION_OR_REFLECTION := 2
const NO_SCALE := 3
const NO_SCALE_OR_REFLECTION := 4


static func from_name(mode_name: String) -> int:
	match mode_name:
		"normal":
			return NORMAL
		"onlyTranslation":
			return ONLY_TRANSLATION
		"noRotationOrReflection":
			return NO_ROTATION_OR_REFLECTION
		"noScale":
			return NO_SCALE
		"noScaleOrReflection":
			return NO_SCALE_OR_REFLECTION
		_:
			push_error("unknown transformMode '%s'" % mode_name)
			return NORMAL


# Write a child bone's world matrix from its parent's world slice and its own local slice, honoring
# mode. For NORMAL this is byte identical to Affine.multiply_into.
static func world_from_parent_by_mode(
	world: PackedFloat64Array,
	world_offset: int,
	parent_world: PackedFloat64Array,
	parent_offset: int,
	local: PackedFloat64Array,
	local_offset: int,
	mode: int
) -> void:
	var pa := parent_world[parent_offset]
	var pb := parent_world[parent_offset + 1]
	var pc := parent_world[parent_offset + 2]
	var pd := parent_world[parent_offset + 3]
	var ptx := parent_world[parent_offset + 4]
	var pty := parent_world[parent_offset + 5]
	var la := local[local_offset]
	var lb := local[local_offset + 1]
	var lc := local[local_offset + 2]
	var ld := local[local_offset + 3]
	var lx := local[local_offset + 4]
	var ly := local[local_offset + 5]

	var ea: float
	var eb: float
	var ec: float
	var ed: float
	var wtx: float
	var wty: float

	if mode == ONLY_TRANSLATION:
		ea = 1.0
		eb = 0.0
		ec = 0.0
		ed = 1.0
		wtx = ptx + lx
		wty = pty + ly
	else:
		wtx = (pa * lx) + (pc * ly) + ptx
		wty = (pb * lx) + (pd * ly) + pty
		if mode == NORMAL:
			ea = pa
			eb = pb
			ec = pc
			ed = pd
		elif mode == NO_ROTATION_OR_REFLECTION:
			ea = Affine.hypot(pa, pb)
			eb = 0.0
			ec = 0.0
			ed = Affine.hypot(pc, pd)
		else:
			var psx := Affine.hypot(pa, pb)
			var psy := Affine.hypot(pc, pd)
			var ix := 0.0 if psx == 0.0 else 1.0 / psx
			var iy := 0.0 if psy == 0.0 else 1.0 / psy
			ea = pa * ix
			eb = pb * ix
			ec = pc * iy
			ed = pd * iy
			if mode == NO_SCALE_OR_REFLECTION and ((ea * ed) - (eb * ec)) < 0.0:
				ec = -eb
				ed = ea

	world[world_offset] = (ea * la) + (ec * lb)
	world[world_offset + 1] = (eb * la) + (ed * lb)
	world[world_offset + 2] = (ea * lc) + (ec * ld)
	world[world_offset + 3] = (eb * lc) + (ed * ld)
	world[world_offset + 4] = wtx
	world[world_offset + 5] = wty
