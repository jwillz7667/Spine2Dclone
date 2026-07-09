extends RefCounted
# The single animation sampler and the blend layer it drives at full weight (mirrors
# packages/runtime-core/src/skeleton/sample.ts and runtimes/unity Sample.cs). Runs the LOCKED solve
# order: (1) reset to setup pose, (2) apply animation timelines, (3) solve constraints (IK first, then
# transform), (4) world transforms. Steps 5 and 6 (skin/deform, render) are not here.

const Affine = preload("res://core/affine.gd")
const Document = preload("res://core/document.gd")
const Prepared = preload("res://core/prepared.gd")
const Curves = preload("res://core/curve.gd")
const Pose = preload("res://core/pose.gd")
const WorldTransform = preload("res://core/world_transform.gd")
const ResolveWorld = preload("res://core/resolve_world.gd")
const Ik = preload("res://core/ik.gd")
const TransformConstraint = preload("res://core/transform_constraint.gd")

# Solver owned scratch for an on demand target world matrix (step 3 reads the target's world origin).
static var _target_world_scratch: PackedFloat64Array = PackedFloat64Array()


static func sample_skeleton(document: Document.SkeletonDocument, animation_id: String, t: float, out_pose: Pose) -> void:
	var animation = document.find_animation(animation_id)
	if animation == null:
		push_error("animation not found: %s" % animation_id)
		return

	var prepared := get_prepared_animation(out_pose, animation)

	# Step 1: reset to setup pose (bones, slots, constraints), then arm the blend scratch.
	WorldTransform.reset_to_setup_pose(out_pose)
	reset_slots_to_setup(out_pose)
	reset_constraints_to_base(out_pose)
	begin_blend(out_pose)

	# Step 2: apply the single animation at full weight (alpha 1, non additive, discrete wins).
	apply_animation_at(out_pose, prepared, t, 1.0, false, true)
	compose_touched_bones(out_pose)

	# Step 3: solve constraints: ALL IK first, then ALL transform, each in document array order.
	solve_constraints(out_pose)

	# Step 4: world transforms (single forward pass, parents before children).
	WorldTransform.compute_world_transforms(out_pose)


static func begin_blend(pose: Pose) -> void:
	for i in range(pose.setup.size()):
		pose.blend_local[i] = pose.setup[i]
	for i in range(pose.bone_touched.size()):
		pose.bone_touched[i] = 0
	_fill(pose.slot_attachment_win_weight, -1.0)
	_fill(pose.ik_bend_win_weight, -1.0)
	pose.draw_order_win_weight[0] = -1.0


static func compose_touched_bones(pose: Pose) -> void:
	var blend_local := pose.blend_local
	var bone_touched := pose.bone_touched
	var local := pose.local
	var bone_count := pose.bone_count
	for i in range(bone_count):
		if bone_touched[i] == 0:
			continue
		var s := i * Pose.SETUP_STRIDE
		Affine.compose_into(
			local,
			i * Affine.MAT2X3_STRIDE,
			blend_local[s],
			blend_local[s + 1],
			blend_local[s + 2],
			blend_local[s + 3],
			blend_local[s + 4],
			blend_local[s + 5],
			blend_local[s + 6]
		)


# Normalize an angle delta (degrees) into (-180, 180], the shortest signed arc.
static func _normalize_delta_deg(delta: float) -> float:
	var r := fmod(delta, 360.0)
	if r > 180.0:
		r -= 360.0
	elif r <= -180.0:
		r += 360.0
	return r


static func _blend_replace_linear(current: float, sampled: float, w: float) -> float:
	if w >= 1.0:
		return sampled
	if w <= 0.0:
		return current
	return current + ((sampled - current) * w)


static func _blend_replace_rotation(current: float, sampled: float, w: float) -> float:
	if w >= 1.0:
		return sampled
	if w <= 0.0:
		return current
	return current + (_normalize_delta_deg(sampled - current) * w)


static func _blend_add_linear(current: float, setup_value: float, sampled: float, w: float) -> float:
	return current + ((sampled - setup_value) * w)


