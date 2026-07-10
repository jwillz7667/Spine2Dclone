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
const PathConstraintSolve = preload("res://core/path_constraint.gd")
const PhysicsConstraintSolve = preload("res://core/physics_constraint.gd")

# Solver owned scratch for an on demand target world matrix (step 3 reads the target's world origin).
static var _target_world_scratch: PackedFloat64Array = PackedFloat64Array()


# active_skin (default null) is the active skin for skin-scoped constraints (ADR-0009 section 5, ADR-0011
# section 4). null leaves only the always-active 'default' skin active, so a scoped constraint stays
# inactive and every non-scoped rig is unaffected. A constraint no skin scopes is always solved.
#
# frame_dt (default 0.0) is the frame delta time in seconds (ADR-0014 section 2.2), advancing the PHYSICS
# simulation clock ONLY. Physics carries velocity across frames, so a physics rig must be sampled SEQUENTIALLY
# with the real per-frame dt between consecutive calls (frameDt 0 on the first frame, then poseTimes[i] -
# poseTimes[i-1]). A rig with no physics constraints ignores it entirely (byte-identical to the pre-physics
# path), and a frameDt-0 call runs zero physics steps (initializing physics to rest on its pose).
static func sample_skeleton(document: Document.SkeletonDocument, animation_id: String, t: float, out_pose: Pose, active_skin = null, frame_dt: float = 0.0) -> void:
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

	# Step 3: solve constraints: ALL IK first, then ALL transform, then all path, then all physics, each in
	# document array order. A skin-scoped constraint is skipped unless its skin is active. Physics steps its
	# simulation clock by frame_dt.
	solve_constraints(out_pose, active_skin, frame_dt)

	# Step 4: world transforms (single forward pass, parents before children).
	WorldTransform.compute_world_transforms(out_pose)


static func begin_blend(pose: Pose) -> void:
	for i in range(pose.setup.size()):
		pose.blend_local[i] = pose.setup[i]
	for i in range(pose.bone_touched.size()):
		pose.bone_touched[i] = 0
	_fill(pose.slot_attachment_win_weight, -1.0)
	_fill(pose.ik_bend_win_weight, -1.0)
	_fill(pose.ik_stretch_win_weight, -1.0)
	_fill(pose.ik_compress_win_weight, -1.0)
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


# Solve step 3 (ADR-0003 section 3, ordering per ADR-0009 section 1.3 / ADR-0010 section 1 / ADR-0011
# section 2.3). Default (pose.solve_order null): all IK constraints, then all transform constraints, then all
# PATH constraints, each in document order. When the rig assigns an explicit order, pose.solve_order is the
# precomputed dense schedule spanning all THREE arrays and step 3 walks it, dispatching each code to the SAME
# per-constraint helper the default path uses (so a constraint is bit-identical either way; only the schedule
# moves).
static func solve_constraints(pose: Pose, active_skin = null, frame_dt: float = 0.0) -> void:
	if _target_world_scratch.size() != Affine.MAT2X3_STRIDE:
		_target_world_scratch.resize(Affine.MAT2X3_STRIDE)

	var ik_constraints := pose.ik_constraints
	var transform_constraints := pose.transform_constraints
	var path_constraints := pose.path_constraints
	var physics_constraints := pose.physics_constraints
	var solve_order = pose.solve_order

	if solve_order == null:
		for i in range(ik_constraints.size()):
			_solve_one_ik_constraint(pose, ik_constraints[i], active_skin)
		for i in range(transform_constraints.size()):
			_solve_one_transform_constraint(pose, transform_constraints[i], active_skin)
		for i in range(path_constraints.size()):
			_solve_one_path_constraint(pose, path_constraints[i], active_skin)
		for i in range(physics_constraints.size()):
			_solve_one_physics_constraint(pose, physics_constraints[i], active_skin, frame_dt)
		return

	var ik_count := ik_constraints.size()
	var path_base := ik_count + transform_constraints.size()
	var physics_base := path_base + path_constraints.size()
	for p in range(solve_order.size()):
		var code: int = solve_order[p]
		if code < ik_count:
			_solve_one_ik_constraint(pose, ik_constraints[code], active_skin)
		elif code < path_base:
			_solve_one_transform_constraint(pose, transform_constraints[code - ik_count], active_skin)
		elif code < physics_base:
			_solve_one_path_constraint(pose, path_constraints[code - path_base], active_skin)
		else:
			_solve_one_physics_constraint(pose, physics_constraints[code - physics_base], active_skin, frame_dt)


