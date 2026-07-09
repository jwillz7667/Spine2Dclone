extends RefCounted
# The normative seeded PRNG and stream seed derivations (mirrors packages/runtime-core/src/effects/prng.ts
# and runtimes/unity Prng.cs, LAW 4). Determinism relies on INTEGER arithmetic, which is bit reproducible
# across TS, C#, and GDScript. Every value is a uint32.
#
# GDScript integers are 64 bit signed, so uint32 semantics are emulated EXPLICITLY:
#   - Mask every intermediate to 32 bits with `& 0xFFFFFFFF` (the MASK constant below). A masked value is
#     always non negative, so GDScript's `>>` is the logical (unsigned) right shift the algorithm needs
#     and `|` / `^` stay in the 32 bit domain.
#   - Math.imul (32 bit truncating multiply) is _imul32. It CANNOT be written as `(a * b) & MASK`:
#     0xFFFFFFFF * 0xFFFFFFFF is about 2^64 and overflows the signed 64 bit range. Instead the operands
#     are split into 16 bit halves so no partial product exceeds ~2^49, which fits in int64:
#       a*b mod 2^32 = (a_lo*b_lo + ((a_hi*b_lo + a_lo*b_hi) << 16)) mod 2^32
#     (the a_hi*b_hi*2^32 term vanishes mod 2^32).

const MASK := 0xFFFFFFFF
const FNV1A_OFFSET_BASIS := 0x811c9dc5
const FNV1A_PRIME := 0x01000193


# The mutable generator state: a single uint32.
class PrngState:
	var s: int

	func _init(seed: int) -> void:
		s = seed & MASK


# The 32 bit truncating multiply (Math.imul), overflow safe via 16 bit half splitting.
static func imul32(a: int, b: int) -> int:
	a &= MASK
	b &= MASK
	var a_lo := a & 0xFFFF
	var a_hi := a >> 16
	var b_lo := b & 0xFFFF
	var b_hi := b >> 16
	var lo := a_lo * b_lo
	var mid := (a_hi * b_lo) + (a_lo * b_hi)
	return (lo + (mid << 16)) & MASK


static func make_prng(seed: int) -> PrngState:
	return PrngState.new(seed)


# Advance the state and return the next uint32.
static func next_u32(state: PrngState) -> int:
	state.s = (state.s + 0x6d2b79f5) & MASK
	var t := state.s
	t = imul32(t ^ (t >> 15), t | 1)
	t = (t ^ (t + imul32(t ^ (t >> 7), t | 61))) & MASK
	return (t ^ (t >> 14)) & MASK


# A double in [0, 1): exact, since dividing a uint32 by 2^32 is exact in f64. Never returns 1.0.
static func next_unit(state: PrngState) -> float:
	return float(next_u32(state)) / 4294967296.0


# Derive an independent uint32 stream seed from two uint32 inputs.
static func hash32(a: int, b: int) -> int:
	a &= MASK
	b &= MASK
	var h := (a ^ 0x9e3779b9) & MASK
	h = imul32(h ^ b, 0x85ebca6b)
	h = imul32(h ^ (h >> 13), 0xc2b2ae35)
	return (h ^ (h >> 16)) & MASK


# The pinned string to uint32 derivation (FNV-1a 32 over the UTF-8 bytes of spinId). Operating on UTF-8
# BYTES (not UTF-16 code units) pins the derivation for non ASCII spinIds too.
static func spin_seed(spin_id: String) -> int:
	var bytes := spin_id.to_utf8_buffer()
	var h := FNV1A_OFFSET_BASIS & MASK
	for i in range(bytes.size()):
		h = (h ^ bytes[i]) & MASK
		h = imul32(h, FNV1A_PRIME)
	return h & MASK
