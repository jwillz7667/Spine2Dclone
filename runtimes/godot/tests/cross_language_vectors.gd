extends RefCounted
# The cross language integer determinism corpus (WP-5.5): the GDScript core must reproduce every value in
# packages/conformance/src/cross-language/seed-prng-crc-vectors.json bit for bit (mirrors runtimes/unity
# CrossLanguageVectorTests.cs). Integer arithmetic is portable by construction, so every family compares
# EXACT. Particle emission parity across web, Unity, and Godot rests entirely on this surface.

const Prng = preload("res://core/prng.gd")
const Crc32 = preload("res://core/crc32.gd")
const RepoPaths = preload("res://tests/repo_paths.gd")


class Result:
	var failures: Array = []
	# One [family, checked_count, ok] row per vector family, for the report.
	var families: Array = []

	func ok() -> bool:
		return failures.size() == 0


static func run() -> Result:
	var result := Result.new()
	var vectors = JSON.parse_string(FileAccess.get_file_as_string(RepoPaths.cross_language_vectors()))

	_check_spin_seed(result, vectors)
	_check_hash32(result, vectors)
	_check_instance_seed(result, vectors)
	_check_mulberry32(result, vectors)
	_check_crc32_check(result, vectors)
	_check_crc32_twin_body(result, vectors)

	return result


static func _record(result: Result, family: String, checked: int, before_failures: int) -> void:
	result.families.append([family, checked, result.failures.size() == before_failures])


static func _check_spin_seed(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var checked := 0
	var spin_seed: Dictionary = vectors["spinSeed"]
	for key in spin_seed:
		if key.begins_with("_"):
			continue
		checked += 1
		var expected := int(spin_seed[key])
		var actual := Prng.spin_seed(key)
		if actual != expected:
			result.failures.append("spinSeed('%s'): expected %d, actual %d" % [key, expected, actual])
	_record(result, "spinSeed", checked, before)


static func _check_hash32(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var checked := 0
	var hash32: Dictionary = vectors["hash32"]
	for key in hash32:
		if key.begins_with("_"):
			continue
		checked += 1
		var parts: PackedStringArray = key.split(",")
		var a := int(parts[0])
		var b := int(parts[1])
		var expected := int(hash32[key])
		var actual := Prng.hash32(a, b)
		if actual != expected:
			result.failures.append("hash32(%d, %d): expected %d, actual %d" % [a, b, expected, actual])
	_record(result, "hash32", checked, before)


static func _check_instance_seed(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var checked := 0
	var samples: Array = vectors["instanceSeed"]["samples"]
	for sample in samples:
		checked += 1
		var spin_id := String(sample["spinId"])
		var expected_trigger := int(sample["triggerSeed"])
		var layer_index := int(sample["layerIndex"])
		var expected_instance := int(sample["instanceSeed"])

		var trigger_seed := Prng.hash32(Prng.spin_seed(spin_id), 0)
		if trigger_seed != expected_trigger:
			result.failures.append(
				"triggerSeed('%s'): expected %d, actual %d" % [spin_id, expected_trigger, trigger_seed]
			)
		var instance_seed := Prng.hash32(trigger_seed, layer_index)
		if instance_seed != expected_instance:
			result.failures.append(
				"instanceSeed('%s', layer %d): expected %d, actual %d"
				% [spin_id, layer_index, expected_instance, instance_seed]
			)
	_record(result, "instanceSeed", checked, before)


static func _check_mulberry32(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var mulberry: Dictionary = vectors["mulberry32"]
	var seed := int(mulberry["seed"])
	var expected: Array = mulberry["nextU32_first16"]
	var state := Prng.make_prng(seed)
	for i in range(expected.size()):
		var expected_value := int(expected[i])
		var actual := Prng.next_u32(state)
		if actual != expected_value:
			result.failures.append("mulberry32 nextU32[%d]: expected %d, actual %d" % [i, expected_value, actual])
	_record(result, "mulberry32", expected.size(), before)


static func _check_crc32_check(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var expected := int(vectors["crc32"]["check_123456789"])
	var actual := Crc32.compute("123456789".to_ascii_buffer())
	if actual != expected:
		result.failures.append("crc32 check_123456789: expected %d, actual %d" % [expected, actual])
	_record(result, "crc32.check", 1, before)


static func _check_crc32_twin_body(result: Result, vectors: Dictionary) -> void:
	var before := result.failures.size()
	var checked := 0
	var twin_body: Dictionary = vectors["crc32"]["twinBody"]
	for rig_id in twin_body:
		if rig_id.begins_with("_"):
			continue
		checked += 1
		var expected := int(twin_body[rig_id])
		var bytes := FileAccess.get_file_as_bytes(RepoPaths.rig_bin(rig_id))
		# twinBody is the CRC over the container EXCLUDING its 4 byte trailer.
		var actual := Crc32.compute_range(bytes, 0, bytes.size() - 4)
		if actual != expected:
			result.failures.append("crc32 twinBody['%s']: expected %d, actual %d" % [rig_id, expected, actual])
	_record(result, "crc32.twinBody", checked, before)
