extends RefCounted
# Flattens a SkeletonDrawList (draw items in draw order) into pooled batches grouped by maximal consecutive
# runs of the same (blend mode, atlas page) (mirrors runtimes/unity MeshBufferAssembler.cs). This is the
# buffer building, draw-order batching, blend-mode grouping, and vertex assembly the host engine's canvas
# item / MeshInstance2D consumes. Pure and engine-agnostic, so it is covered by the headless view harness;
# the Node2D renderer only uploads the result. A batch never spans a blend-mode change and the runs stay in
# draw order, so the batch sequence preserves both painter's order and the per-slot blend semantics.


# One render batch: contiguous vertex/uv/color/index buffers for one (blend mode, atlas page) run. All
# buffers are pooled (grow to the busiest batch, never shrink), so a reused RenderBatchSet allocates nothing
# in steady state.
class RenderBatch:
	extends RefCounted
	var blend: String = "normal"
	var page_file  # String or null
	var has_dark: bool = false
	var vertex_count: int = 0
	var index_count: int = 0
	var positions: PackedFloat64Array = PackedFloat64Array()  # 2 lanes per vertex
	var uvs: PackedFloat64Array = PackedFloat64Array()  # 2 lanes per vertex (page-normalized, top-left)
	var colors: PackedFloat64Array = PackedFloat64Array()  # 4 lanes per vertex (light rgb + alpha)
	var dark_colors: PackedFloat64Array = PackedFloat64Array()  # 4 lanes per vertex (dark rgb, alpha 1)
	var indices: PackedInt32Array = PackedInt32Array()

	func begin(new_blend: String, new_page_file) -> void:
		blend = new_blend
		page_file = new_page_file
		has_dark = false
		vertex_count = 0
		index_count = 0

	func ensure_capacity(add_vertices: int, add_indices: int) -> void:
		var needed_vertices := vertex_count + add_vertices
		var needed_indices := index_count + add_indices
		if positions.size() < needed_vertices * 2:
			positions.resize(needed_vertices * 2)
			uvs.resize(needed_vertices * 2)
		if colors.size() < needed_vertices * 4:
			colors.resize(needed_vertices * 4)
			dark_colors.resize(needed_vertices * 4)
		if indices.size() < needed_indices:
			indices.resize(needed_indices)


# A reusable set of render batches produced from one frame's draw items. count is the number of live batches
# (indices [0, count) are valid, in draw order); the batch objects and their buffers are pooled across frames.
class RenderBatchSet:
	extends RefCounted
	var count: int = 0
	var _pool: Array = []  # Array[RenderBatch]

	func reset() -> void:
		count = 0

	func batch(index: int) -> RenderBatch:
		return _pool[index]

	func next_batch(blend: String, page_file) -> RenderBatch:
		if count == _pool.size():
			_pool.append(RenderBatch.new())
		var result: RenderBatch = _pool[count]
		count += 1
		result.begin(blend, page_file)
		return result


static func _same_key(batch: RenderBatch, item) -> bool:
	return batch.blend == item.blend and batch.page_file == item.page_file


static func assemble(items, out_batches: RenderBatchSet) -> void:
	out_batches.reset()
	var current: RenderBatch = null

	for i in range(items.count):
		var item = items.item(i)
		if item.vertex_count == 0 or item.triangle_index_count == 0:
			continue

		if current == null or not _same_key(current, item):
			current = out_batches.next_batch(item.blend, item.page_file)

		_append(current, item)


static func _append(batch: RenderBatch, item) -> void:
	var vertex_count: int = item.vertex_count
	var index_count: int = item.triangle_index_count
	batch.ensure_capacity(vertex_count, index_count)

	var vertex_base := batch.vertex_count
	var tint: Color = item.tint
	var alpha: float = item.alpha
	var item_has_dark: bool = item.dark != null
	var dark: Color = item.dark if item_has_dark else Color(0, 0, 0, 1)
	if item_has_dark:
		batch.has_dark = true

	for v in range(vertex_count):
		var p := (vertex_base + v) * 2
		batch.positions[p] = item.world_positions[v * 2]
		batch.positions[p + 1] = item.world_positions[(v * 2) + 1]
		batch.uvs[p] = item.page_uvs[v * 2]
		batch.uvs[p + 1] = item.page_uvs[(v * 2) + 1]
		var c := (vertex_base + v) * 4
		batch.colors[c] = tint.r
		batch.colors[c + 1] = tint.g
		batch.colors[c + 2] = tint.b
		batch.colors[c + 3] = alpha
		batch.dark_colors[c] = dark.r
		batch.dark_colors[c + 1] = dark.g
		batch.dark_colors[c + 2] = dark.b
		batch.dark_colors[c + 3] = 1.0

	var index_base := batch.index_count
	for t in range(index_count):
		batch.indices[index_base + t] = vertex_base + item.triangles[t]

	batch.vertex_count = vertex_base + vertex_count
	batch.index_count = index_base + index_count
