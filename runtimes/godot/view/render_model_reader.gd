extends RefCounted
# Builds the RENDER-only projection (skins' region/mesh/linkedmesh attachments plus the atlas) from a format
# document's JSON (mirrors runtimes/unity RenderModelReader.cs). It reads ONLY the render fields the solve
# reader (core/rig_reader.gd) skips; the solve inputs come from that reader in parallel. It follows the same
# fail-loud pattern: a violation returns a RenderModelReadError carrying the first offending member, so a
# malformed render document fails on import (Law 3, applied to the render boundary) rather than at draw time.

const RenderModel = preload("res://view/render_model.gd")


class RenderModelReadError:
	var message: String

	func _init(m: String) -> void:
		message = m


static var _error: String = ""


static func _fail(message: String) -> void:
	if _error == "":
		_error = message


# Parse format JSON text into a RenderModel, or a RenderModelReadError on any render-field violation.
static func parse(json_text: String):
	_error = ""
	var root = JSON.parse_string(json_text)
	if root == null or typeof(root) != TYPE_DICTIONARY:
		return RenderModelReadError.new("document is not a JSON object")

	var model := _read(root)
	if _error != "":
		return RenderModelReadError.new(_error)
	return model


static func _read(root: Dictionary) -> RenderModel.RenderModel:
	var model := RenderModel.RenderModel.new()

	var skins = root.get("skins")
	if typeof(skins) == TYPE_ARRAY:
		for skin in skins:
			var render_skin := _read_skin(skin)
			if render_skin != null:
				model.skins[render_skin.name] = render_skin

	model.atlas = _read_atlas(root.get("atlas"))
	return model


static func _read_skin(skin) -> RenderModel.RenderSkin:
	if typeof(skin) != TYPE_DICTIONARY:
		_fail("skin is not an object")
		return null

	var render_skin := RenderModel.RenderSkin.new()
	render_skin.name = _req_string(skin, "name")
	var attachments = skin.get("attachments")
	if typeof(attachments) != TYPE_DICTIONARY:
		_fail("skin 'attachments' must be an object")
		return render_skin

	for slot_name in attachments:
		var per_slot: Dictionary = {}
		var by_slot: Dictionary = attachments[slot_name]
		for attachment_name in by_slot:
			per_slot[attachment_name] = _read_attachment(by_slot[attachment_name])
		render_skin.slots[slot_name] = per_slot

	return render_skin


static func _read_attachment(attachment) -> RenderModel.RenderAttachment:
	var result := RenderModel.RenderAttachment.new()
	if typeof(attachment) != TYPE_DICTIONARY:
		_fail("attachment is not an object")
		result.kind = RenderModel.KIND_NON_DRAWING
		return result

	var type := _req_string(attachment, "type")
	match type:
		"region":
			result.kind = RenderModel.KIND_REGION
			var region := RenderModel.RenderRegion.new()
			region.path = _req_string(attachment, "path")
			region.x = _req_number(attachment, "x")
			region.y = _req_number(attachment, "y")
			region.rotation = _req_number(attachment, "rotation")
			region.scale_x = _req_number(attachment, "scaleX")
			region.scale_y = _req_number(attachment, "scaleY")
			region.width = _req_number(attachment, "width")
			region.height = _req_number(attachment, "height")
			region.color = _read_color(attachment.get("color"))
			result.region = region
			result.sequence = _read_sequence(attachment)
		"mesh":
			result.kind = RenderModel.KIND_MESH
			var mesh := RenderModel.RenderMesh.new()
			mesh.path = _req_string(attachment, "path")
			mesh.uvs = _req_number_array(attachment, "uvs")
			mesh.triangles = _req_int_array(attachment, "triangles")
			mesh.color = _read_color(attachment.get("color"))
			result.mesh = mesh
			result.sequence = _read_sequence(attachment)
		"linkedmesh":
			result.kind = RenderModel.KIND_LINKED
			var linked := RenderModel.RenderLinkedMesh.new()
			linked.path = _req_string(attachment, "path")
			linked.parent = _req_string(attachment, "parent")
			var skin_value = attachment.get("skin")
			linked.skin = skin_value if typeof(skin_value) == TYPE_STRING else null
			linked.color = _read_color(attachment.get("color"))
			result.linked_mesh = linked
		_:
			result.kind = RenderModel.KIND_NON_DRAWING

	return result


static func _read_sequence(attachment: Dictionary):
	var sequence = attachment.get("sequence")
	if typeof(sequence) != TYPE_DICTIONARY:
		return null

	var result := RenderModel.RenderSequence.new()
	result.count = int(_req_number(sequence, "count"))
	result.setup_index = int(_req_number(sequence, "setupIndex"))
	result.start = int(_req_number(sequence, "start"))
	result.digits = int(_req_number(sequence, "digits"))
	return result


static func _read_atlas(atlas) -> RenderModel.AtlasData:
	var result := RenderModel.AtlasData.new()
	if typeof(atlas) != TYPE_DICTIONARY:
		return result

	var pages = atlas.get("pages")
	if typeof(pages) != TYPE_ARRAY:
		return result

	for page in pages:
		var render_page := RenderModel.AtlasPage.new()
		render_page.file = _req_string(page, "file")
		render_page.width = _req_number(page, "width")
		render_page.height = _req_number(page, "height")
		var regions = page.get("regions")
		if typeof(regions) == TYPE_ARRAY:
			for region in regions:
				var render_region := RenderModel.AtlasRegion.new()
				render_region.name = _req_string(region, "name")
				render_region.x = _req_number(region, "x")
				render_region.y = _req_number(region, "y")
				render_region.w = _req_number(region, "w")
				render_region.h = _req_number(region, "h")
				render_region.rotated = _req_bool(region, "rotated")
				render_region.offset_x = _req_number(region, "offsetX")
				render_region.offset_y = _req_number(region, "offsetY")
				render_region.original_w = _req_number(region, "originalW")
				render_region.original_h = _req_number(region, "originalH")
				render_page.regions.append(render_region)
		result.pages.append(render_page)

	return result


static func _read_color(color) -> Color:
	if typeof(color) != TYPE_DICTIONARY:
		return Color(1, 1, 1, 1)
	return Color(
		_req_number(color, "r"),
		_req_number(color, "g"),
		_req_number(color, "b"),
		_req_number(color, "a"))


static func _req_string(obj: Dictionary, key: String) -> String:
	var value = obj.get(key)
	if typeof(value) != TYPE_STRING:
		_fail("member '%s' must be a string" % key)
		return ""
	return value


static func _req_number(obj: Dictionary, key: String) -> float:
	var value = obj.get(key)
	if typeof(value) != TYPE_FLOAT and typeof(value) != TYPE_INT:
		_fail("member '%s' must be a number" % key)
		return 0.0
	return float(value)


static func _req_bool(obj: Dictionary, key: String) -> bool:
	var value = obj.get(key)
	if typeof(value) != TYPE_BOOL:
		_fail("member '%s' must be a boolean" % key)
		return false
	return value


static func _req_number_array(obj: Dictionary, key: String) -> PackedFloat64Array:
	var value = obj.get(key)
	var result := PackedFloat64Array()
	if typeof(value) != TYPE_ARRAY:
		_fail("member '%s' must be an array" % key)
		return result
	for item in value:
		result.append(float(item))
	return result


static func _req_int_array(obj: Dictionary, key: String) -> PackedInt32Array:
	var value = obj.get(key)
	var result := PackedInt32Array()
	if typeof(value) != TYPE_ARRAY:
		_fail("member '%s' must be an array" % key)
		return result
	for item in value:
		result.append(int(item))
	return result
