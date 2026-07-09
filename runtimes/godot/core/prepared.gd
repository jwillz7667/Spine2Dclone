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


class PreparedSlotChannels:
	var slot_index: int
	var color = null  # PreparedTrack or null
	var attachment = null  # PreparedAttachmentTrack or null


class PreparedIkChannel:
	var constraint_index: int
	var mix = null  # PreparedTrack or null
	var bend_positive = null  # PreparedStepBoolTrack or null


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


class PreparedAnimation:
	var bone_channels: Array = []  # Array[PreparedBoneChannels]
	var slot_channels: Array = []  # Array[PreparedSlotChannels]
	var ik_channels: Array = []  # Array[PreparedIkChannel]
	var transform_channels: Array = []  # Array[PreparedTransformChannel]
	var deform_channels: Array = []  # Array[PreparedDeformChannel]
