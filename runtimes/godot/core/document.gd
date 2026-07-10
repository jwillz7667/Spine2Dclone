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
	# The setup two-color DARK tint (ADR-0009 section 4.3), an Rgba or null. Present only when the slot
	# enables two-color tinting; null means no dark tint (an inert (0, 0, 0, 1) reset, renderers skip it).
	var dark_color = null  # Rgba or null
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
	# Non-drawing geometry attachments (ADR-0012, PP-B2). Present only for the matching `type`.
	# clipping: the name of the slot at which clipping ENDS plus the flat LOCAL polygon [x0, y0, ...].
	var clip_end = null  # String or null (type == "clipping")
	var clip_vertices = null  # PackedFloat64Array or null (type == "clipping")
	# boundingbox: the flat LOCAL polygon [x0, y0, ...] used for hit testing (no drawing).
	var box_vertices = null  # PackedFloat64Array or null (type == "boundingbox")
	# point: a single LOCAL (x, y, rotation) anchor (rotation in degrees). type == "point".
	var point_x: float = 0.0
	var point_y: float = 0.0
	var point_rotation: float = 0.0
	# Path attachment fields (ADR-0011 section 1, ADR-0013 PP-B6), present only when type == "path". A path
	# is a piecewise cubic Bezier spline rail. `path_closed` selects a looped vs open spline; `path_constant_
	# speed` selects arc-length reparametrization; `path_lengths` is the committed cumulative per-curve
	# arc-length table; `path_vertices` is the SAME weighted/unweighted control-point stream a mesh uses
	# (ADR-0002 codec, unweighted flat [x0, y0, ...] or the self-delimiting weighted stream); `path_bones`
	# (present and non-empty means weighted) is the ascending referenced-bone manifest.
	var path_closed: bool = false
	var path_constant_speed: bool = false
	var path_lengths = null  # PackedFloat64Array or null (type == "path")
	var path_vertices = null  # PackedFloat64Array or null (type == "path")
	var path_bones = null  # PackedInt32Array or null (weighted manifest; null/empty == unweighted)


# Named SkinDef (not Skin) because Skin is a native Godot class.
class SkinDef:
	var name: String
	# slot name -> (attachment name -> Attachment). Both levels preserve insertion order.
	var attachments: Dictionary = {}
	# The names of the constraints this skin SCOPES (ADR-0009 section 5, ADR-0011 section 4). A constraint
	# listed here is active only while this skin is active; a constraint in no skin's list is unscoped
	# (always active). PackedStringArray, empty when the skin scopes no constraint. The `bones` list is a
	# pure-data render concern with no transform-solve effect (ADR-0011 section 4), so it is not read here.
	var constraints: PackedStringArray = PackedStringArray()


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


# A path constraint (ADR-0011 section 2, ADR-0013 PP-B6): distributes and orients a non-empty list of
# `bones` along the path attachment carried by the target SLOT (not a bone; a path lives on a slot). The
# mode strings are closed enums (positionMode fixed/percent, spacingMode length/fixed/percent/proportional,
# rotateMode tangent/chain/chainScale). position/spacing/offsetRotation are unbounded; mixRotate/mixX/mixY
# are the three [0, 1] blend channels (a path constraint writes rotation and x/y translation only).
class PathConstraint:
	var name: String
	var target: String  # the target SLOT name (the path lives on a slot)
	var bones: PackedStringArray
	var position_mode: String
	var spacing_mode: String
	var rotate_mode: String
	var position: float
	var spacing: float
	var offset_rotation: float
	var mix_rotate: float
	var mix_x: float
	var mix_y: float
	# The explicit combined-set solve order (ADR-0011 section 2.3), or -1 when this constraint carries none.
	var order: int = -1


# A physics constraint (ADR-0014 section 1, PP-B7): binds ONE `bone` and simulates a subset of its LOCAL
# `channels` (each of "x", "y", "rotation", "scaleX", "shearX") as independent damped-driven springs. `step`
# is the fixed integration timestep (the determinism anchor) and `mass` the inertial mass; both are STATIC
# (not keyable). inertia/strength/damping/wind/gravity/mix are the keyable knobs. The mode/channel set is a
# closed enum the solve keys on; the referential checks are the TS validator's job (run before commit).
class PhysicsConstraint:
	var name: String
	var bone: String
	var channels: PackedStringArray
	var step: float
	var inertia: float
	var strength: float
	var damping: float
	var mass: float
	var wind: float
	var gravity: float
	var mix: float
	# The explicit combined-set solve order (ADR-0014 section 4), or -1 when this constraint carries none.
	var order: int = -1