static func _blend_add_rotation(current: float, setup_value: float, sampled: float, w: float) -> float:
	return current + (_normalize_delta_deg(sampled - setup_value) * w)


# Solve step 3: IK constraints first (document array order), then transform constraints.
static func solve_constraints(pose: Pose) -> void:
	var ik_constraints := pose.ik_constraints
	var transform_constraints := pose.transform_constraints
	if _target_world_scratch.size() != Affine.MAT2X3_STRIDE:
		_target_world_scratch.resize(Affine.MAT2X3_STRIDE)

	for i in range(ik_constraints.size()):
		var constraint = ik_constraints[i]
		var target_index: int = constraint.target_index
		if target_index < 0:
			continue
		var bone_indices: PackedInt32Array = constraint.bone_indices
		if constraint.sampled_mix <= 0.0:
			continue

		ResolveWorld.resolve(pose, target_index, _target_world_scratch, 0)
		var target_x := _target_world_scratch[4]
		var target_y := _target_world_scratch[5]

		if bone_indices.size() == 1:
			var bone_index := bone_indices[0]
			if bone_index < 0:
				continue
			Ik.solve_ik_one_bone(pose, bone_index, target_x, target_y, constraint.sampled_mix)
		else:
			var parent_index := bone_indices[0]
			var child_index := bone_indices[1]
			if parent_index < 0 or child_index < 0:
				continue
			Ik.solve_ik_two_bone(
				pose, parent_index, child_index, target_x, target_y, constraint.sampled_bend_positive, constraint.sampled_mix
			)

	for i in range(transform_constraints.size()):
		var constraint = transform_constraints[i]
		var target_index: int = constraint.target_index
		if target_index < 0:
			continue
		var bone_indices: PackedInt32Array = constraint.bone_indices
		for b in range(bone_indices.size()):
			var bone_index := bone_indices[b]
			if bone_index < 0:
				continue
			TransformConstraint.solve(pose, bone_index, target_index, constraint.sampled_mix, constraint.offset)


static func reset_constraints_to_base(pose: Pose) -> void:
	for i in range(pose.ik_constraints.size()):
		var constraint = pose.ik_constraints[i]
		constraint.sampled_mix = constraint.base_mix
		constraint.sampled_bend_positive = constraint.base_bend_positive
	for i in range(pose.transform_constraints.size()):
		var constraint = pose.transform_constraints[i]
		constraint.sampled_mix.copy_from(constraint.base_mix)


static func _sample_scalar_track(track: Prepared.PreparedTrack, t: float) -> float:
	var i := Curves.find_segment_index(track.times, track.key_count, t)
	var f := Curves.segment_fraction(track, i, t)
	return Curves.segment_component(track, i, f, 0)


static func reset_slots_to_setup(pose: Pose) -> void:
	for i in range(pose.slot_setup_color.size()):
		pose.slot_color[i] = pose.slot_setup_color[i]
	for i in range(pose.slot_count):
		pose.slot_attachment[i] = pose.slot_setup_attachment[i]
	# Step 1 also resets the render order to the setup (identity) draw order (ADR-0008, PP-B4).
	for i in range(pose.slot_setup_draw_order.size()):
		pose.draw_order[i] = pose.slot_setup_draw_order[i]


# Apply ONE prepared animation at time t and blend weight alpha onto the running blend scratch.
static func apply_animation_at(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool, discrete_wins: bool) -> void:
	_apply_bone_entry(pose, prepared, t, alpha, additive)
	_apply_slot_entry(pose, prepared, t, alpha, additive, discrete_wins)
	_apply_constraint_entry(pose, prepared, t, alpha, additive, discrete_wins)
	_apply_draw_order_entry(pose, prepared, t, alpha, discrete_wins)


