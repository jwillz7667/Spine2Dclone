extends RefCounted
# Locates the committed conformance sources by walking up from the Godot project (res://) to the
# repository root (the first ancestor that contains packages/conformance/src). The runtime reads the
# fixtures, sample specs, rigs, and integer vectors DIRECTLY from that one tree (single source of truth,
# never copied), so a fixture regeneration in the TS oracle is seen here with no sync step.

static var _conformance_src: String = _resolve()


static func _resolve() -> String:
	var dir := ProjectSettings.globalize_path("res://").simplify_path()
	while true:
		var candidate := dir.path_join("packages/conformance/src")
		if DirAccess.dir_exists_absolute(candidate):
			return candidate
		var parent := dir.path_join("..").simplify_path()
		if parent == dir:
			break
		dir = parent
	push_error("could not locate packages/conformance/src walking up from res://")
	return ""


static func conformance_src() -> String:
	return _conformance_src


static func rig_json(rig_id: String) -> String:
	return _conformance_src.path_join("rigs/%s.json" % rig_id)


static func rig_bin(rig_id: String) -> String:
	return _conformance_src.path_join("rigs/%s.bin" % rig_id)


static func sample_spec(rig_id: String) -> String:
	return _conformance_src.path_join("sample-spec/%s.sample-spec.json" % rig_id)


static func fixture(rig_id: String) -> String:
	return _conformance_src.path_join("fixtures/%s.fixture.json" % rig_id)


static func cross_language_vectors() -> String:
	return _conformance_src.path_join("cross-language/seed-prng-crc-vectors.json")


# The clip-geometry cross-language golden (PP-B2, ADR-0012 section 3): input polygon + triangle -> expected
# output rings + barycentrics the Sutherland-Hodgman clipper must reproduce across TS / C# / GDScript.
static func clip_geometry_vectors() -> String:
	return _conformance_src.path_join("cross-language/clip-geometry-vectors.json")


# Every committed skeleton rig, discovered from the fixtures directory rather than a hardcoded list, so
# the harness runs EXACTLY the landed corpus (the materialized projection of registry.ts LANDED_RIG_IDS:
# the generator writes one <rigId>.fixture.json per landed rig and the .fixtures.lock gate enforces the
# set). A newly landed rig is picked up automatically (its fixture must then pass), so corpus growth is
# caught, never silently skipped. Sorted for a deterministic, filesystem-order-independent run order.
static func all_rig_ids() -> PackedStringArray:
	var suffix := ".fixture.json"
	var dir := _conformance_src.path_join("fixtures")
	var ids := PackedStringArray()
	for file_name in DirAccess.get_files_at(dir):
		if file_name.ends_with(suffix):
			ids.append(file_name.substr(0, file_name.length() - suffix.length()))
	ids.sort()
	return ids
