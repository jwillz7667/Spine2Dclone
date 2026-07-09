extends RefCounted
# CRC-32/ISO-HDLC (the variant used by zlib, gzip, and PNG), pinned bit exactly for the MRNT binary
# container trailer (mirrors packages/format/src/binary/crc32.ts and runtimes/unity Crc32.cs). Parameters:
# width 32, polynomial 0x04C11DB7 (reflected 0xEDB88320), init 0xFFFFFFFF, RefIn true, RefOut true,
# XorOut 0xFFFFFFFF. The check value over the ASCII string "123456789" is 0xCBF43926. uint32 is emulated
# by masking every intermediate with MASK; masked values are non negative so `>>` is the logical shift.

const MASK := 0xFFFFFFFF

static var _table: PackedInt64Array = _build_table()


static func _build_table() -> PackedInt64Array:
	var table := PackedInt64Array()
	table.resize(256)
	for n in range(256):
		var c := n
		for k in range(8):
			c = (0xedb88320 ^ (c >> 1)) if (c & 1) != 0 else (c >> 1)
		table[n] = c & MASK
	return table


# CRC-32/ISO-HDLC of bytes[offset .. offset + count], returned as an unsigned 32 bit integer.
static func compute_range(bytes: PackedByteArray, offset: int, count: int) -> int:
	var crc := MASK
	var end := offset + count
	for i in range(offset, end):
		crc = ((crc >> 8) ^ _table[(crc ^ bytes[i]) & 0xff]) & MASK
	return (crc ^ MASK) & MASK


static func compute(bytes: PackedByteArray) -> int:
	return compute_range(bytes, 0, bytes.size())