# Whether a constraint participates in the solve under the active skin (ADR-0009 section 5, ADR-0011
# section 4). Unscoped (scope_skins null) constraints are always active; a scoped one is active when the
# 'default' skin scopes it (the default skin is always active) or when the frame's active skin is one of its
# scoping skins. Otherwise the constraint is SKIPPED.
static func _is_constraint_scope_active(scope_skins, active_skin) -> bool:
	if scope_skins == null:
		return true
	for i in range(scope_skins.size()):
		var skin = scope_skins[i]
		if skin == "default" or skin == active_skin:
			return true
	return false


# Solve one IK constraint against the pose (ADR-0003 section 4, depth per ADR-0010 section 2). A constraint
# with an unresolved bone/target index (-1) or non-positive mix is a no-op; a skin-scoped constraint whose
# skin is inactive is skipped. The per-constraint sampled scratch (mix, bend, softness, stretch, compress)
# was written by step 2; uniform is the static flag.
static func _solve_one_ik_constraint(pose: Pose, constraint, active_skin = null) -> void:
	if not _is_constraint_scope_active(constraint.scope_skins, active_skin):
		return
	var target_index: int = constraint.target_index
	if target_index < 0:
		return
	if constraint.sampled_mix <= 0.0:
		return
	var bone_indices: PackedInt32Array = constraint.bone_indices

	ResolveWorld.resolve(pose, target_index, _target_world_scratch, 0)
	var target_x := _target_world_scratch[4]
	var target_y := _target_world_scratch[5]

	if bone_indices.size() == 1:
		var bone_index := bone_indices[0]
		if bone_index < 0:
			return
		Ik.solve_ik_one_bone(
			pose, bone_index, target_x, target_y, constraint.sampled_mix, constraint.sampled_stretch, constraint.sampled_compress
		)
	else:
		var parent_index := bone_indices[0]
		var child_index := bone_indices[1]
		if parent_index < 0 or child_index < 0:
			return
		Ik.solve_ik_two_bone(
			pose,
			parent_index,
			child_index,
			target_x,
			target_y,
			constraint.sampled_bend_positive,
			constraint.sampled_mix,
			constraint.sampled_softness,
			constraint.sampled_stretch,
			constraint.sampled_compress,
			constraint.uniform
		)


# Solve one transform constraint against the pose (ADR-0003 section 5). Applies to each constrained bone in
# stored order; an unresolved bone/target index is skipped, as is a scoped constraint whose skin is inactive.
static func _solve_one_transform_constraint(pose: Pose, constraint, active_skin = null) -> void:
	if not _is_constraint_scope_active(constraint.scope_skins, active_skin):
		return
	var target_index: int = constraint.target_index
	if target_index < 0:
		return
	var bone_indices: PackedInt32Array = constraint.bone_indices
	for b in range(bone_indices.size()):
		var bone_index := bone_indices[b]
		if bone_index < 0:
			continue
		TransformConstraint.solve(pose, bone_index, target_index, constraint.sampled_mix, constraint.offset, constraint.local, constraint.relative)


# Solve one path constraint against the pose (ADR-0013, PP-B6). A skin-scoped constraint whose skin is
# inactive is skipped; otherwise the constraint distributes and orients its bones along the target path. The
# per-constraint sampled scratch (position, spacing, mix*) was written by step 2 (else reset to the base).
static func _solve_one_path_constraint(pose: Pose, constraint, active_skin = null) -> void:
	if not _is_constraint_scope_active(constraint.scope_skins, active_skin):
		return
	PathConstraintSolve.solve(pose, constraint)


# Solve one physics constraint against the pose (ADR-0014, PP-B7), stepping its simulation by frame_dt. A skin-
# scoped constraint whose skin is inactive is skipped AND its state is invalidated (initialized set false), so a
# re-activation (skin change) re-initializes the bone to rest on its pose rather than carrying stale velocity
# across the gap (ADR-0014 section 6). An active constraint solves; the per-frame sampled scratch (mix/inertia/
# strength/damping/wind/gravity) was written by step 2 (else reset to the base).
static func _solve_one_physics_constraint(pose: Pose, constraint, active_skin, frame_dt: float) -> void:
	if not _is_constraint_scope_active(constraint.scope_skins, active_skin):
		constraint.initialized = false
		return
	PhysicsConstraintSolve.solve(pose, constraint, frame_dt)


