extends RefCounted
# A MINIMAL strict reader for the fields the nine committed conformance rigs use (mirrors runtimes/unity
# RigReader.cs). It is NOT a general format validator (that boundary is the TS format package's job); the
# committed rigs are already validated there before they are committed. Godot's JSON parser preserves
# object member insertion order, so the ordered maps (skin attachments, animation channels, deform
# triples) iterate exactly as the TS solve's Object.keys() order.
#
# Format compatibility (PP-E2 contract): the reader accepts every formatVersion of MAJOR 0 (0.2.0 through
# 0.4.0). The additive revisions are 0.3.0 (document events, animation drawOrder/events, optional metadata)
# and 0.4.0 (ADR-0009: IK constraints carry a signed `bend` in place of the bendPositive boolean plus
# additive depth fields, transform constraints gain local/relative, and linked meshes / sequences / split
# timelines / skin scoping are additive). It REQUIRES every field the solve consumes, reads the signed bend
# (mapping it to the same sign the solve keys on), and PERMITS unknown/additive members, so a 0.4.0 rig
# reads unchanged. It FAILS LOUDLY on a missing required field, a wrong type for a consumed field, or an
# unsupported format major. A parse failure returns a RigReadError carrying the first offending member.

const Document = preload("res://core/document.gd")

const SUPPORTED_FORMAT_MAJOR := 0


class RigReadError:
	var message: String

	func _init(m: String) -> void:
		message = m


static var _error: String = ""


static func _fail(message: String) -> void:
	if _error == "":
		_error = message


# Parse rig JSON text into a SkeletonDocument, or a RigReadError on any schema violation.
static func parse(json_text: String):
	_error = ""
	var root = JSON.parse_string(json_text)
	if root == null or typeof(root) != TYPE_DICTIONARY:
		return RigReadError.new("rig is not a JSON object")

	_check_format_version(root)
	var document := _read_document(root)
	if _error != "":
		return RigReadError.new(_error)
	return document


static func _check_format_version(root: Dictionary) -> void:
	var fv = root.get("formatVersion")
	if fv == null or typeof(fv) != TYPE_STRING:
		_fail("missing required string 'formatVersion'")
		return
	var parts: PackedStringArray = fv.split(".")
	if parts.size() == 0 or not parts[0].is_valid_int():
		_fail("malformed formatVersion '%s'" % fv)
		return
	var major := int(parts[0])
	if major != SUPPORTED_FORMAT_MAJOR:
		_fail("unsupported formatVersion major %d (expected %d) from '%s'" % [major, SUPPORTED_FORMAT_MAJOR, fv])


static func _read_document(root: Dictionary) -> Document.SkeletonDocument:
	var document := Document.SkeletonDocument.new()

	for bone in _req_array(root, "bones"):
		document.bones.append(_read_bone(bone))

	var slots_value = root.get("slots")
	if slots_value != null and typeof(slots_value) == TYPE_ARRAY:
		for slot in slots_value:
			document.slots.append(_read_slot(slot))

	var skins_value = root.get("skins")
	if skins_value != null and typeof(skins_value) == TYPE_ARRAY:
		for skin in skins_value:
			document.skins.append(_read_skin(skin))

	var ik_value = root.get("ikConstraints")
	if ik_value != null and typeof(ik_value) == TYPE_ARRAY:
		for ik in ik_value:
			document.ik_constraints.append(_read_ik_constraint(ik))

	var tc_value = root.get("transformConstraints")
	if tc_value != null and typeof(tc_value) == TYPE_ARRAY:
		for tc in tc_value:
			document.transform_constraints.append(_read_transform_constraint(tc))

	var events_value = root.get("events")
	if events_value != null and typeof(events_value) == TYPE_ARRAY:
		for ev in events_value:
			var def := Document.EventDef.new()
			def.name = _req_string(ev, "name")
			def.int_value = _opt_int(ev, "int")
			def.float_value = _opt_number(ev, "float")
			def.string_value = _opt_string(ev, "string")
			document.events.append(def)

	var animations_value = _req_object(root, "animations")
	for anim_id in animations_value:
		document.animations[anim_id] = _read_animation(animations_value[anim_id])

	return document


static func _read_bone(bone: Dictionary) -> Document.Bone:
	var b := Document.Bone.new()
	b.name = _req_string(bone, "name")
	var parent = bone.get("parent")
	b.parent = null if parent == null else str(parent)
	b.length = _req_number(bone, "length")
	b.x = _req_number(bone, "x")
	b.y = _req_number(bone, "y")
	b.rotation = _req_number(bone, "rotation")
	b.scale_x = _req_number(bone, "scaleX")
	b.scale_y = _req_number(bone, "scaleY")
	b.shear_x = _req_number(bone, "shearX")
	b.shear_y = _req_number(bone, "shearY")
	b.transform_mode = _req_string(bone, "transformMode")
	return b


