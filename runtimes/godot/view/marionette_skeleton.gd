extends Node2D
# The drop-in Godot 2D component: load a Marionette format document (a .mrnt-exported JSON) plus its atlas
# page textures, play one animation, and render it. It drives the SHARED, engine-agnostic solve
# (Sample.sample_skeleton) and the SHARED view build (draw_item_builder + mesh_buffer_assembler) every
# _process, then uploads the batches to a pool of MeshInstance2D children (one per draw batch), ordered by
# z_index for painter's order (solve-order step 6). All the load-bearing logic (solve, draw-item gather,
# batching) lives in the tested engine-agnostic scripts; this Node2D is a thin, declarative driver.
#
# It references RenderingServer/Node2D types, so its RENDERING is verified in-editor. Its INPUTS (the batch
# buffers) are produced and tested entirely by the headless view harness, so the logic that could drift is
# covered; this node just uploads geometry.

const RigReader = preload("res://core/rig_reader.gd")
const BuildPose = preload("res://core/build_pose.gd")
const Sample = preload("res://core/sample.gd")
const RenderModelReader = preload("res://view/render_model_reader.gd")
const AtlasIndex = preload("res://view/atlas_index.gd")
const DrawItemBuilder = preload("res://view/draw_item_builder.gd")
const MeshBufferAssembler = preload("res://view/mesh_buffer_assembler.gd")

@export_file("*.json") var document_path: String = ""
@export var skin_name: String = "default"
@export var animation_name: String = ""
@export var loop: bool = true
@export var time_scale: float = 1.0
@export var play_on_ready: bool = true
# Atlas page textures. Each texture's file name (resource_path basename) must match a page `file` in the
# document atlas (for example 'skeleton.png').
@export var atlas_pages: Array[Texture2D] = []

var _document
var _render_model
var _atlas
var _pose
var _draw_list
var _batches
var _page_textures: Dictionary = {}
var _mesh_pool: Array = []  # Array[MeshInstance2D]

var _time: float = 0.0
var _duration: float = 0.0
var _playing: bool = false
var _loaded: bool = false

# Godot 2D canvas blend modes for the four slot blend modes. Godot has no built-in 'screen' canvas blend, so
# screen falls back to MIX (a custom CanvasItemMaterial shader is the extension point); the others map exactly.
const BLEND_MODES := {
	"normal": CanvasItemMaterial.BLEND_MODE_MIX,
	"additive": CanvasItemMaterial.BLEND_MODE_ADD,
	"multiply": CanvasItemMaterial.BLEND_MODE_MUL,
	"screen": CanvasItemMaterial.BLEND_MODE_MIX,
}


func _ready() -> void:
	load_document()
	if play_on_ready:
		play(animation_name)


# Load and prepare the document, atlas, and solve pose. Safe to call again to reload.
func load_document() -> void:
	_loaded = false
	if document_path == "":
		push_warning("MarionetteSkeleton: no document_path assigned.")
		return

	var json_text := FileAccess.get_file_as_string(document_path)
	var document = RigReader.parse(json_text)
	if document is RigReader.RigReadError:
		push_error("MarionetteSkeleton: rig read error: %s" % document.message)
		return

	var render_model = RenderModelReader.parse(json_text)
	if render_model is RenderModelReader.RenderModelReadError:
		push_error("MarionetteSkeleton: render model read error: %s" % render_model.message)
		return

	_document = document
	_render_model = render_model
	_atlas = AtlasIndex.new(render_model.atlas)
	_pose = BuildPose.build(document)
	_draw_list = DrawItemBuilder.SkeletonDrawList.new()
	_batches = MeshBufferAssembler.RenderBatchSet.new()

	_page_textures.clear()
	for texture in atlas_pages:
		if texture != null:
			_page_textures[texture.resource_path.get_file()] = texture

	_loaded = true


# Start (or restart) playing the named animation from time 0. Resets physics so the simulation starts at rest.
func play(animation: String) -> void:
	if not _loaded:
		return

	var found = _document.find_animation(animation)
	if found == null:
		push_warning("MarionetteSkeleton: animation '%s' not found." % animation)
		_playing = false
		return

	animation_name = animation
	_duration = found.duration
	_time = 0.0
	_playing = true
	Sample.reset_physics(_pose)
	_render_frame(0.0)


func _process(delta: float) -> void:
	if not _playing:
		return
	_render_frame(delta * time_scale)


# Advance the clock by frame_dt seconds, solve, gather, batch, and upload. frame_dt also advances the physics
# simulation clock (constraints carry velocity across frames).
func _render_frame(frame_dt: float) -> void:
	var next := _time + frame_dt
	if _duration > 0.0:
		if loop:
			next = fmod(next, _duration)
			if next < 0.0:
				next += _duration
		elif next > _duration:
			next = _duration
	_time = next

	Sample.sample_skeleton(_document, animation_name, _time, _pose, null, frame_dt)
	DrawItemBuilder.build_into(_document, _render_model, _atlas, _pose, skin_name, animation_name, _time, _draw_list)
	MeshBufferAssembler.assemble(_draw_list, _batches)
	_upload()


func _upload() -> void:
	for b in range(_batches.count):
		var batch = _batches.batch(b)
		var instance := _rent(b)
		_fill(instance, batch)
		instance.z_index = b
		instance.visible = true

	for b in range(_batches.count, _mesh_pool.size()):
		_mesh_pool[b].visible = false


func _rent(index: int) -> MeshInstance2D:
	while _mesh_pool.size() <= index:
		var instance := MeshInstance2D.new()
		instance.mesh = ArrayMesh.new()
		instance.material = CanvasItemMaterial.new()
		add_child(instance)
		_mesh_pool.append(instance)
	return _mesh_pool[index]


func _fill(instance: MeshInstance2D, batch) -> void:
	var vertex_count: int = batch.vertex_count
	var index_count: int = batch.index_count

	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var colors := PackedColorArray()
	vertices.resize(vertex_count)
	uvs.resize(vertex_count)
	colors.resize(vertex_count)
	for v in range(vertex_count):
		vertices[v] = Vector3(batch.positions[v * 2], batch.positions[(v * 2) + 1], 0.0)
		# Atlas UVs are top-left origin, which matches Godot's 2D texture UV convention, so no flip.
		uvs[v] = Vector2(batch.uvs[v * 2], batch.uvs[(v * 2) + 1])
		var c := v * 4
		colors[v] = Color(batch.colors[c], batch.colors[c + 1], batch.colors[c + 2], batch.colors[c + 3])

	var indices := PackedInt32Array()
	indices.resize(index_count)
	for t in range(index_count):
		indices[t] = batch.indices[t]

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices

	var mesh: ArrayMesh = instance.mesh
	mesh.clear_surfaces()
	if vertex_count > 0 and index_count > 0:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)

	var material: CanvasItemMaterial = instance.material
	material.blend_mode = BLEND_MODES.get(batch.blend, CanvasItemMaterial.BLEND_MODE_MIX)

	if batch.page_file != null and _page_textures.has(batch.page_file):
		instance.texture = _page_textures[batch.page_file]
	else:
		instance.texture = null