# Reset every physics constraint's simulation state so the NEXT active solve re-initializes the bone to rest on
# its pose (ADR-0014 section 6 activation / restart). Physics carries velocity across frames, so a caller that
# restarts a sampling sequence (rewinds to the first frame, or re-uses a pose for an unrelated run) MUST call
# this first; otherwise stale velocity leaks into the new sequence. It flips the per-constraint `initialized`
# flag (the state arrays are re-seeded from the pose on the next solve).
static func reset_physics(pose: Pose) -> void:
	for i in range(pose.physics_constraints.size()):
		pose.physics_constraints[i].initialized = false


static func reset_constraints_to_base(pose: Pose) -> void:
	for i in range(pose.ik_constraints.size()):
		var constraint = pose.ik_constraints[i]
		constraint.sampled_mix = constraint.base_mix
		constraint.sampled_bend_positive = constraint.base_bend_positive
		constraint.sampled_softness = constraint.base_softness
		constraint.sampled_stretch = constraint.base_stretch
		constraint.sampled_compress = constraint.base_compress
	for i in range(pose.transform_constraints.size()):
		var constraint = pose.transform_constraints[i]
		constraint.sampled_mix.copy_from(constraint.base_mix)
	# Path constraints (ADR-0013): reset the sampled position/spacing/mix* to the definition base; step 2's
	# path timeline then overlays any keyed channel, and an unkeyed channel keeps its base.
	for i in range(pose.path_constraints.size()):
		var constraint = pose.path_constraints[i]
		constraint.sampled_position = constraint.base_position
		constraint.sampled_spacing = constraint.base_spacing
		constraint.sampled_mix_rotate = constraint.base_mix_rotate
		constraint.sampled_mix_x = constraint.base_mix_x
		constraint.sampled_mix_y = constraint.base_mix_y
	# Physics constraints (ADR-0014 section 7): reset the sampled KEYABLE knobs to the definition base; step 2's
	# physics timeline then overlays any keyed channel, and an unkeyed channel keeps its base. step/mass are
	# static (not keyable) and the persistent (p, v) simulation state is untouched here.
	for i in range(pose.physics_constraints.size()):
		var constraint = pose.physics_constraints[i]
		constraint.sampled_inertia = constraint.base_inertia
		constraint.sampled_strength = constraint.base_strength
		constraint.sampled_damping = constraint.base_damping
		constraint.sampled_wind = constraint.base_wind
		constraint.sampled_gravity = constraint.base_gravity
		constraint.sampled_mix = constraint.base_mix


static func _sample_scalar_track(track: Prepared.PreparedTrack, t: float) -> float:
	var i := Curves.find_segment_index(track.times, track.key_count, t)
	var f := Curves.segment_fraction(track, i, t)
	return Curves.segment_component(track, i, f, 0)


static func reset_slots_to_setup(pose: Pose) -> void:
	for i in range(pose.slot_setup_color.size()):
		pose.slot_color[i] = pose.slot_setup_color[i]
	# Reset the two-color dark tint to its setup (ADR-0009 section 4.3).
	for i in range(pose.slot_setup_dark_color.size()):
		pose.slot_dark_color[i] = pose.slot_setup_dark_color[i]
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

		# Per-component split tracks (ADR-0009 section 4.1). Each writes ONE local component with the same
		# math as the corresponding joint component (translate/shear are setup + value, scale is setup *
		# value). The format's coexistence ban guarantees a channel's joint and split forms never both key,
		# so applying every present track cannot double-write a component.
		if _apply_bone_scalar(channels.translate_x, blend_local, setup, s, false, t, alpha, additive):
			touched = true
		if _apply_bone_scalar(channels.translate_y, blend_local, setup, s + 1, false, t, alpha, additive):
			touched = true
		if _apply_bone_scalar(channels.scale_x, blend_local, setup, s + 3, true, t, alpha, additive):
			touched = true
		if _apply_bone_scalar(channels.scale_y, blend_local, setup, s + 4, true, t, alpha, additive):
			touched = true
		if _apply_bone_scalar(channels.shear_x, blend_local, setup, s + 5, false, t, alpha, additive):
			touched = true
		if _apply_bone_scalar(channels.shear_y, blend_local, setup, s + 6, false, t, alpha, additive):
			touched = true

		if touched:
			bone_touched[bone_index] = 1


