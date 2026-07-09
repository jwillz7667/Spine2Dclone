extends RefCounted
# Solve side, prebuilt representation of a format Animation (mirrors
# packages/runtime-core/src/skeleton/prepared.ts and runtimes/unity Prepared.cs). These types carry no
# logic: per track build and evaluation live in curve.gd, per skeleton assembly in sample.gd. They exist
# so per frame sampling walks flat arrays and so bezier control points become a sampled lookup table
# ONCE on build.

# One eased track: key_count keys, component_count lanes per key. curve_kinds[i] is 0 linear, 1 stepped,
# 2 bezier; bezier_base[i] is the first lane of key i's sampled bezier (x, y) table in bezier_table, or
# -1 when key i is not bezier eased.
class PreparedTrack:
	var key_count: int
	var component_count: int
	var times: PackedFloat64Array
	var values: PackedFloat64Array
	var curve_kinds: PackedByteArray
	var bezier_base: PackedInt32Array
	var bezier_table: PackedFloat64Array


class PreparedAttachmentTrack:
	var key_count: int
	var times: PackedFloat64Array
	var names: Array  # Array of (String or null)


class PreparedStepBoolTrack:
	var key_count: int
	var times: PackedFloat64Array
	var values: PackedByteArray


class PreparedBoneChannels:
	var bone_index: int
	var rotate = null  # PreparedTrack or null
	var translate = null
	var scale = null
	var shear = null
	# Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3). Each is a single-lane scalar
	# track for one component. The format forbids a joint channel and its split components coexisting on one
	# bone (TIMELINE_COMPONENT_CONFLICT), so at most one of {translate} / {translate_x, translate_y} is
	# non-null (and likewise scale, shear); applying all present tracks is therefore unambiguous.
	var translate_x = null  # PreparedTrack or null
	var translate_y = null
	var scale_x = null
	var scale_y = null
	var shear_x = null
	var shear_y = null


class PreparedSlotChannels:
	var slot_index: int
	var color = null  # PreparedTrack or null
	var attachment = null  # PreparedAttachmentTrack or null
	# Split color tracks (ADR-0009 section 4.2): rgb is a 3-lane track, alpha a 1-lane track. The joint color
	# (RGBA) and the split rgb/alpha must not coexist on one slot (TIMELINE_COMPONENT_CONFLICT), so at most
	# one form is non-null. The keyable two-color dark tint (ADR-0009 section 4.3, RGBA) is independent and
	# blends into the pose's dark-color lane.
	var rgb = null  # PreparedTrack or null
	var alpha = null  # PreparedTrack or null
	var dark = null  # PreparedTrack or null


class PreparedIkChannel:
	var constraint_index: int
	var mix = null  # PreparedTrack or null
	var bend_positive = null  # PreparedStepBoolTrack or null
	# Optional keyable depth channels (ADR-0009 section 1.1, ADR-0010 section 2.4), each built from ONLY the
	# frames that key it (null when no frame does, so the constraint base holds). softness interpolates by
	# its curve like mix; stretch/compress are stepped booleans resolved by greater-weight-wins like bend.
	var softness = null  # PreparedTrack or null
	var stretch = null  # PreparedStepBoolTrack or null
	var compress = null  # PreparedStepBoolTrack or null


class PreparedTransformChannel:
	var constraint_index: int
	var mix_rotate = null  # PreparedTrack or null
	var mix_x = null
	var mix_y = null
	var mix_scale_x = null
	var mix_scale_y = null
	var mix_shear_y = null


class PreparedDeformChannel:
	var skin: String
	var slot: String
	var attachment: String
	var track: PreparedTrack


# A prepared per-animation draw-order timeline (ADR-0008 section 3, PP-B4). Each key's compact
# {slot, offset} list is DERIVED ONCE at build time into a FULL render-order permutation orders[k],
# where orders[k][render_position] = slot_index (render_position 0 furthest back). An empty offsets list
# resolves to the identity (setup order). times is strictly ascending; the active key at time t is the
# latest key at or before t (stepped), or none when t is below the first key. Mirrors
# PreparedDrawOrderTimeline in prepared.ts.
class PreparedDrawOrderTimeline:
	var key_count: int
	var times: PackedFloat64Array
	var orders: Array  # Array[PackedInt32Array]


# A prepared per-animation event timeline (ADR-0008 section 2, PP-B4). Events are discrete, so there is
# no curve. Each key's payload is RESOLVED ONCE at build time (the EventDef default overridden by the
# key's own int/float/string) into parallel value + presence lanes. times is NON-DECREASING; coincident
# keys keep their timeline order. Mirrors PreparedEventTimeline in prepared.ts.
class PreparedEventTimeline:
	var key_count: int
	var times: PackedFloat64Array
	var names: Array  # Array[String]
	var int_values: PackedFloat64Array
	var has_int: PackedByteArray
	var float_values: PackedFloat64Array
	var has_float: PackedByteArray
	var string_values: Array  # Array of (String or null)
	var has_string: PackedByteArray


class PreparedAnimation:
	var bone_channels: Array = []  # Array[PreparedBoneChannels]
	var slot_channels: Array = []  # Array[PreparedSlotChannels]
	var ik_channels: Array = []  # Array[PreparedIkChannel]
	var transform_channels: Array = []  # Array[PreparedTransformChannel]
	var deform_channels: Array = []  # Array[PreparedDeformChannel]
	# The draw-order reorder timeline (ADR-0008), or null when this animation never reorders. Applied in
	# step 2 as a discrete greater-weight-wins channel. Event firing is NOT part of PreparedAnimation (it
	# is a time-RANGE operation, not an instantaneous pose sample) and lives in event_fire.gd.
	var draw_order = null  # PreparedDrawOrderTimeline or null
