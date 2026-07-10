extends RefCounted
# Build a Pose from a rig document (mirrors packages/runtime-core/src/skeleton/build-pose.ts and
# runtimes/unity BuildPose.cs). It allocates the buffers once, captures each bone's setup transform and
# each slot's setup color, active attachment name, and driving bone, resolves parent/slot bone names to
# indices, and resolves the IK/transform constraints to bone indices in document array order. A name that
# does not resolve is captured as -1 and skipped by the solve rather than crashing.

const Document = preload("res://core/document.gd")
const Pose = preload("res://core/pose.gd")
const TransformMode = preload("res://core/transform_mode.gd")
const Affine = preload("res://core/affine.gd")
const PathConstraintSolve = preload("res://core/path_constraint.gd")


static func build(document: Document.SkeletonDocument) -> Pose:
	var bones := document.bones
	var bone_count := bones.size()
	var bone_names := []
	bone_names.resize(bone_count)
	for i in range(bone_count):
		bone_names[i] = bones[i].name

	var slots := document.slots
	var slot_count := slots.size()
	var slot_names := []
	slot_names.resize(slot_count)
	for i in range(slot_count):
		slot_names[i] = slots[i].name

	var index_by_name := {}
	for i in range(bone_count):
		index_by_name[bone_names[i]] = i

	# Skin-scoping map (ADR-0009 section 5, ADR-0011 section 4): constraint name -> the skins that scope it.
	# A constraint listed in a skin's `constraints` is active only while one of those skins is active; a
	# constraint in no list is unscoped (always active). Built once here so the per-frame solve reads a
	# captured `scope_skins`. Values are plain Array[String]; a constraint absent from the map resolves null.
	var scope_by_constraint := {}
	for skin in document.skins:
		for name in skin.constraints:
			if scope_by_constraint.has(name):
				scope_by_constraint[name].append(skin.name)
			else:
				scope_by_constraint[name] = [skin.name]

	var ik_constraints := []
	for constraint in document.ik_constraints:
		ik_constraints.append(_resolve_ik(constraint, index_by_name, scope_by_constraint.get(constraint.name, null)))

	var transform_constraints := []
	for constraint in document.transform_constraints:
		transform_constraints.append(_resolve_transform(constraint, index_by_name, scope_by_constraint.get(constraint.name, null)))

	# Path constraints (ADR-0013, PP-B6). Their prepared spline geometry comes from the target slot's setup
	# default-skin path attachment (ADR-0013 section 7); a pre-0.5.0 draft may lack the array (tolerated as
	# empty, the same lenience as the IK/transform arrays).
	var slot_bone_by_name := {}
	var slot_setup_attachment_by_name := {}
	for slot in slots:
		slot_bone_by_name[slot.name] = index_by_name.get(slot.slot_bone, -1)
		slot_setup_attachment_by_name[slot.name] = slot.attachment
	var default_skin = null
	for skin in document.skins:
		if skin.name == "default":
			default_skin = skin
			break
	var path_constraints := []
	for constraint in document.path_constraints:
		path_constraints.append(
			_resolve_path(
				constraint,
				index_by_name,
				slot_bone_by_name,
				slot_setup_attachment_by_name,
				default_skin,
				bone_count,
				scope_by_constraint.get(constraint.name, null)
			)
		)

	var pose := Pose.new(bone_count, bone_names, slot_count, slot_names, ik_constraints, transform_constraints, path_constraints)

	for i in range(bone_count):
		var bone = bones[i]
		pose.parent_indices[i] = -1 if bone.parent == null else _lookup(index_by_name, bone.parent)
		pose.transform_modes[i] = TransformMode.from_name(bone.transform_mode)
		pose.bone_length[i] = bone.length
		var b := i * Pose.SETUP_STRIDE
		pose.setup[b] = bone.x
		pose.setup[b + 1] = bone.y
		pose.setup[b + 2] = bone.rotation
		pose.setup[b + 3] = bone.scale_x
		pose.setup[b + 4] = bone.scale_y
		pose.setup[b + 5] = bone.shear_x
		pose.setup[b + 6] = bone.shear_y

	for i in range(slot_count):
		var slot = slots[i]
		pose.slot_bone_indices[i] = _lookup(index_by_name, slot.slot_bone)
		var b := i * Pose.SLOT_COLOR_STRIDE
		pose.slot_setup_color[b] = slot.color.r
		pose.slot_setup_color[b + 1] = slot.color.g
		pose.slot_setup_color[b + 2] = slot.color.b
		pose.slot_setup_color[b + 3] = slot.color.a
		# Setup two-color dark tint (ADR-0009 section 4.3). Present only when the slot enables two-color
		# tinting; absent slots keep an inert (0, 0, 0, 1) so the reset is well-defined but renderers skip it
		# (slot_has_dark_color is 0). The dark tint's alpha channel is inert but carried for a total RGBA lane.
		var dark = slot.dark_color
		pose.slot_has_dark_color[i] = 0 if dark == null else 1
		pose.slot_setup_dark_color[b] = 0.0 if dark == null else dark.r
		pose.slot_setup_dark_color[b + 1] = 0.0 if dark == null else dark.g
		pose.slot_setup_dark_color[b + 2] = 0.0 if dark == null else dark.b
		pose.slot_setup_dark_color[b + 3] = 1.0 if dark == null else dark.a
		pose.slot_setup_attachment[i] = slot.attachment

	return pose