static func _read_slot(slot: Dictionary) -> Document.Slot:
	var s := Document.Slot.new()
	s.name = _req_string(slot, "name")
	s.slot_bone = _req_string(slot, "bone")
	s.color = _read_color(_req_object(slot, "color"))
	var attachment = slot.get("attachment")
	s.attachment = null if attachment == null else str(attachment)
	var blend_mode = slot.get("blendMode")
	s.blend_mode = "normal" if blend_mode == null else str(blend_mode)
	return s


static func _read_skin(skin: Dictionary) -> Document.SkinDef:
	var s := Document.SkinDef.new()
	s.name = _req_string(skin, "name")
	var attachments := _req_object(skin, "attachments")
	for slot_name in attachments:
		var per_slot := {}
		var slot_attachments: Dictionary = attachments[slot_name]
		for attachment_name in slot_attachments:
			per_slot[attachment_name] = _read_attachment(slot_attachments[attachment_name])
		s.attachments[slot_name] = per_slot
	return s


static func _read_attachment(attachment: Dictionary) -> Document.Attachment:
	var a := Document.Attachment.new()
	a.type = _req_string(attachment, "type")
	if a.type != "mesh":
		a.mesh = null
		return a
	var mesh := Document.MeshAttachment.new()
	mesh.uvs = _read_number_array(_req_array(attachment, "uvs"))
	mesh.vertices = _read_number_array(_req_array(attachment, "vertices"))
	var bones_value = attachment.get("bones")
	if bones_value != null and typeof(bones_value) == TYPE_ARRAY:
		mesh.bones = _read_int_array(bones_value)
	else:
		mesh.bones = null
	a.mesh = mesh
	return a


static func _read_ik_constraint(ik: Dictionary) -> Document.IkConstraint:
	var c := Document.IkConstraint.new()
	c.name = _req_string(ik, "name")
	c.bones = _read_string_array(_req_array(ik, "bones"))
	c.target = _req_string(ik, "target")
	c.mix = _req_number(ik, "mix")
	# Format 0.4.0 (ADR-0009) carries the signed bend direction (+1 / -1) in place of the pre-0.4.0
	# bendPositive boolean; the solve keys on the same sign, so bend > 0 reproduces it exactly. The F2
	# depth fields (softness/stretch/compress/uniform) are additive and permitted-but-unread (PP-B5).
	c.bend_positive = _req_number(ik, "bend") > 0.0
	return c


static func _read_transform_constraint(tc: Dictionary) -> Document.TransformConstraint:
	var c := Document.TransformConstraint.new()
	c.name = _req_string(tc, "name")
	c.bones = _read_string_array(_req_array(tc, "bones"))
	c.target = _req_string(tc, "target")
	c.mix_rotate = _req_number(tc, "mixRotate")
	c.mix_x = _req_number(tc, "mixX")
	c.mix_y = _req_number(tc, "mixY")
	c.mix_scale_x = _req_number(tc, "mixScaleX")
	c.mix_scale_y = _req_number(tc, "mixScaleY")
	c.mix_shear_y = _req_number(tc, "mixShearY")
	c.offset_rotation = _req_number(tc, "offsetRotation")
	c.offset_x = _req_number(tc, "offsetX")
	c.offset_y = _req_number(tc, "offsetY")
	c.offset_scale_x = _req_number(tc, "offsetScaleX")
	c.offset_scale_y = _req_number(tc, "offsetScaleY")
	c.offset_shear_y = _req_number(tc, "offsetShearY")
	return c


