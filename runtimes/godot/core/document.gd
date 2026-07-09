extends RefCounted
# The subset of the SkeletonDocument model the GDScript solve needs to reproduce the nine committed
# conformance rigs (mirrors runtimes/unity Document.cs and the fields runtime-core reads from
# @marionette/format/types). It is NOT a general validator (that boundary is the format package's job in
# TS). Ordered maps use Godot Dictionaries, which preserve insertion order, so every place the TS solve
# iterates Object.keys() in insertion order (animation channels, skin attachments, deform triples) the
# port iterates identically.

enum CurveKind { LINEAR, STEPPED, BEZIER }


# Named TimelineCurve (not Curve) because Curve is a native Godot class and an inner class may not hide it.
class TimelineCurve:
	var kind: int
	var cx1: float
	var cy1: float
	var cx2: float
	var cy2: float

	func _init(k: int, x1: float, y1: float, x2: float, y2: float) -> void:
		kind = k
		cx1 = x1
		cy1 = y1
		cx2 = x2
		cy2 = y2

	static func linear() -> TimelineCurve:
		return TimelineCurve.new(CurveKind.LINEAR, 0.0, 0.0, 0.0, 0.0)


class Rgba:
	var r: float
	var g: float
	var b: float
	var a: float

	func _init(red: float, green: float, blue: float, alpha: float) -> void:
		r = red
		g = green
		b = blue
		a = alpha


class Bone:
	var name: String
	# parent bone name (String) or null for a root bone.
	var parent = null
	var length: float
	var x: float
	var y: float
	var rotation: float
	var scale_x: float
	var scale_y: float
	var shear_x: float
	var shear_y: float
	var transform_mode: String


class Slot:
	var name: String
	var slot_bone: String
	var color: Rgba
	# active setup attachment name (String) or null.
	var attachment = null
	# Static per slot blend mode (solve order step 6); the fixture asserts it EXACTLY. Defaults to
	# "normal" when the rig omits the field (pre PP-B1 slots).
	var blend_mode: String = "normal"


class MeshAttachment:
	# The flat uv stream [u0, v0, ...]: its length / 2 is the logical vertex count.
	var uvs: PackedFloat64Array
	# The self delimiting vertex stream (ADR-0002). Unweighted: a flat [x0, y0, ...] setup stream.
	# Weighted: each logical vertex starts with its influence count, then [globalBoneIndex, vx, vy,
	# weight] per influence.
	var vertices: PackedFloat64Array
	# Present (and non empty) marks the mesh weighted; the values are unused by the skin solve (the
	# vertex stream carries global bone indices directly), so this is only the weighted flag. null or an
	# empty array means unweighted.
	var bones = null


class Attachment:
	var type: String
	var mesh = null  # MeshAttachment or null
	# Linked-mesh fields (ADR-0011 section 1), present only when type == "linkedmesh". A linked mesh has
	# no geometry of its own: it reuses a parent mesh's geometry (uvs/triangles/vertices/weights) and,
	# depending on `timelines`, either its own deform or the shared parent's. `linked_parent` names the
	# parent attachment on the SAME slot in skin `linked_skin ?? this skin`; `timelines` false = own
	# deform, true = share the parent's.
	var linked_parent = null  # String or null
	var linked_skin = null  # String or null (skin override for the parent lookup)
	var timelines: bool = false
	# Sequence-attachment block (ADR-0009 section 3, ADR-0011 section 2), present only on a region or mesh
	# attachment that names a frame sequence. A Dictionary { "count", "start", "digits", "setupIndex" } or
	# null. The solve reads count + setupIndex to resolve a discrete frame; start/digits are render-only
	# (atlas region naming) and carried for completeness.
	var sequence = null


# Named SkinDef (not Skin) because Skin is a native Godot class.
class SkinDef:
	var name: String
	# slot name -> (attachment name -> Attachment). Both levels preserve insertion order.
	var attachments: Dictionary = {}


class IkConstraint:
	var name: String
	var bones: PackedStringArray
	var target: String
	var mix: float
	var bend_positive: bool
	# Depth controls (ADR-0009 section 1.1, ADR-0010 section 2). softness is a non-negative world-unit
	# distance; stretch/compress/uniform are booleans. Defaults (softness 0, all false) reproduce the
	# ADR-0003 hard solve exactly.
	var softness: float = 0.0
	var stretch: bool = false
	var compress: bool = false
	var uniform: bool = false
	# The explicit combined-set solve order (ADR-0009 section 1.3), or -1 when this constraint carries none.
	var order: int = -1


class TransformConstraint:
	var name: String
	var bones: PackedStringArray
	var target: String
	var mix_rotate: float
	var mix_x: float
	var mix_y: float
	var mix_scale_x: float
	var mix_scale_y: float
	var mix_shear_y: float
	var offset_rotation: float
	var offset_x: float
	var offset_y: float
	var offset_scale_x: float
	var offset_scale_y: float
	var offset_shear_y: float
	# The local/relative variant flags (ADR-0009 section 1.2). Default false/false reproduces the ADR-0003
	# world-space absolute blend; the variant solve is a later PP-B5 slice (ADR-0010 section 3).
	var local: bool = false
	var relative: bool = false
	# The explicit combined-set solve order (ADR-0009 section 1.3), or -1 when this constraint carries none.
	var order: int = -1