# Apply one split scalar bone track to a single local-component lane, matching the joint channel's math:
# multiplicative (scale) composes as setup * value, else (translate, shear) as setup + value; the result
# blends onto blend_local by alpha (additive adds the delta from setup). Returns whether the track applied
# (null tracks are absent). Shaped like the joint blend so a split-keyed bone produces the identical world
# affine a joint-keyed one would for equivalent values. Mirrors applyBoneScalar in sample.ts.
static func _apply_bone_scalar(track, blend_local: PackedFloat64Array, setup: PackedFloat64Array, lane: int, multiplicative: bool, t: float, alpha: float, additive: bool) -> bool:
	if track == null:
		return false
	var i := Curves.find_segment_index(track.times, track.key_count, t)
	var f := Curves.segment_fraction(track, i, t)
	var raw := Curves.segment_component(track, i, f, 0)
	var sampled := setup[lane] * raw if multiplicative else setup[lane] + raw
	blend_local[lane] = (
		_blend_add_linear(blend_local[lane], setup[lane], sampled, alpha)
		if additive
		else _blend_replace_linear(blend_local[lane], sampled, alpha)
	)
	return true


static func _apply_slot_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool, discrete_wins: bool) -> void:
	var slot_channels := prepared.slot_channels
	var slot_color := pose.slot_color
	var slot_setup_color := pose.slot_setup_color
	var slot_dark_color := pose.slot_dark_color
	var slot_setup_dark_color := pose.slot_setup_dark_color
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

		# Split color (ADR-0009 section 4.2): rgb writes lanes 0..2, alpha lane 3. The coexistence ban means
		# these never run alongside the joint color on the same slot.
		var rgb = channels.rgb
		if rgb != null:
			var i := Curves.find_segment_index(rgb.times, rgb.key_count, t)
			var f := Curves.segment_fraction(rgb, i, t)
			var base_rgb := slot_index * Pose.SLOT_COLOR_STRIDE
			for k in range(3):
				var sampled := Curves.segment_component(rgb, i, f, k)
				slot_color[base_rgb + k] = (
					_blend_add_linear(slot_color[base_rgb + k], slot_setup_color[base_rgb + k], sampled, alpha)
					if additive
					else _blend_replace_linear(slot_color[base_rgb + k], sampled, alpha)
				)
		var alpha_track = channels.alpha
		if alpha_track != null:
			var i := Curves.find_segment_index(alpha_track.times, alpha_track.key_count, t)
			var f := Curves.segment_fraction(alpha_track, i, t)
			var lane := (slot_index * Pose.SLOT_COLOR_STRIDE) + 3
			var sampled := Curves.segment_component(alpha_track, i, f, 0)
			slot_color[lane] = (
				_blend_add_linear(slot_color[lane], slot_setup_color[lane], sampled, alpha)
				if additive
				else _blend_replace_linear(slot_color[lane], sampled, alpha)
			)

		# Keyable two-color dark tint (ADR-0009 section 4.3): blends into the pose's dark-color lane like the
		# RGBA color, over the setup dark tint. Renderers read slot_dark_color for the two-color draw.
		var dark = channels.dark
		if dark != null:
			var i := Curves.find_segment_index(dark.times, dark.key_count, t)
			var f := Curves.segment_fraction(dark, i, t)
			var base_dark := slot_index * Pose.SLOT_COLOR_STRIDE
			for k in range(Pose.SLOT_COLOR_STRIDE):
				var sampled := Curves.segment_component(dark, i, f, k)
				slot_dark_color[base_dark + k] = (
					_blend_add_linear(slot_dark_color[base_dark + k], slot_setup_dark_color[base_dark + k], sampled, alpha)
					if additive
					else _blend_replace_linear(slot_dark_color[base_dark + k], sampled, alpha)
				)

		var attachment = channels.attachment
		if attachment != null and discrete_wins and alpha >= slot_attachment_win_weight[slot_index]:
			slot_attachment[slot_index] = Curves.sample_attachment_name(attachment, t)
			slot_attachment_win_weight[slot_index] = alpha


