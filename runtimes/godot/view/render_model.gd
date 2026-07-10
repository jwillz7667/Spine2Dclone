extends RefCounted
# The RENDER-only projection of a SkeletonDocument (mirrors runtimes/unity Marionette.Runtime.View
# RenderModel.cs): the attachment fields the solve core (core/document.gd, core/rig_reader.gd) deliberately
# does NOT read because the solve does not need them, but a renderer does. The core reader builds the solve
# inputs (bones, slots, constraints, animations); this model carries the per-attachment DRAW inputs (region
# placement quad, mesh triangles and uvs, per-attachment tint, atlas region name) plus the atlas region
# table. Both are read from the SAME format JSON. Reading it is render_model_reader.gd's job; consuming it
# (with a solved pose) is draw_item_builder.gd's job. No Node, no RenderingServer: this is headless-testable.

# The attachment kinds. A closed set mirroring the format's attachment union; NON_DRAWING covers clipping,
# boundingbox, point, and path (present in a skin but never emitted as a draw item).
const KIND_REGION := 0
const KIND_MESH := 1
const KIND_LINKED := 2
const KIND_NON_DRAWING := 3


# A region attachment (a single textured quad): the local (x, y, rotation, scale_x, scale_y) offset in the
# slot bone's frame, the authored width x height footprint, the atlas region name (path), and the tint.
class RenderRegion:
	extends RefCounted
	var path: String
	var x: float
	var y: float
	var rotation: float
	var scale_x: float
	var scale_y: float
	var width: float
	var height: float
	var color: Color


# A mesh attachment's RENDER inputs: the atlas region name, the per-vertex texture coordinates (uvs,
# normalized over the region window; length / 2 is the vertex count), the triangle index list, and the tint.
# The WORLD vertex positions come from the solve (mesh_sample.gd), the single behavioral source of truth.
class RenderMesh:
	extends RefCounted
	var path: String
	var uvs: PackedFloat64Array
	var triangles: PackedInt32Array
	var color: Color


# A linked mesh's RENDER inputs (ADR-0009 section 2): its OWN atlas region name and tint, reusing a PARENT
# mesh's uvs/triangles geometry (resolved through parent on the same slot in skin `skin` or this skin).
class RenderLinkedMesh:
	extends RefCounted
	var path: String
	var parent: String
	var skin  # String or null
	var color: Color


# A region/mesh attachment's sequence block (ADR-0009 section 3): count frames, setup_index shown in setup
# pose, and the naming inputs start/digits that turn a resolved integer frame into a region NAME.
class RenderSequence:
	extends RefCounted
	var count: int
	var setup_index: int
	var start: int
	var digits: int


# One attachment in a skin's render table: the kind plus exactly one populated payload (or none for a
# non-drawing attachment) and an optional sequence block.
class RenderAttachment:
	extends RefCounted
	var kind: int
	var region  # RenderRegion or null
	var mesh  # RenderMesh or null
	var linked_mesh  # RenderLinkedMesh or null
	var sequence  # RenderSequence or null


# One skin's render table: slot name -> Dictionary(attachment name -> RenderAttachment), insertion order
# preserved (Godot dictionaries keep insertion order, matching the format member order).
class RenderSkin:
	extends RefCounted
	var name: String
	var slots: Dictionary = {}  # slot name -> Dictionary(att name -> RenderAttachment)

	func find(slot_name: String, attachment_name: String):
		if not slots.has(slot_name):
			return null
		var by_slot: Dictionary = slots[slot_name]
		return by_slot.get(attachment_name, null)


# One packed atlas region (mirrors atlasRegionSchema): the pixel rectangle on its page, the rotated flag,
# and the trim window inside the original untrimmed footprint. name is unique across pages.
class AtlasRegion:
	extends RefCounted
	var name: String
	var x: float
	var y: float
	var w: float
	var h: float
	var rotated: bool
	var offset_x: float
	var offset_y: float
	var original_w: float
	var original_h: float


class AtlasPage:
	extends RefCounted
	var file: String
	var width: float
	var height: float
	var regions: Array = []  # Array[AtlasRegion]


class AtlasData:
	extends RefCounted
	var pages: Array = []  # Array[AtlasPage]


# The render-only projection of the whole document: the skins' render tables (by name) and the atlas.
class RenderModel:
	extends RefCounted
	var skins: Dictionary = {}  # skin name -> RenderSkin
	var atlas: AtlasData = AtlasData.new()

	func find_skin(name: String):
		return skins.get(name, null)