static func _lookup(index_by_name: Dictionary, name) -> int:
	return index_by_name.get(name, -1)


static func _resolve_bone_indices(names: PackedStringArray, index_by_name: Dictionary) -> PackedInt32Array:
	var indices := PackedInt32Array()
	indices.resize(names.size())
	for i in range(names.size()):
		indices[i] = _lookup(index_by_name, names[i])
	return indices


static func _resolve_ik(constraint, index_by_name: Dictionary, scope_skins) -> Pose.ResolvedIkConstraint:
	return Pose.ResolvedIkConstraint.new(
		constraint.name,
		_resolve_bone_indices(constraint.bones, index_by_name),
		_lookup(index_by_name, constraint.target),
		constraint.mix,
		constraint.bend_positive,
		constraint.softness,
		constraint.stretch,
		constraint.compress,
		constraint.uniform,
		constraint.order,
		scope_skins
	)


static func _resolve_transform(constraint, index_by_name: Dictionary, scope_skins) -> Pose.ResolvedTransformConstraint:
	var base_mix := Pose.TransformMix.new(
		constraint.mix_rotate,
		constraint.mix_x,
		constraint.mix_y,
		constraint.mix_scale_x,
		constraint.mix_scale_y,
		constraint.mix_shear_y
	)
	var offset := Pose.TransformOffset.new(
		constraint.offset_rotation,
		constraint.offset_x,
		constraint.offset_y,
		constraint.offset_scale_x,
		constraint.offset_scale_y,
		constraint.offset_shear_y
	)
	return Pose.ResolvedTransformConstraint.new(
		constraint.name,
		_resolve_bone_indices(constraint.bones, index_by_name),
		_lookup(index_by_name, constraint.target),
		base_mix,
		offset,
		constraint.local,
		constraint.relative,
		constraint.order,
		scope_skins
	)


# The logical control-point count of a path attachment (mirrors pathVertexCount in build-pose.ts):
# unweighted is vertices.size() / 2; weighted walks the ADR-0002 self-delimiting stream (each logical vertex
# starts with its influence count, then that many [boneIndex, vx, vy, weight] quads) counting logical
# vertices. A validated document's stream is total, so the walk lands exactly on the stream length.
static func _path_vertex_count(attachment) -> int:
	var weighted: bool = attachment.path_bones != null and attachment.path_bones.size() > 0
	if not weighted:
		return attachment.path_vertices.size() / 2
	var stream: PackedFloat64Array = attachment.path_vertices
	var cursor := 0
	var count := 0
	while cursor < stream.size():
		var influence_count := int(stream[cursor])
		cursor += 1 + influence_count * 4
		count += 1
	return count