# Apply this animation's active draw-order key as a discrete, whole-skeleton greater-weight-wins channel
# (ADR-0008, PP-B4; the draw-order analogue of the attachment swap). Mirrors applyDrawOrderEntry in
# sample.ts.
static func _apply_draw_order_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, discrete_wins: bool) -> void:
	var timeline = prepared.draw_order
	if timeline == null or not discrete_wins:
		return
	if alpha < pose.draw_order_win_weight[0]:
		return
	var i := Curves.find_draw_order_key_index(timeline, t)
	if i < 0:
		return
	var order: PackedInt32Array = timeline.orders[i]
	for pos in range(order.size()):
		pose.draw_order[pos] = order[pos]
	pose.draw_order_win_weight[0] = alpha


static func _apply_bone_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool) -> void:
	var bone_channels := prepared.bone_channels
	var setup := pose.setup
	var blend_local := pose.blend_local
	var bone_touched := pose.bone_touched
	for bc in range(bone_channels.size()):
		var channels = bone_channels[bc]
		var bone_index: int = channels.bone_index
		if bone_index < 0:
			continue
		var s := bone_index * Pose.SETUP_STRIDE
		var touched := false

		var rotate = channels.rotate
		if rotate != null:
			var i := Curves.find_segment_index(rotate.times, rotate.key_count, t)
			var f := Curves.segment_fraction(rotate, i, t)
			var sampled := setup[s + 2] + Curves.segment_component(rotate, i, f, 0)
			blend_local[s + 2] = (
				_blend_add_rotation(blend_local[s + 2], setup[s + 2], sampled, alpha)
				if additive
				else _blend_replace_rotation(blend_local[s + 2], sampled, alpha)
			)
			touched = true

		var translate = channels.translate
		if translate != null:
			var i := Curves.find_segment_index(translate.times, translate.key_count, t)
			var f := Curves.segment_fraction(translate, i, t)
			var sx := setup[s] + Curves.segment_component(translate, i, f, 0)
			var sy := setup[s + 1] + Curves.segment_component(translate, i, f, 1)
			blend_local[s] = (
				_blend_add_linear(blend_local[s], setup[s], sx, alpha)
				if additive
				else _blend_replace_linear(blend_local[s], sx, alpha)
			)
			blend_local[s + 1] = (
				_blend_add_linear(blend_local[s + 1], setup[s + 1], sy, alpha)
				if additive
				else _blend_replace_linear(blend_local[s + 1], sy, alpha)
			)
			touched = true

		var scale = channels.scale
		if scale != null:
			var i := Curves.find_segment_index(scale.times, scale.key_count, t)
			var f := Curves.segment_fraction(scale, i, t)
			var sx := setup[s + 3] * Curves.segment_component(scale, i, f, 0)
			var sy := setup[s + 4] * Curves.segment_component(scale, i, f, 1)
			blend_local[s + 3] = (
				_blend_add_linear(blend_local[s + 3], setup[s + 3], sx, alpha)
				if additive
				else _blend_replace_linear(blend_local[s + 3], sx, alpha)
			)
			blend_local[s + 4] = (
				_blend_add_linear(blend_local[s + 4], setup[s + 4], sy, alpha)
				if additive
				else _blend_replace_linear(blend_local[s + 4], sy, alpha)
			)
			touched = true

		var shear = channels.shear
		if shear != null:
			var i := Curves.find_segment_index(shear.times, shear.key_count, t)
			var f := Curves.segment_fraction(shear, i, t)
			var sx := setup[s + 5] + Curves.segment_component(shear, i, f, 0)
			var sy := setup[s + 6] + Curves.segment_component(shear, i, f, 1)
			blend_local[s + 5] = (
				_blend_add_linear(blend_local[s + 5], setup[s + 5], sx, alpha)
				if additive
				else _blend_replace_linear(blend_local[s + 5], sx, alpha)
			)
			blend_local[s + 6] = (
				_blend_add_linear(blend_local[s + 6], setup[s + 6], sy, alpha)
				if additive
				else _blend_replace_linear(blend_local[s + 6], sy, alpha)
			)
			touched = true

		if touched:
			bone_touched[bone_index] = 1


