extends RefCounted
# Region-quad world geometry (mirrors runtimes/unity RegionGeometry.cs and render-preview geometry.ts). The
# world quad is texture-size-independent by construction: bone_world * (attachment_local * scale(width,
# height)) applied to a unit-centered quad. A trimmed region's quad is offset so a trimmed texture lands
# where the untrimmed original would. Same bone world times the same sized-local matrix in every runtime.

const Affine = preload("res://core/affine.gd")
const RenderModel = preload("res://view/render_model.gd")

# The four unit-centered corners, in the order that pairs with QUAD_UVS [0,0, 1,0, 1,1, 0,1]: top-left,
# top-right, bottom-right, bottom-left. Triangulated as [0, 1, 2, 0, 2, 3].
const UNIT_CORNERS_X := [-0.5, 0.5, 0.5, -0.5]
const UNIT_CORNERS_Y := [-0.5, -0.5, 0.5, 0.5]

# The region UVs matching the four corners (normalized over the region window).
const QUAD_UVS := [0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0]

# The region quad's two triangles (indices into the four corners).
const QUAD_TRIANGLES := [0, 1, 2, 0, 2, 3]


# attachment_local * scale(width, height): the constant part of a region's placement (verbatim
# render-preview regionSizedLocal). The size scale is innermost so the unit quad becomes a width-by-height
# quad in attachment-local axes BEFORE the attachment offset and the bone world transform apply.
static func region_sized_local(region: RenderModel.RenderRegion) -> PackedFloat64Array:
	var attachment_local := Affine.compose(region.x, region.y, region.rotation, region.scale_x, region.scale_y, 0.0, 0.0)
	var size := PackedFloat64Array([region.width, 0.0, 0.0, region.height, 0.0, 0.0])
	return Affine.multiply(attachment_local, size)


# Write the four world-space corners of a region attachment into output (8 lanes, x/y per corner in the
# QUAD_UVS order): transform the (trim-adjusted) unit-quad corners by bone_world * region_sized_local. trim
# (a Dictionary from AtlasIndex.trim, or null) offsets the quad so a trimmed texture lands where the
# untrimmed original would; null yields the full centered quad EXACTLY (integer 0/original and
# original/original fall on +/- 0.5 with no drift). output must hold >= 8 lanes.
static func region_world_corners(bone_world: PackedFloat64Array, region: RenderModel.RenderRegion, trim, output: PackedFloat64Array) -> void:
	var world := Affine.multiply(bone_world, region_sized_local(region))
	var a := world[0]
	var b := world[1]
	var c := world[2]
	var d := world[3]
	var tx := world[4]
	var ty := world[5]
	for corner in range(4):
		var cx: float = UNIT_CORNERS_X[corner]
		var cy: float = UNIT_CORNERS_Y[corner]
		if trim != null:
			var left: float = -0.5 + (trim.offset_x / trim.original_w)
			var right: float = -0.5 + ((trim.offset_x + trim.w) / trim.original_w)
			var top: float = -0.5 + (trim.offset_y / trim.original_h)
			var bottom: float = -0.5 + ((trim.offset_y + trim.h) / trim.original_h)
			cx = left if (corner == 0 or corner == 3) else right
			cy = top if (corner == 0 or corner == 1) else bottom
		output[corner * 2] = (a * cx) + (c * cy) + tx
		output[(corner * 2) + 1] = (b * cx) + (d * cy) + ty