# Build the prepared spline geometry (ADR-0013 sections 1 to 3, mirrors preparePathGeometry in build-pose.ts)
# from a path attachment and its slot bone. All per-frame scratch (world control points, the per-curve
# arc-length LUT, and, for a weighted path, the packed on-demand world buffer) is allocated ONCE here.
static func _prepare_path_geometry(attachment, slot_bone_index: int, bone_count: int):
	var weighted: bool = attachment.path_bones != null and attachment.path_bones.size() > 0
	var vertex_count := _path_vertex_count(attachment)
	var curve_count := vertex_count / 3 if attachment.path_closed else (vertex_count - 1) / 3
	var geom := PathConstraintSolve.PreparedPathGeometry.new()
	geom.closed = attachment.path_closed
	geom.constant_speed = attachment.path_constant_speed
	geom.curve_count = curve_count
	geom.vertex_count = vertex_count
	geom.lengths = attachment.path_lengths.duplicate()
	geom.weighted = weighted
	geom.local_vertices = PackedFloat64Array() if weighted else attachment.path_vertices
	geom.stream = attachment.path_vertices if weighted else PackedFloat64Array()
	geom.manifest_bones = attachment.path_bones if weighted else null
	geom.slot_bone_index = slot_bone_index
	var world_points := PackedFloat64Array()
	world_points.resize(vertex_count * 2)
	geom.world_points = world_points
	var curve_lut := PackedFloat64Array()
	curve_lut.resize(curve_count * (PathConstraintSolve.PATH_CURVE_SUBDIVISIONS + 1))
	geom.curve_lut = curve_lut
	if weighted:
		var bone_world_scratch := PackedFloat64Array()
		bone_world_scratch.resize(bone_count * Affine.MAT2X3_STRIDE)
		geom.bone_world_scratch = bone_world_scratch
	else:
		geom.bone_world_scratch = null
	return geom


# Resolve a path constraint (ADR-0013, mirrors resolvePath in build-pose.ts). The target names a SLOT; its
# setup default-skin path attachment supplies the geometry. A target slot that does not exist, has no setup
# attachment, or whose setup attachment (in the default skin) is not a path resolves `path` to null and the
# constraint solves nothing (the runtime concern ADR-0011 section 2.2 leaves here). A curve count that does
# not fit the control-point count (an unvalidated document) also resolves to null.
static func _resolve_path(constraint, index_by_name: Dictionary, slot_bone_by_name: Dictionary, slot_setup_attachment_by_name: Dictionary, default_skin, bone_count: int, scope_skins) -> Pose.ResolvedPathConstraint:
	var target_slot: String = constraint.target
	var slot_bone_index: int = slot_bone_by_name.get(target_slot, -1)
	var setup_name = slot_setup_attachment_by_name.get(target_slot, null)
	var path = null
	if setup_name != null and default_skin != null:
		var per_slot = default_skin.attachments.get(target_slot, null)
		if per_slot != null:
			var attachment = per_slot.get(setup_name, null)
			if attachment != null and attachment.type == "path":
				var vertex_count := _path_vertex_count(attachment)
				var fits: bool
				if attachment.path_closed:
					fits = vertex_count >= 3 and vertex_count % 3 == 0
				else:
					fits = vertex_count >= 4 and (vertex_count - 1) % 3 == 0
				if fits and attachment.path_lengths != null and attachment.path_lengths.size() > 0:
					path = _prepare_path_geometry(attachment, slot_bone_index, bone_count)
	return Pose.ResolvedPathConstraint.new(
		constraint.name,
		_resolve_bone_indices(constraint.bones, index_by_name),
		constraint.position_mode,
		constraint.spacing_mode,
		constraint.rotate_mode,
		constraint.offset_rotation,
		constraint.position,
		constraint.spacing,
		constraint.mix_rotate,
		constraint.mix_x,
		constraint.mix_y,
		path,
		constraint.order,
		scope_skins
	)
