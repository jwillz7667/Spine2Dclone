// GIF89a variable-width LZW compression (from first principles, not a Spine or third-party codec). Codes
// are packed least-significant-bit first, the width grows from minCodeSize+1 up to 12 bits following the
// classic UNIX-compress rule the GIF spec inherits, and a clear code resets the dictionary when it fills.
// Fully deterministic: no clock, no randomness, fixed dictionary progression, so a given index stream
// always compresses to the same bytes. A matching decoder lives in the unit test to prove round-trips.

import { ByteWriter } from './bytes';

const MAX_CODE_SIZE = 12;
const MAX_DICT_SIZE = 1 << MAX_CODE_SIZE; // 4096

// Compress an index stream into the raw LZW byte sequence (no leading min-code-size byte, no sub-block
// framing). Exposed for unit testing against a hand-computed case and a round-trip decoder.
export function lzwCompress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const out = new ByteWriter(Math.max(16, indices.length));
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const dict = new Map<number, number>();

  let bitBuffer = 0;
  let bitCount = 0;
  const emit = (code: number): void => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.u8(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);

  if (indices.length === 0) {
    emit(endCode);
    if (bitCount > 0) out.u8(bitBuffer & 0xff);
    return out.toUint8Array();
  }

  let current = indices[0]!;
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i]!;
    const key = (current << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      current = found;
      continue;
    }
    emit(current);
    if (nextCode < MAX_DICT_SIZE) {
      dict.set(key, nextCode);
      // Grow the code width when the code just ASSIGNED fills the current width, checked BEFORE advancing
      // (the UNIX-compress / GIF timing: `free_ent > maxcode`). The wider width takes effect from the next
      // emitted code, so the widths line up with a standard GIF decoder. Capped at 12 bits.
      if (nextCode > (1 << codeSize) - 1 && codeSize < MAX_CODE_SIZE) codeSize += 1;
      nextCode += 1;
    } else {
      // Dictionary full: emit a clear code and reset, exactly as a GIF decoder expects.
      emit(clearCode);
      dict.clear();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }
    current = k;
  }

  emit(current);
  emit(endCode);
  if (bitCount > 0) out.u8(bitBuffer & 0xff);
  return out.toUint8Array();
}

// The full GIF image-data section for one frame: the leading minimum-code-size byte, the LZW stream split
// into sub-blocks of at most 255 bytes (each prefixed by its length), and the terminating zero-length
// block. This is what follows an Image Descriptor (and its optional local color table) in the stream.
export function encodeGifImageBlock(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const compressed = lzwCompress(indices, minCodeSize);
  const out = new ByteWriter(compressed.length + Math.ceil(compressed.length / 255) + 2);
  out.u8(minCodeSize);
  let offset = 0;
  while (offset < compressed.length) {
    const blockSize = Math.min(255, compressed.length - offset);
    out.u8(blockSize);
    out.bytes(compressed.subarray(offset, offset + blockSize));
    offset += blockSize;
  }
  out.u8(0); // block terminator
  return out.toUint8Array();
}