# The skeleton-level physics settings block (ADR-0014 section 5): global gravity/wind ADDED to each physics
# constraint and a master mix MULTIPLIED into each constraint's mix. Absent from the document => the identity
# defaults (0, 0, 1), applied in build_pose.
class PhysicsSettings:
	var gravity: float
	var wind: float
	var mix: float

	func _init(the_gravity: float, the_wind: float, the_mix: float) -> void:
		gravity = the_gravity
		wind = the_wind
		mix = the_mix


# A keyed physics-constraint frame (ADR-0014 section 7): a PARTIAL record of the physics constraint's KEYABLE
# knobs (mix/inertia/strength/damping/wind/gravity). A frame MAY key any subset; null == not keyed by this
# frame, so only the frames that key a channel drive its prepared track (the constraint base holds otherwise),
# exactly like the path/transform keyframe channels. step/mass/channels are NOT keyable and never appear here.
class PhysicsKeyframe:
	var time: float
	var curve: TimelineCurve
	var mix = null
	var inertia = null
	var strength = null
	var damping = null
	var wind = null
	var gravity = null


# A keyed path-constraint frame (ADR-0011 section 3, ADR-0013): a PARTIAL record of the path constraint's
# animatable channels (position/spacing along the path, and the three mix blend factors). A frame MAY key
# any subset; null == not keyed by this frame, so only the frames that key a channel drive its prepared
# track (the constraint base holds otherwise), exactly like the transform keyframe channels.
class PathKeyframe:
	var time: float
	var curve: TimelineCurve
	var position = null
	var spacing = null
	var mix_rotate = null
	var mix_x = null
	var mix_y = null


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


# A split rgb slot-color keyframe (ADR-0009 section 4.2): three channels read from a { rgb: {r, g, b} }
# value. Alpha rides the separate alpha timeline (a ScalarKeyframe), so this carries no alpha.
class RgbKeyframe:
	var time: float
	var r: float
	var g: float
	var b: float
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
	# Per-component split scalar timelines (ADR-0009 section 4.1, ADR-0011 section 3). Each is an
	# Array[ScalarKeyframe] (a single { value } lane) or null. Never coexist with the joint channel above.
	var translate_x = null  # Array[ScalarKeyframe] or null
	var translate_y = null
	var scale_x = null
	var scale_y = null
	var shear_x = null
	var shear_y = null


class SlotTimelines:
	var color = null  # Array[ColorKeyframe] or null
	var attachment = null  # Array[AttachmentKeyframe] or null
	var sequence = null  # Array[SequenceKeyframe] or null
	# Split color timelines (ADR-0009 section 4.2): rgb is an Array[RgbKeyframe], alpha an Array[ScalarKeyframe]
	# (a single { alpha } lane); at most one of {color} / {rgb, alpha} is non-null. The keyable two-color dark
	# tint (ADR-0009 section 4.3) is an Array[ColorKeyframe] (a { color } RGBA value) and is independent.
	var rgb = null  # Array[RgbKeyframe] or null
	var alpha = null  # Array[ScalarKeyframe] or null
	var dark = null  # Array[ColorKeyframe] or null


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
	# path constraint name -> Array[PathKeyframe] (ADR-0011 section 3, ADR-0013). Empty when the animation
	# keys no path constraint; insertion order preserved (Dictionary), matching the TS Object.keys() walk.
	var path: Dictionary = {}
	# physics constraint name -> Array[PhysicsKeyframe] (ADR-0014 section 7). Empty when the animation keys no
	# physics constraint; insertion order preserved (Dictionary), matching the TS Object.keys() walk.
	var physics: Dictionary = {}
	var deform: Array = []  # Array[DeformEntry], nested skin/slot/attachment order preserved
	var draw_order: Array = []  # Array[DrawOrderKeyframe], ascending time
	var events: Array = []  # Array[EventKeyframe], non-decreasing time


class SkeletonDocument:
	var bones: Array = []  # Array[Bone]
	var slots: Array = []  # Array[Slot]
	var skins: Array = []  # Array[Skin]
	var ik_constraints: Array = []  # Array[IkConstraint]
	var transform_constraints: Array = []  # Array[TransformConstraint]
	# Array[PathConstraint] (ADR-0011 section 2.3, ADR-0013). Empty for a rig with no path constraints.
	var path_constraints: Array = []
	# Array[PhysicsConstraint] (ADR-0014 section 1, PP-B7). Empty for a rig with no physics constraints.
	var physics_constraints: Array = []
	# The optional skeleton-level physics settings block (ADR-0014 section 5), or null when the document omits
	# it (build_pose then applies the identity defaults 0, 0, 1).
	var physics_settings = null  # PhysicsSettings or null
	var events: Array = []  # Array[EventDef], the document-level event payload defaults
	var animations: Dictionary = {}  # animation id -> Animation

	func find_animation(id: String):
		return animations.get(id, null)
