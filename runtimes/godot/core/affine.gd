extends RefCounted
# A 2x3 affine denoting the matrix
#
#     [ a  c  tx ]
#     [ b  d  ty ]
#     [ 0  0  1  ]
#
# in column vector form, so transform_point(m, x, y) = (a*x + c*y + tx, b*x + d*y + ty). This is the
# exact cross runtime layout of packages/runtime-core/src/math/affine.ts (a readonly tuple there) and
# runtimes/unity Affine.cs. A "matrix value" is a PackedFloat64Array of six lanes [a, b, c, d, tx, ty];
# packed storage holds many matrices back to back at MAT2X3_STRIDE lane offsets. World composition is
# child.world = parent.world * child.local, and a bone's local matrix is Translate * Rotate * Shear *
# Scale. All math is f64 (GDScript float is a double), the same width the TS oracle solves in.

const MAT2X3_STRIDE := 6

const DEG_TO_RAD := PI / 180.0
const RAD_TO_DEG := 180.0 / PI

# A 2x3 affine decomposed into the bone transform compose() rebuilds EXACTLY (degrees for the angles).
# The TRS plus shear parameterization has one redundant degree of freedom, resolved by shear_y_deg = 0.
class Decomposed:
	var x: float
	var y: float
	var rotation_deg: float
	var scale_x: float
	var scale_y: float
	var shear_x_deg: float
	var shear_y_deg: float


static func identity() -> PackedFloat64Array:
	return PackedFloat64Array([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])


# The product parent * child (apply child first, then parent). The world composition op. Returns a fresh
# matrix value; neither operand is mutated.
static func multiply(parent: PackedFloat64Array, child: PackedFloat64Array) -> PackedFloat64Array:
	var pa := parent[0]
	var pb := parent[1]
	var pc := parent[2]
	var pd := parent[3]
	var ptx := parent[4]
	var pty := parent[5]
	var ca := child[0]
	var cb := child[1]
	var cc := child[2]
	var cd := child[3]
	var ctx := child[4]
	var cty := child[5]
	return PackedFloat64Array([
		(pa * ca) + (pc * cb),
		(pb * ca) + (pd * cb),
		(pa * cc) + (pc * cd),
		(pb * cc) + (pd * cd),
		(pa * ctx) + (pc * cty) + ptx,
		(pb * ctx) + (pd * cty) + pty,
	])


# Build a local matrix from a bone's setup transform: Translate * Rotate * Shear * Scale.
static func compose(
	x: float,
	y: float,
	rotation_deg: float,
	scale_x: float,
	scale_y: float,
	shear_x_deg: float,
	shear_y_deg: float
) -> PackedFloat64Array:
	var rotation := rotation_deg * DEG_TO_RAD
	var cos_r := cos(rotation)
	var sin_r := sin(rotation)
	var tan_shear_x := tan(shear_x_deg * DEG_TO_RAD)
	var tan_shear_y := tan(shear_y_deg * DEG_TO_RAD)
	return PackedFloat64Array([
		(cos_r - (sin_r * tan_shear_y)) * scale_x,
		(sin_r + (cos_r * tan_shear_y)) * scale_x,
		((cos_r * tan_shear_x) - sin_r) * scale_y,
		((sin_r * tan_shear_x) + cos_r) * scale_y,
		x,
		y,
	])


# The inverse affine. Defined when the determinant a*d - b*c is non zero.
static func invert(m: PackedFloat64Array) -> PackedFloat64Array:
	var a := m[0]
	var b := m[1]
	var c := m[2]
	var d := m[3]
	var tx := m[4]
	var ty := m[5]
	var det := (a * d) - (b * c)
	var inverse_det := 1.0 / det
	var ia := d * inverse_det
	var ib := -b * inverse_det
	var ic := -c * inverse_det
	var id := a * inverse_det
	return PackedFloat64Array([
		ia,
		ib,
		ic,
		id,
		-((ia * tx) + (ic * ty)),
		-((ib * tx) + (id * ty)),
	])


# Decompose a 2x3 affine into the bone transform compose() rebuilds EXACTLY, resolving the redundant
# degree of freedom by the convention shear_y = 0.
static func decompose(m: PackedFloat64Array) -> Decomposed:
	var a := m[0]
	var b := m[1]
	var c := m[2]
	var d := m[3]
	var scale_x := hypot(a, b)
	var x_axis_angle := atan2(b, a)
	var y_axis_angle := atan2(d, c)
	var shear_x := x_axis_angle + (PI / 2.0) - y_axis_angle
	var scale_y := hypot(c, d) * cos(shear_x)
	var out := Decomposed.new()
	out.x = m[4]
	out.y = m[5]
	out.rotation_deg = x_axis_angle * RAD_TO_DEG
	out.scale_x = scale_x
	out.scale_y = scale_y
	out.shear_x_deg = shear_x * RAD_TO_DEG
	out.shear_y_deg = 0.0
	return out