static func _apply_slot_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool, discrete_wins: bool) -> void:
	var slot_channels := prepared.slot_channels
	var slot_color := pose.slot_color
	var slot_setup_color := pose.slot_setup_color
	var slot_attachment := pose.slot_attachment
	var slot_attachment_win_weight := pose.slot_attachment_win_weight
	for sc in range(slot_channels.size()):
		var channels = slot_channels[sc]
		var slot_index: int = channels.slot_index
		if slot_index < 0:
			continue

		var color = channels.color
		if color != null:
			var i := Curves.find_segment_index(color.times, color.key_count, t)
			var f := Curves.segment_fraction(color, i, t)
			var base_index := slot_index * Pose.SLOT_COLOR_STRIDE
			for k in range(Pose.SLOT_COLOR_STRIDE):
				var sampled := Curves.segment_component(color, i, f, k)
				slot_color[base_index + k] = (
					_blend_add_linear(slot_color[base_index + k], slot_setup_color[base_index + k], sampled, alpha)
					if additive
					else _blend_replace_linear(slot_color[base_index + k], sampled, alpha)
				)

		var attachment = channels.attachment
		if attachment != null and discrete_wins and alpha >= slot_attachment_win_weight[slot_index]:
			slot_attachment[slot_index] = Curves.sample_attachment_name(attachment, t)
			slot_attachment_win_weight[slot_index] = alpha


static func _apply_constraint_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool, discrete_wins: bool) -> void:
	var ik_channels := prepared.ik_channels
	var transform_channels := prepared.transform_channels
	var ik_constraints := pose.ik_constraints
	var transform_constraints := pose.transform_constraints
	var ik_bend_win_weight := pose.ik_bend_win_weight

	for c in range(ik_channels.size()):
		var channel = ik_channels[c]
		var index: int = channel.constraint_index
		if index < 0:
			continue
		var constraint = ik_constraints[index]
		if channel.mix != null:
			var value := _sample_scalar_track(channel.mix, t)
			constraint.sampled_mix = (
				_blend_add_linear(constraint.sampled_mix, constraint.base_mix, value, alpha)
				if additive
				else _blend_replace_linear(constraint.sampled_mix, value, alpha)
			)
		if channel.bend_positive != null and discrete_wins and alpha >= ik_bend_win_weight[index]:
			constraint.sampled_bend_positive = Curves.sample_step_bool(channel.bend_positive, t)
			ik_bend_win_weight[index] = alpha

	for c in range(transform_channels.size()):
		var channel = transform_channels[c]
		var index: int = channel.constraint_index
		if index < 0:
			continue
		var constraint = transform_constraints[index]
		var mix = constraint.sampled_mix
		var base_mix = constraint.base_mix
		if channel.mix_rotate != null:
			mix.rotate = _blend_mix(mix.rotate, base_mix.rotate, channel.mix_rotate, t, alpha, additive)
		if channel.mix_x != null:
			mix.x = _blend_mix(mix.x, base_mix.x, channel.mix_x, t, alpha, additive)
		if channel.mix_y != null:
			mix.y = _blend_mix(mix.y, base_mix.y, channel.mix_y, t, alpha, additive)
		if channel.mix_scale_x != null:
			mix.scale_x = _blend_mix(mix.scale_x, base_mix.scale_x, channel.mix_scale_x, t, alpha, additive)
		if channel.mix_scale_y != null:
			mix.scale_y = _blend_mix(mix.scale_y, base_mix.scale_y, channel.mix_scale_y, t, alpha, additive)
		if channel.mix_shear_y != null:
			mix.shear_y = _blend_mix(mix.shear_y, base_mix.shear_y, channel.mix_shear_y, t, alpha, additive)


static func _blend_mix(current: float, base_value: float, track: Prepared.PreparedTrack, t: float, alpha: float, additive: bool) -> float:
	var value := _sample_scalar_track(track, t)
	if additive:
		return _blend_add_linear(current, base_value, value, alpha)
	return _blend_replace_linear(current, value, alpha)


