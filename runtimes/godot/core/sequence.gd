extends RefCounted
# Sequence-attachment frame resolution (ADR-0009 section 3, ADR-0011 section 2). Mirrors
# packages/runtime-core/src/skeleton/sequence.ts. A region or mesh attachment may carry a `sequence` block
# (count frames, a setup frame, a naming template); a per-slot `sequence` timeline then drives which frame
# is shown over time, in one of seven playback modes. The resolved frame is a DISCRETE integer in
# [0, count), computed by pure integer arithmetic so all three runtimes agree EXACTLY (no float tolerance).
# This file resolves the integer frame; turning it into an atlas region name (path + zero-padded start +
# frame) is a renderer concern, not a solve concern.

const Document = preload("res://core/document.gd")


# Non-negative modulo. GDScript integer `%` (like JavaScript) keeps the sign of the dividend; sequence
# wrapping needs a non-negative residue for the reverse modes where `index - advanced` can go negative.
static func _mod(value: int, n: int) -> int:
	return ((value % n) + n) % n


# Triangle wave over [0, count-1] with period 2*(count-1): 0,1,...,count-1,count-2,...,1,0,1,... It maps a
# monotonically advancing position onto a bouncing frame index (pingpong). Symmetric, so feeding it a
# descending position (index - advanced) yields the reverse-direction bounce (pingpongReverse).
static func _triangle(position: int, count: int) -> int:
	var period := 2 * (count - 1)
	var m := _mod(position, period)
	return m if m <= count - 1 else period - m


# Resolve the frame index for an active sequence key. `elapsed` is time since the key (>= 0), `delay` is
# seconds per frame, `index` the key's starting frame, `count` the sequence length. A non-positive delay
# (or count 1) advances no frames (holds). Every branch returns an integer in [0, count).
static func resolve_sequence_frame(mode: String, index: int, delay: float, count: int, elapsed: float) -> int:
	if count <= 1:
		return 0
	var last := count - 1
	var advanced := int(floor(elapsed / delay)) if delay > 0.0 and elapsed > 0.0 else 0
	match mode:
		"hold":
			return clampi(index, 0, last)
		"once":
			return mini(index + advanced, last)
		"loop":
			return _mod(index + advanced, count)
		"pingpong":
			return _triangle(index + advanced, count)
		"onceReverse":
			return maxi(index - advanced, 0)
		"loopReverse":
			return _mod(index - advanced, count)
		"pingpongReverse":
			return _triangle(index - advanced, count)
	return 0


# The `sequence` block (count + setup frame) of the slot's ACTIVE attachment, searched across skins. A
# region or mesh attachment may carry it; the first attachment named `attachment_name` under `slot_name`
# that has a sequence wins (conformance rigs define it in one skin). Null when the active attachment has no
# sequence block.
static func _find_sequence_block(document, slot_name: String, attachment_name: String):
	for skin in document.skins:
		var per_slot = skin.attachments.get(slot_name)
		if per_slot == null:
			continue
		var attachment = per_slot.get(attachment_name)
		if attachment == null:
			continue
		if attachment.type == "region" or attachment.type == "mesh":
			if attachment.sequence != null:
				return attachment.sequence
	return null


# Resolve the discrete sequence FRAME INDEX for a slot at time t. Reuses a pose already solved by
# sample_skeleton (it reads the slot's resolved active attachment). Returns -1 when the slot has no active
# sequence attachment (nothing to resolve); the attachment's setup_index when the slot has a sequence
# attachment but no active timeline key at t (before the first key, or no `sequence` timeline); otherwise
# the mode-resolved frame from the active key. Allocation-free: a linear scan of the (short) key list.
static func sample_slot_sequence_frame(document, animation_id: String, t: float, pose, slot_name: String) -> int:
	var slot_index: int = pose.slot_names.find(slot_name)
	if slot_index < 0:
		return -1
	var attachment_name = pose.slot_attachment[slot_index]
	if attachment_name == null:
		return -1

	var block = _find_sequence_block(document, slot_name, attachment_name)
	if block == null:
		return -1

	var animation = document.find_animation(animation_id)
	# find_animation returning null mirrors TS AnimationNotFoundError; the harness always samples an existing
	# animation, so treat the can't-happen case as "no sequence timeline" (the attachment's setup frame).
	if animation == null:
		return int(block.get("setupIndex"))
	var timelines = animation.slots.get(slot_name)
	var timeline = null if timelines == null else timelines.sequence
	if timeline == null or timeline.size() == 0:
		return int(block.get("setupIndex"))

	# The active key is the last one whose time is at or before t (keys are strict-ascending). Before the
	# first key the sequence shows its setup frame.
	var active = null
	for key in timeline:
		if key.time <= t:
			active = key
		else:
			break
	if active == null:
		return int(block.get("setupIndex"))
	return resolve_sequence_frame(active.mode, active.index, active.delay, int(block.get("count")), t - active.time)
