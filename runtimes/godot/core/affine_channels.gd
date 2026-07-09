extends RefCounted
# Canonical 2D affine world channel decomposition and recomposition (mirrors
# packages/runtime-core/src/solve/affine-channels.ts and runtimes/unity AffineChannels.cs). This is the
# channel model transform constraints blend in: read world, blend per channel in world, write local.
# Angles are kept in DEGREES at this boundary to match Affine.compose and the format's stored fields.

const Scalar = preload("res://core/scalar.gd")

# One world matrix decomposed into rotation (deg), translation, scaleX/scaleY, shearY (deg).
class WorldChannels:
	var rotation: float
	var x: float
	var y: float
	var scale_x: float
	var scale_y: float
	var shear_y: float


static func decompose_world(m: PackedFloat64Array) -> WorldChannels:
	# The X' column is (a, c), the Y' column is (b, d). In our column vector layout that maps to
	# a = m[0], c = m[1] (X column), b = m[2], d = m[3] (Y column), NOT the literal lane order.
	var a := m[0]
	var c := m[1]
	var b := m[2]
	var d := m[3]
	var rotation := atan2(c, a)
	var scale_x := sqrt((a * a) + (c * c))
	var det := (a * d) - (b * c)
	var scale_y := det / scale_x
	var shear_y := atan2((a * b) + (c * d), det)
	var out := WorldChannels.new()
	out.rotation = rotation * Scalar.RAD_TO_DEG
	out.x = m[4]
	out.y = m[5]
	out.scale_x = scale_x
	out.scale_y = scale_y
	out.shear_y = shear_y * Scalar.RAD_TO_DEG
	return out


static func compose_world(channels: WorldChannels) -> PackedFloat64Array:
	var rotation := channels.rotation * Scalar.DEG_TO_RAD
	var shear_y := channels.shear_y * Scalar.DEG_TO_RAD
	var cos_r := cos(rotation)
	var sin_r := sin(rotation)
	var tan_shear_y := tan(shear_y)
	var scale_x := channels.scale_x
	var scale_y := channels.scale_y
	return PackedFloat64Array([
		scale_x * cos_r,
		scale_x * sin_r,
		scale_y * ((tan_shear_y * cos_r) - sin_r),
		scale_y * ((tan_shear_y * sin_r) + cos_r),
		channels.x,
		channels.y,
	])