class ScalarKeyframe:
	var time: float
	var value: float
	var curve: TimelineCurve


class Vec2Keyframe:
	var time: float
	var x: float
	var y: float
	var curve: TimelineCurve


class ColorKeyframe:
	var time: float
	var color: Rgba
	var curve: TimelineCurve


class AttachmentKeyframe:
	var time: float
	var name = null  # attachment name (String) or null


# A sequence timeline keyframe (ADR-0009 section 3): at `time`, play the attachment's frame sequence from
# frame `index` in `mode` at `delay` seconds per frame. Discrete (no curve); key times are strict-ascending.
class SequenceKeyframe:
	var time: float
	var mode: String
	var index: int
	var delay: float


class IkKeyframe:
	var time: float
	var mix: float
	var bend_positive: bool
	var curve: TimelineCurve
	# Optional keyable depth channels (ADR-0009 section 1.1, ADR-0010 section 2.4). null == not keyed by
	# this frame, so only the frames that key a channel drive its prepared track (the constraint base holds
	# otherwise). softness is a float or null; stretch/compress are bool or null.
	var softness = null
	var stretch = null
	var compress = null


class TransformKeyframe:
	var time: float
	var curve: TimelineCurve
	# Present channels only (null == absent from this keyframe, which the mix track build honors by
	# dropping the channel so the constraint base holds).
	var mix_rotate = null
	var mix_x = null
	var mix_y = null
	var mix_scale_x = null
	var mix_scale_y = null
	var mix_shear_y = null


class DeformKeyframe:
	var time: float
	var offsets: PackedFloat64Array
	var curve: TimelineCurve


class BoneTimelines:
	var rotate = null  # Array[ScalarKeyframe] or null
	var translate = null  # Array[Vec2Keyframe] or null
	var scale = null  # Array[Vec2Keyframe] or null
	var shear = null  # Array[Vec2Keyframe] or null


class SlotTimelines:
	var color = null  # Array[ColorKeyframe] or null
	var attachment = null  # Array[AttachmentKeyframe] or null
	var sequence = null  # Array[SequenceKeyframe] or null


class DeformEntry:
	var skin: String
	var slot: String
	var attachment: String
	var frames: Array  # Array[DeformKeyframe]


# A draw-order offset entry (ADR-0008 section 3): move one named slot by a signed integer number of
# render positions from its setup index. Mirrors DrawOrderOffset in @marionette/format.
class DrawOrderOffset:
	var slot: String
	var offset: int


# A draw-order keyframe (ADR-0008 section 3): at time, apply a compact list of per-slot offsets to the
# setup draw order. An empty offsets list means the setup order (identity). Stepped (no curve).
class DrawOrderKeyframe:
	var time: float
	var offsets: Array  # Array[DrawOrderOffset]


# An event keyframe (ADR-0008 section 2): fires the named event at time, optionally overriding the
# event's int/float/string payload defaults. Discrete (no curve). A null payload member means "not
# overridden" (the EventDef default holds); payload resolution happens at prepare time.
class EventKeyframe:
	var time: float
	var name: String
	var int_value = null  # int or null
	var float_value = null  # float or null
	var string_value = null  # String or null


# A named event definition (ADR-0008 section 1): the payload defaults an event carries when fired. The
# audio hint is not part of the solve, so the reader keeps only the payload fields (name + defaults).
class EventDef:
	var name: String
	var int_value = null  # int or null
	var float_value = null  # float or null
	var string_value = null  # String or null


# Named AnimationDef (not Animation) because Animation is a native Godot class.
class AnimationDef:
	var duration: float
	var bones: Dictionary = {}  # bone name -> BoneTimelines
	var slots: Dictionary = {}  # slot name -> SlotTimelines
	var ik: Dictionary = {}  # ik constraint name -> Array[IkKeyframe]
	var transform: Dictionary = {}  # transform constraint name -> Array[TransformKeyframe]
	var deform: Array = []  # Array[DeformEntry], nested skin/slot/attachment order preserved
	var draw_order: Array = []  # Array[DrawOrderKeyframe], ascending time
	var events: Array = []  # Array[EventKeyframe], non-decreasing time


class SkeletonDocument:
	var bones: Array = []  # Array[Bone]
	var slots: Array = []  # Array[Slot]
	var skins: Array = []  # Array[Skin]
	var ik_constraints: Array = []  # Array[IkConstraint]
	var transform_constraints: Array = []  # Array[TransformConstraint]
	var events: Array = []  # Array[EventDef], the document-level event payload defaults
	var animations: Dictionary = {}  # animation id -> Animation

	func find_animation(id: String):
		return animations.get(id, null)
