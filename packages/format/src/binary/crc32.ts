// CRC-32/ISO-HDLC (the variant used by zlib, gzip, and PNG), pinned bit-exactly for the MRNT binary
// container trailer (phase-5 section 6.1.5, TASK-5.1.8). Pinning the variant lets the TS encoder and the
// shared C# / GDScript decoders compute an identical integrity value, so a correct document never fails to
// load in a native runtime for a reason unrelated to the solve.
//
// Parameters (phase-5 6.1.5): width 32, polynomial 0x04C11DB7 (reflected 0xEDB88320), init 0xFFFFFFFF,
// RefIn true, RefOut true, XorOut 0xFFFFFFFF. The check value over the ASCII string "123456789" is
// 0xCBF43926 (the published CRC-32/ISO-HDLC check), asserted by the golden-vector test.
//
// Reimplementation notes for native runtimes (the phase-5 contract):
//   - Build the reflected table from 0xEDB88320; process bytes low-to-high.
//   - C#: use `uint`; GDScript: mask every intermediate with `& 0xFFFFFFFF`.
//   - The result is stored as uint32 LITTLE-ENDIAN in the container trailer.

// Precompute the reflected CRC-32 table (polynomial 0xEDB88320). Computed once at module load.
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

// CRC-32/ISO-HDLC of `bytes`, returned as an unsigned 32-bit integer. The init and final XOR with
// 0xFFFFFFFF are folded in per the pinned parameters.
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