static func get_prepared_animation(pose: Pose, animation) -> Prepared.PreparedAnimation:
	if pose.prepared_animations.has(animation):
		return pose.prepared_animations[animation]
	var prepared := _prepare_animation(pose, animation)
	pose.prepared_animations[animation] = prepared
	return prepared


static func _prepare_animation(pose: Pose, animation) -> Prepared.PreparedAnimation:
	var bone_index_by_name := _name_index(pose.bone_names)
	var slot_index_by_name := _name_index(pose.slot_names)

	var result := Prepared.PreparedAnimation.new()

	for bone_name in animation.bones:
		var timelines = animation.bones[bone_name]
		var channels := Prepared.PreparedBoneChannels.new()
		channels.bone_index = _lookup(bone_index_by_name, bone_name)
		channels.rotate = Curves.build_scalar_track(timelines.rotate) if _has_keys(timelines.rotate) else null
		channels.translate = Curves.build_vec2_track(timelines.translate) if _has_keys(timelines.translate) else null
		channels.scale = Curves.build_vec2_track(timelines.scale) if _has_keys(timelines.scale) else null
		channels.shear = Curves.build_vec2_track(timelines.shear) if _has_keys(timelines.shear) else null
		result.bone_channels.append(channels)

	for slot_name in animation.slots:
		var timelines = animation.slots[slot_name]
		var channels := Prepared.PreparedSlotChannels.new()
		channels.slot_index = _lookup(slot_index_by_name, slot_name)
		channels.color = Curves.build_color_track(timelines.color) if _has_keys(timelines.color) else null
		channels.attachment = Curves.build_attachment_track(timelines.attachment) if _has_keys(timelines.attachment) else null
		result.slot_channels.append(channels)

	var ik_index_by_name := _name_index_of(pose.ik_constraints)
	for ik_name in animation.ik:
		var frames = animation.ik[ik_name]
		if frames.size() == 0:
			continue
		var channel := Prepared.PreparedIkChannel.new()
		channel.constraint_index = _lookup(ik_index_by_name, ik_name)
		channel.mix = Curves.build_ik_mix_track(frames)
		channel.bend_positive = Curves.build_bend_track(frames)
		result.ik_channels.append(channel)

	var transform_index_by_name := _name_index_of(pose.transform_constraints)
	for tc_name in animation.transform:
		var frames = animation.transform[tc_name]
		if frames.size() == 0:
			continue
		var channel := Prepared.PreparedTransformChannel.new()
		channel.constraint_index = _lookup(transform_index_by_name, tc_name)
		channel.mix_rotate = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_ROTATE)
		channel.mix_x = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_X)
		channel.mix_y = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_Y)
		channel.mix_scale_x = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_SCALE_X)
		channel.mix_scale_y = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_SCALE_Y)
		channel.mix_shear_y = Curves.build_transform_mix_track(frames, Curves.TransformMixChannel.MIX_SHEAR_Y)
		result.transform_channels.append(channel)

	for entry in animation.deform:
		if entry.frames.size() == 0:
			continue
		var channel := Prepared.PreparedDeformChannel.new()
		channel.skin = entry.skin
		channel.slot = entry.slot
		channel.attachment = entry.attachment
		channel.track = Curves.build_deform_track(entry.frames)
		result.deform_channels.append(channel)

	if animation.draw_order.size() > 0:
		result.draw_order = Curves.build_draw_order_timeline(animation.draw_order, slot_index_by_name, pose.slot_count)

	return result


static func _has_keys(keys) -> bool:
	return keys != null and keys.size() > 0


static func _lookup(index: Dictionary, name) -> int:
	return index.get(name, -1)


static func _name_index(names: Array) -> Dictionary:
	var index := {}
	for i in range(names.size()):
		index[names[i]] = i
	return index


static func _name_index_of(items: Array) -> Dictionary:
	var index := {}
	for i in range(items.size()):
		index[items[i].name] = i
	return index


static func _fill(array: PackedFloat64Array, value: float) -> void:
	for i in range(array.size()):
		array[i] = value
