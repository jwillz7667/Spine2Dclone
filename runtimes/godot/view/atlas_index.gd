extends RefCounted
# Resolves an attachment path (== AtlasRegion.name) to its page and pixel window, and maps a logical
# attachment UV in [0, 1] over the region's texture window into a page-normalized UV (mirrors runtimes/unity
# AtlasIndex.cs and the render-preview RegionSampler mapping). A region packed rotated 90 degrees clockwise
# samples through the turned window, so every runtime maps identically. Pure (no Node, no file IO): built
# once from the document atlas and reused per frame. UVs are TOP-LEFT origin (the atlas pixel convention); a
# host whose texture origin is bottom-left flips v when uploading.

const RenderModel = preload("res://view/render_model.gd")

var _by_name: Dictionary = {}  # region name -> { "region": AtlasRegion, "page": AtlasPage }


func _init(atlas: RenderModel.AtlasData) -> void:
	for page in atlas.pages:
		for region in page.regions:
			# Region names are unique across pages (ATLAS_REGION_DUPLICATE); a duplicate is rejected upstream.
			_by_name[region.name] = {"region": region, "page": page}


# Whether the atlas resolves the given region name. False means the renderer draws an untextured (white) quad.
func has_region(path: String) -> bool:
	return _by_name.has(path)


# The page image file the region lives on, or null when absent. Drawables sharing a page file (and blend
# mode) batch into one draw call.
func page_file(path: String):
	if not _by_name.has(path):
		return null
	return _by_name[path].page.file


# The atlas trim of a region as a Dictionary(offset_x, offset_y, w, h, original_w, original_h), or null when
# the region is absent (then placement uses the full centered quad).
func trim(path: String):
	if not _by_name.has(path):
		return null
	var r: RenderModel.AtlasRegion = _by_name[path].region
	return {
		"offset_x": r.offset_x,
		"offset_y": r.offset_y,
		"w": r.w,
		"h": r.h,
		"original_w": r.original_w,
		"original_h": r.original_h,
	}


# Map a logical attachment UV (u, v) in [0, 1] over the region window into a page-normalized UV (Vector2,
# top-left origin). When the region is absent the identity (u, v) is returned (the white fallback still
# carries sane UVs). The rotated mapping mirrors RegionSampler: logical (u, v) maps to stored (1 - v, u) for
# a region packed 90 degrees clockwise; unrotated is the identity.
func map_uv(path: String, u: float, v: float) -> Vector2:
	if not _by_name.has(path):
		return Vector2(u, v)
	var r: RenderModel.AtlasRegion = _by_name[path].region
	var page: RenderModel.AtlasPage = _by_name[path].page
	var stored_w := r.h if r.rotated else r.w
	var stored_h := r.w if r.rotated else r.h
	var su := (1.0 - v) if r.rotated else u
	var sv := u if r.rotated else v
	var px := r.x + (su * stored_w)
	var py := r.y + (sv * stored_h)
	return Vector2(px / page.width, py / page.height)