static func _apply_constraint_entry(pose: Pose, prepared: Prepared.PreparedAnimation, t: float, alpha: float, additive: bool, discrete_wins: bool) -> void:
	var ik_channels := prepared.ik_channels
	var transform_channels := prepared.transform_channels
	var path_channels := prepared.path_channels
	var physics_channels := prepared.physics_channels
	var ik_constraints := pose.ik_constraints
	var transform_constraints := pose.transform_constraints
	var path_constraints := pose.path_constraints
	var physics_constraints := pose.physics_constraints
	var ik_bend_win_weight := pose.ik_bend_win_weight
	var ik_stretch_win_weight := pose.ik_stretch_win_weight
	var ik_compress_win_weight := pose.ik_compress_win_weight

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
		# softness blends like mix (a continuous world-unit distance); a negative additive result is floored
		# at 0 to keep the non-negative contract the solve's soft-reach remap relies on.
		if channel.softness != null:
			var value := _sample_scalar_track(channel.softness, t)
			var blended := (
				_blend_add_linear(constraint.sampled_softness, constraint.base_softness, value, alpha)
				if additive
				else _blend_replace_linear(constraint.sampled_softness, value, alpha)
			)
			constraint.sampled_softness = 0.0 if blended < 0.0 else blended
		if channel.bend_positive != null and discrete_wins and alpha >= ik_bend_win_weight[index]:
			constraint.sampled_bend_positive = Curves.sample_step_bool(channel.bend_positive, t)
			ik_bend_win_weight[index] = alpha
		# stretch/compress are discrete flags: the track with the greatest alpha this frame wins (ADR-0005
		# rule 5), exactly like the bend direction, each with its own per-constraint win weight.
		if channel.stretch != null and discrete_wins and alpha >= ik_stretch_win_weight[index]:
			constraint.sampled_stretch = Curves.sample_step_bool(channel.stretch, t)
			ik_stretch_win_weight[index] = alpha
		if channel.compress != null and discrete_wins and alpha >= ik_compress_win_weight[index]:
			constraint.sampled_compress = Curves.sample_step_bool(channel.compress, t)
			ik_compress_win_weight[index] = alpha

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

	# Path constraints (ADR-0011 section 3, ADR-0013): each channel is a continuous interpolated scalar
	# blended toward its keyed value by alpha (additive adds the delta from the constraint base), exactly like
	# the transform mix channels. position/spacing are unbounded; the mix channels are [0, 1] by the format,
	# so no extra clamp is applied here (the base and keyed values are in range).
	for c in range(path_channels.size()):
		var channel = path_channels[c]
		var index: int = channel.constraint_index
		if index < 0:
			continue
		var constraint = path_constraints[index]
		if channel.position != null:
			constraint.sampled_position = _blend_mix(constraint.sampled_position, constraint.base_position, channel.position, t, alpha, additive)
		if channel.spacing != null:
			constraint.sampled_spacing = _blend_mix(constraint.sampled_spacing, constraint.base_spacing, channel.spacing, t, alpha, additive)
		if channel.mix_rotate != null:
			constraint.sampled_mix_rotate = _blend_mix(constraint.sampled_mix_rotate, constraint.base_mix_rotate, channel.mix_rotate, t, alpha, additive)
		if channel.mix_x != null:
			constraint.sampled_mix_x = _blend_mix(constraint.sampled_mix_x, constraint.base_mix_x, channel.mix_x, t, alpha, additive)
		if channel.mix_y != null:
			constraint.sampled_mix_y = _blend_mix(constraint.sampled_mix_y, constraint.base_mix_y, channel.mix_y, t, alpha, additive)

	# Physics constraints (ADR-0014 section 7): each keyable knob is a continuous interpolated scalar blended
	# toward its keyed value by alpha (additive adds the delta from the constraint base), exactly like the
	# transform/path channels. mix/inertia/damping are [0, 1] and strength >= 0 by the format, so no extra clamp
	# is applied here (the base and keyed values are in range; the solve clamps the mix PRODUCT anyway).
	for c in range(physics_channels.size()):
		var channel = physics_channels[c]
		var index: int = channel.constraint_index
		if index < 0:
			continue
		var constraint = physics_constraints[index]
		if channel.mix != null:
			constraint.sampled_mix = _blend_mix(constraint.sampled_mix, constraint.base_mix, channel.mix, t, alpha, additive)
		if channel.inertia != null:
			constraint.sampled_inertia = _blend_mix(constraint.sampled_inertia, constraint.base_inertia, channel.inertia, t, alpha, additive)
		if channel.strength != null:
			constraint.sampled_strength = _blend_mix(constraint.sampled_strength, constraint.base_strength, channel.strength, t, alpha, additive)
		if channel.damping != null:
			constraint.sampled_damping = _blend_mix(constraint.sampled_damping, constraint.base_damping, channel.damping, t, alpha, additive)
		if channel.wind != null:
			constraint.sampled_wind = _blend_mix(constraint.sampled_wind, constraint.base_wind, channel.wind, t, alpha, additive)
		if channel.gravity != null:
			constraint.sampled_gravity = _blend_mix(constraint.sampled_gravity, constraint.base_gravity, channel.gravity, t, alpha, additive)


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
		# Per-component split scalar tracks (ADR-0009 section 4.1): each null when absent/empty.
		channels.translate_x = Curves.build_component_track(timelines.translate_x) if _has_keys(timelines.translate_x) else null
		channels.translate_y = Curves.build_component_track(timelines.translate_y) if _has_keys(timelines.translate_y) else null
		channels.scale_x = Curves.build_component_track(timelines.scale_x) if _has_keys(timelines.scale_x) else null
		channels.scale_y = Curves.build_component_track(timelines.scale_y) if _has_keys(timelines.scale_y) else null
		channels.shear_x = Curves.build_component_track(timelines.shear_x) if _has_keys(timelines.shear_x) else null
		channels.shear_y = Curves.build_component_track(timelines.shear_y) if _has_keys(timelines.shear_y) else null
		result.bone_channels.append(channels)

	for slot_name in animation.slots:
		var timelines = animation.slots[slot_name]
		var channels := Prepared.PreparedSlotChannels.new()
		channels.slot_index = _lookup(slot_index_by_name, slot_name)
		channels.color = Curves.build_color_track(timelines.color) if _has_keys(timelines.color) else null
		channels.attachment = Curves.build_attachment_track(timelines.attachment) if _has_keys(timelines.attachment) else null
		# Split color (ADR-0009 section 4.2): rgb 3-lane, alpha 1-lane; dark (section 4.3) is a 4-lane RGBA
		# track built with the existing color-track builder.
		channels.rgb = Curves.build_rgb_track(timelines.rgb) if _has_keys(timelines.rgb) else null
		channels.alpha = Curves.build_alpha_track(timelines.alpha) if _has_keys(timelines.alpha) else null
		channels.dark = Curves.build_color_track(timelines.dark) if _has_keys(timelines.dark) else null
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
		channel.softness = Curves.build_ik_softness_track(frames)
		channel.stretch = Curves.build_ik_depth_bool_track(frames, Curves.IkDepthChannel.STRETCH)
		channel.compress = Curves.build_ik_depth_bool_track(frames, Curves.IkDepthChannel.COMPRESS)
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

	# Path-constraint timelines (ADR-0011 section 3, ADR-0013). Each channel is prepared from only the frames
	# that key it; an all-absent channel is null and holds the constraint base.
	var path_index_by_name := _name_index_of(pose.path_constraints)
	for pc_name in animation.path:
		var frames = animation.path[pc_name]
		if frames.size() == 0:
			continue
		var channel := Prepared.PreparedPathChannel.new()
		channel.constraint_index = _lookup(path_index_by_name, pc_name)
		channel.position = Curves.build_path_track(frames, Curves.PathChannel.POSITION)
		channel.spacing = Curves.build_path_track(frames, Curves.PathChannel.SPACING)
		channel.mix_rotate = Curves.build_path_track(frames, Curves.PathChannel.MIX_ROTATE)
		channel.mix_x = Curves.build_path_track(frames, Curves.PathChannel.MIX_X)
		channel.mix_y = Curves.build_path_track(frames, Curves.PathChannel.MIX_Y)
		result.path_channels.append(channel)

	# Physics-constraint timelines (ADR-0014 section 7). Each keyable knob is prepared from only the frames that
	# key it; an all-absent knob is null and holds the constraint base. step/mass/channels are NOT keyable and
	# never appear here.
	var physics_index_by_name := _name_index_of(pose.physics_constraints)
	for phys_name in animation.physics:
		var frames = animation.physics[phys_name]
		if frames.size() == 0:
			continue
		var channel := Prepared.PreparedPhysicsChannel.new()
		channel.constraint_index = _lookup(physics_index_by_name, phys_name)
		channel.mix = Curves.build_physics_track(frames, Curves.PhysicsChannel.MIX)
		channel.inertia = Curves.build_physics_track(frames, Curves.PhysicsChannel.INERTIA)
		channel.strength = Curves.build_physics_track(frames, Curves.PhysicsChannel.STRENGTH)
		channel.damping = Curves.build_physics_track(frames, Curves.PhysicsChannel.DAMPING)
		channel.wind = Curves.build_physics_track(frames, Curves.PhysicsChannel.WIND)
		channel.gravity = Curves.build_physics_track(frames, Curves.PhysicsChannel.GRAVITY)
		result.physics_channels.append(channel)

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