static func _read_animation(animation: Dictionary) -> Document.AnimationDef:
	var a := Document.AnimationDef.new()
	a.duration = _req_number(animation, "duration")

	var bones_value = animation.get("bones")
	if bones_value != null and typeof(bones_value) == TYPE_DICTIONARY:
		for bone_name in bones_value:
			a.bones[bone_name] = _read_bone_timelines(bones_value[bone_name])

	var slots_value = animation.get("slots")
	if slots_value != null and typeof(slots_value) == TYPE_DICTIONARY:
		for slot_name in slots_value:
			a.slots[slot_name] = _read_slot_timelines(slots_value[slot_name])

	var ik_value = animation.get("ik")
	if ik_value != null and typeof(ik_value) == TYPE_DICTIONARY:
		for ik_name in ik_value:
			var frames := []
			for frame in ik_value[ik_name]:
				var value := _req_object(frame, "value")
				var kf := Document.IkKeyframe.new()
				kf.time = _req_number(frame, "time")
				kf.mix = _req_number(value, "mix")
				# Signed bend direction (ADR-0009); bend > 0 reproduces the pre-0.4.0 bendPositive boolean.
				kf.bend_positive = _req_number(value, "bend") > 0.0
				kf.curve = _read_curve(frame)
				frames.append(kf)
			a.ik[ik_name] = frames

	var transform_value = animation.get("transform")
	if transform_value != null and typeof(transform_value) == TYPE_DICTIONARY:
		for tc_name in transform_value:
			var frames := []
			for frame in transform_value[tc_name]:
				var value := _req_object(frame, "value")
				var kf := Document.TransformKeyframe.new()
				kf.time = _req_number(frame, "time")
				kf.curve = _read_curve(frame)
				kf.mix_rotate = _opt_number(value, "mixRotate")
				kf.mix_x = _opt_number(value, "mixX")
				kf.mix_y = _opt_number(value, "mixY")
				kf.mix_scale_x = _opt_number(value, "mixScaleX")
				kf.mix_scale_y = _opt_number(value, "mixScaleY")
				kf.mix_shear_y = _opt_number(value, "mixShearY")
				frames.append(kf)
			a.transform[tc_name] = frames

	var deform_value = animation.get("deform")
	if deform_value != null and typeof(deform_value) == TYPE_DICTIONARY:
		for skin_name in deform_value:
			var skin_entry: Dictionary = deform_value[skin_name]
			for slot_name in skin_entry:
				var slot_entry: Dictionary = skin_entry[slot_name]
				for attachment_name in slot_entry:
					var frames := []
					for frame in slot_entry[attachment_name]:
						var value := _req_object(frame, "value")
						var kf := Document.DeformKeyframe.new()
						kf.time = _req_number(frame, "time")
						kf.offsets = _read_number_array(_req_array(value, "offsets"))
						kf.curve = _read_curve(frame)
						frames.append(kf)
					var entry := Document.DeformEntry.new()
					entry.skin = skin_name
					entry.slot = slot_name
					entry.attachment = attachment_name
					entry.frames = frames
					a.deform.append(entry)

	var draw_order_value = animation.get("drawOrder")
	if draw_order_value != null and typeof(draw_order_value) == TYPE_ARRAY:
		for key in draw_order_value:
			var kf := Document.DrawOrderKeyframe.new()
			kf.time = _req_number(key, "time")
			kf.offsets = []
			var offsets_value = key.get("offsets")
			if offsets_value != null and typeof(offsets_value) == TYPE_ARRAY:
				for offset in offsets_value:
					var off := Document.DrawOrderOffset.new()
					off.slot = _req_string(offset, "slot")
					off.offset = int(_req_number(offset, "offset"))
					kf.offsets.append(off)
			a.draw_order.append(kf)

	var events_value = animation.get("events")
	if events_value != null and typeof(events_value) == TYPE_ARRAY:
		for ev in events_value:
			var kf := Document.EventKeyframe.new()
			kf.time = _req_number(ev, "time")
			kf.name = _req_string(ev, "name")
			kf.int_value = _opt_int(ev, "int")
			kf.float_value = _opt_number(ev, "float")
			kf.string_value = _opt_string(ev, "string")
			a.events.append(kf)

	return a


static func _read_bone_timelines(timelines: Dictionary) -> Document.BoneTimelines:
	var t := Document.BoneTimelines.new()
	t.rotate = _read_scalar_channel(timelines.get("rotate"), "angle")
	t.translate = _read_vec2_channel(timelines.get("translate"))
	t.scale = _read_vec2_channel(timelines.get("scale"))
	t.shear = _read_vec2_channel(timelines.get("shear"))
	return t


static func _read_slot_timelines(timelines: Dictionary) -> Document.SlotTimelines:
	var t := Document.SlotTimelines.new()
	t.color = _read_color_channel(timelines.get("color"))
	t.attachment = _read_attachment_channel(timelines.get("attachment"))
	return t


static func _read_scalar_channel(channel, value_key: String):
	if channel == null or typeof(channel) != TYPE_ARRAY:
		return null
	var keys := []
	for frame in channel:
		var value := _req_object(frame, "value")
		var kf := Document.ScalarKeyframe.new()
		kf.time = _req_number(frame, "time")
		kf.value = _req_number(value, value_key)
		kf.curve = _read_curve(frame)
		keys.append(kf)
	return keys