# sqrt(a*a + b*b). The TS oracle calls Math.hypot; over rig magnitudes the difference from this form is
# far below the A.5 tolerance band (the Unity C# port uses the same form and passes), so this is the
# faithful, portable equivalent.
static func hypot(a: float, b: float) -> float:
	return sqrt((a * a) + (b * b))


# Allocation light hot path operations on packed PackedFloat64Array storage. PackedFloat64Array is passed
# by reference and mutated in place, so these write through to the caller's buffer. Offsets address the
# first lane of a matrix; callers pass in bounds offsets.

# Write Translate * Rotate * Shear * Scale into buffer[offset .. offset + 5]. Mirrors compose().
static func compose_into(
	buffer: PackedFloat64Array,
	offset: int,
	x: float,
	y: float,
	rotation_deg: float,
	scale_x: float,
	scale_y: float,
	shear_x_deg: float,
	shear_y_deg: float
) -> void:
	var rotation := rotation_deg * DEG_TO_RAD
	var cos_r := cos(rotation)
	var sin_r := sin(rotation)
	var tan_shear_x := tan(shear_x_deg * DEG_TO_RAD)
	var tan_shear_y := tan(shear_y_deg * DEG_TO_RAD)
	buffer[offset] = (cos_r - (sin_r * tan_shear_y)) * scale_x
	buffer[offset + 1] = (sin_r + (cos_r * tan_shear_y)) * scale_x
	buffer[offset + 2] = ((cos_r * tan_shear_x) - sin_r) * scale_y
	buffer[offset + 3] = ((sin_r * tan_shear_x) + cos_r) * scale_y
	buffer[offset + 4] = x
	buffer[offset + 5] = y


# Write parent * child into out_buffer[out_offset ..]. out_buffer must alias neither operand slice.
static func multiply_into(
	out_buffer: PackedFloat64Array,
	out_offset: int,
	parent: PackedFloat64Array,
	parent_offset: int,
	child: PackedFloat64Array,
	child_offset: int
) -> void:
	var pa := parent[parent_offset]
	var pb := parent[parent_offset + 1]
	var pc := parent[parent_offset + 2]
	var pd := parent[parent_offset + 3]
	var ptx := parent[parent_offset + 4]
	var pty := parent[parent_offset + 5]
	var ca := child[child_offset]
	var cb := child[child_offset + 1]
	var cc := child[child_offset + 2]
	var cd := child[child_offset + 3]
	var ctx := child[child_offset + 4]
	var cty := child[child_offset + 5]
	out_buffer[out_offset] = (pa * ca) + (pc * cb)
	out_buffer[out_offset + 1] = (pb * ca) + (pd * cb)
	out_buffer[out_offset + 2] = (pa * cc) + (pc * cd)
	out_buffer[out_offset + 3] = (pb * cc) + (pd * cd)
	out_buffer[out_offset + 4] = (pa * ctx) + (pc * cty) + ptx
	out_buffer[out_offset + 5] = (pb * ctx) + (pd * cty) + pty


# Copy one matrix slice from src[src_offset ..] into out_buffer[out_offset ..] without allocating.
static func copy_into(
	out_buffer: PackedFloat64Array,
	out_offset: int,
	src: PackedFloat64Array,
	src_offset: int
) -> void:
	out_buffer[out_offset] = src[src_offset]
	out_buffer[out_offset + 1] = src[src_offset + 1]
	out_buffer[out_offset + 2] = src[src_offset + 2]
	out_buffer[out_offset + 3] = src[src_offset + 3]
	out_buffer[out_offset + 4] = src[src_offset + 4]
	out_buffer[out_offset + 5] = src[src_offset + 5]


# Read a matrix slice out of packed storage as a fresh matrix value (for the value style call sites).
static func read(buffer: PackedFloat64Array, offset: int) -> PackedFloat64Array:
	return PackedFloat64Array([
		buffer[offset],
		buffer[offset + 1],
		buffer[offset + 2],
		buffer[offset + 3],
		buffer[offset + 4],
		buffer[offset + 5],
	])


# Write a matrix value into packed storage.
static func write(buffer: PackedFloat64Array, offset: int, m: PackedFloat64Array) -> void:
	buffer[offset] = m[0]
	buffer[offset + 1] = m[1]
	buffer[offset + 2] = m[2]
	buffer[offset + 3] = m[3]
	buffer[offset + 4] = m[4]
	buffer[offset + 5] = m[5]
