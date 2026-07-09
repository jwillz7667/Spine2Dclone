extends RefCounted
# Validate-on-import boundary checks for the strict rig reader (Law 3): the reader accepts a valid rig
# (including the forward-compatible formatVersion 0.3.0 with additive empty collections) and FAILS LOUDLY
# with a typed RigReadError on a missing required field, a missing formatVersion, and an unsupported
# format major. Positive plus negative, mirroring the format package's parseDocument contract.

const RigReader = preload("res://core/rig_reader.gd")

# A minimal valid 0.3.0 rig carrying the additive-empty collections a 0.3.0 document may add (document
# `events`, animation `drawOrder`/`events`, optional `metadata`), to prove the reader tolerates them.
const VALID_030 := """
{
	"formatVersion": "0.3.0",
	"name": "boundary-rig",
	"hash": "",
	"metadata": {},
	"events": [],
	"bones": [
		{"name": "root", "parent": null, "length": 10, "x": 0, "y": 0, "rotation": 0,
		 "scaleX": 1, "scaleY": 1, "shearX": 0, "shearY": 0, "transformMode": "normal"}
	],
	"slots": [],
	"skins": [{"name": "default", "attachments": {}}],
	"ikConstraints": [],
	"transformConstraints": [],
	"animations": {
		"default": {"duration": 0, "bones": {}, "slots": {}, "ik": {}, "transform": {}, "deform": {},
			"drawOrder": [], "events": []}
	}
}
"""

const MISSING_FIELD := """
{"formatVersion": "0.2.0", "bones": [{"name": "root"}], "animations": {}}
"""

const MISSING_VERSION := """
{"bones": [], "animations": {}}
"""

const BAD_MAJOR := """
{"formatVersion": "9.9.9", "bones": [], "animations": {}}
"""


class Result:
	var failures: Array = []
	var checked: int = 0

	func ok() -> bool:
		return failures.size() == 0


static func run() -> Result:
	var result := Result.new()

	# Positive: a valid forward-compatible 0.3.0 rig parses to a document with the one bone.
	result.checked += 1
	var valid = RigReader.parse(VALID_030)
	if valid is RigReader.RigReadError:
		result.failures.append("valid 0.3.0 rig rejected: %s" % valid.message)
	elif valid.bones.size() != 1:
		result.failures.append("valid 0.3.0 rig parsed %d bones, expected 1" % valid.bones.size())

	_expect_error(result, "missing required field", MISSING_FIELD, "missing required number")
	_expect_error(result, "missing formatVersion", MISSING_VERSION, "formatVersion")
	_expect_error(result, "unsupported format major", BAD_MAJOR, "unsupported formatVersion major")

	return result


static func _expect_error(result: Result, label: String, json_text: String, expected_substring: String) -> void:
	result.checked += 1
	var parsed = RigReader.parse(json_text)
	if not (parsed is RigReader.RigReadError):
		result.failures.append("%s: expected RigReadError, got a document" % label)
		return
	if not parsed.message.contains(expected_substring):
		result.failures.append(
			"%s: RigReadError message '%s' does not contain '%s'" % [label, parsed.message, expected_substring]
		)