static func _read_vec2_channel(channel):
	if channel == null or typeof(channel) != TYPE_ARRAY:
		return null
	var keys := []
	for frame in channel:
		var value := _req_object(frame, "value")
		var kf := Document.Vec2Keyframe.new()
		kf.time = _req_number(frame, "time")
		kf.x = _req_number(value, "x")
		kf.y = _req_number(value, "y")
		kf.curve = _read_curve(frame)
		keys.append(kf)
	return keys


static func _read_color_channel(channel):
	if channel == null or typeof(channel) != TYPE_ARRAY:
		return null
	var keys := []
	for frame in channel:
		var value := _req_object(frame, "value")
		var kf := Document.ColorKeyframe.new()
		kf.time = _req_number(frame, "time")
		kf.color = _read_color(_req_object(value, "color"))
		kf.curve = _read_curve(frame)
		keys.append(kf)
	return keys


static func _read_attachment_channel(channel):
	if channel == null or typeof(channel) != TYPE_ARRAY:
		return null
	var keys := []
	for frame in channel:
		var kf := Document.AttachmentKeyframe.new()
		kf.time = _req_number(frame, "time")
		var name_value = frame.get("name")
		kf.name = null if name_value == null else str(name_value)
		keys.append(kf)
	return keys


static func _read_curve(frame: Dictionary) -> Document.TimelineCurve:
	var curve = frame.get("curve")
	if curve == null:
		return Document.TimelineCurve.linear()
	if typeof(curve) == TYPE_STRING:
		if curve == "stepped":
			return Document.TimelineCurve.new(Document.CurveKind.STEPPED, 0.0, 0.0, 0.0, 0.0)
		return Document.TimelineCurve.linear()
	if typeof(curve) == TYPE_DICTIONARY:
		return Document.TimelineCurve.new(
			Document.CurveKind.BEZIER,
			_req_number(curve, "cx1"),
			_req_number(curve, "cy1"),
			_req_number(curve, "cx2"),
			_req_number(curve, "cy2")
		)
	return Document.TimelineCurve.linear()


static func _read_color(color: Dictionary) -> Document.Rgba:
	return Document.Rgba.new(
		_req_number(color, "r"),
		_req_number(color, "g"),
		_req_number(color, "b"),
		_req_number(color, "a")
	)


static func _read_number_array(array: Array) -> PackedFloat64Array:
	var result := PackedFloat64Array()
	result.resize(array.size())
	for i in range(array.size()):
		result[i] = float(array[i])
	return result


static func _read_int_array(array: Array) -> PackedInt32Array:
	var result := PackedInt32Array()
	result.resize(array.size())
	for i in range(array.size()):
		result[i] = int(array[i])
	return result


static func _read_string_array(array: Array) -> PackedStringArray:
	var result := PackedStringArray()
	result.resize(array.size())
	for i in range(array.size()):
		result[i] = str(array[i])
	return result


static func _is_number(value) -> bool:
	return typeof(value) == TYPE_FLOAT or typeof(value) == TYPE_INT


static func _req_object(obj: Dictionary, key: String) -> Dictionary:
	var member = obj.get(key)
	if member == null or typeof(member) != TYPE_DICTIONARY:
		_fail("missing required object '%s'" % key)
		return {}
	return member


static func _req_array(obj: Dictionary, key: String) -> Array:
	var member = obj.get(key)
	if member == null or typeof(member) != TYPE_ARRAY:
		_fail("missing required array '%s'" % key)
		return []
	return member


static func _req_number(obj: Dictionary, key: String) -> float:
	var member = obj.get(key)
	if not _is_number(member):
		_fail("missing required number '%s'" % key)
		return 0.0
	return float(member)


static func _opt_number(obj: Dictionary, key: String):
	var member = obj.get(key)
	if not _is_number(member):
		return null
	return float(member)


static func _opt_int(obj: Dictionary, key: String):
	var member = obj.get(key)
	if not _is_number(member):
		return null
	return int(member)


static func _opt_string(obj: Dictionary, key: String):
	var member = obj.get(key)
	if member == null or typeof(member) != TYPE_STRING:
		return null
	return member


static func _req_string(obj: Dictionary, key: String) -> String:
	var member = obj.get(key)
	if member == null or typeof(member) != TYPE_STRING:
		_fail("missing required string '%s'" % key)
		return ""
	return member


static func _req_bool(obj: Dictionary, key: String) -> bool:
	var member = obj.get(key)
	if member == null or typeof(member) != TYPE_BOOL:
		_fail("missing required bool '%s'" % key)
		return false
	return member
