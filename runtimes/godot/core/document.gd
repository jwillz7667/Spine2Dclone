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


class IkKeyframe:
	var time: float
	var mix: float
	var bend_positive: bool
	var curve: TimelineCurve


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


class DeformEntry:
	var skin: String
	var slot: String
	var attachment: String
	var frames: Array  # Array[DeformKeyframe]


# Named AnimationDef (not Animation) because Animation is a native Godot class.
class AnimationDef:
	var duration: float
	var bones: Dictionary = {}  # bone name -> BoneTimelines
	var slots: Dictionary = {}  # slot name -> SlotTimelines
	var ik: Dictionary = {}  # ik constraint name -> Array[IkKeyframe]
	var transform: Dictionary = {}  # transform constraint name -> Array[TransformKeyframe]
	var deform: Array = []  # Array[DeformEntry], nested skin/slot/attachment order preserved


class SkeletonDocument:
	var bones: Array = []  # Array[Bone]
	var slots: Array = []  # Array[Slot]
	var skins: Array = []  # Array[Skin]
	var ik_constraints: Array = []  # Array[IkConstraint]
	var transform_constraints: Array = []  # Array[TransformConstraint]
	var animations: Dictionary = {}  # animation id -> Animation

	func find_animation(id: String):
		return animations.get(id, null)
