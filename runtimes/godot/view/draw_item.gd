extends RefCounted
# One drawable primitive in world space, gathered from a solved pose in DRAW ORDER (solve-order step 6;
# mirrors runtimes/unity DrawItem.cs). A region (a quad) and a mesh both reduce to this shape. The WORLD
# positions are the runtime-core solve output verbatim (region corners for regions, mesh_sample for meshes),
# so the view cannot drift from the behavioral oracle.
#
# Poolable: the variable buffers grow only when a larger geometry than any before appears (size-keyed), so a
# host that reuses a SkeletonDrawList across frames allocates nothing in steady state. vertex_count /
# triangle_index_count are the LIVE lengths (the backing packed arrays may be larger).

var slot_index: int = -1
var render_position: int = -1
var vertex_count: int = 0
var triangle_index_count: int = 0

var world_positions: PackedFloat64Array = PackedFloat64Array()
var page_uvs: PackedFloat64Array = PackedFloat64Array()
var triangles: PackedInt32Array = PackedInt32Array()

var tint: Color = Color(1, 1, 1, 1)
var alpha: float = 1.0
var blend: String = "normal"
var dark  # Color or null
var region_path: String = ""
var page_file  # String or null


# Grow the vertex/index buffers to at least the given capacity (never shrink), and set the live counts.
func ensure_capacity(new_vertex_count: int, new_triangle_index_count: int) -> void:
	if world_positions.size() < new_vertex_count * 2:
		world_positions.resize(new_vertex_count * 2)
		page_uvs.resize(new_vertex_count * 2)
	if triangles.size() < new_triangle_index_count:
		triangles.resize(new_triangle_index_count)
	vertex_count = new_vertex_count
	triangle_index_count = new_triangle_index_count
