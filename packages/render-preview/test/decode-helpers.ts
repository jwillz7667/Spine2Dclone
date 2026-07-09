import { PNG } from 'pngjs';

// Independent decoders used only by the encoder tests: a GIF LZW decoder (the mirror of src/encode/lzw.ts,
// so a round-trip proves the encoder is self-consistent AND standard-decodable), a minimal animated-GIF
// parser, and an APNG splitter that reconstructs each animation frame into a plain PNG for pngjs to decode.
// They are deliberately separate implementations from the encoders so a bug in one does not hide a bug in
// the other.

// Decode a GIF LZW code stream (no leading min-code-size byte, no sub-block framing) back to indices.
export function lzwDecode(data: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict: number[][] = [];

  const reset = (): void => {
    dict = [];
    for (let i = 0; i < clearCode; i += 1) dict.push([i]);
    dict.push([]); // clear placeholder
    dict.push([]); // end placeholder
    codeSize = minCodeSize + 1;
  };
  reset();

  let bitPos = 0;
  const totalBits = data.length * 8;
  const readCode = (): number => {
    let code = 0;
    for (let b = 0; b < codeSize; b += 1) {
      const byteIndex = bitPos >> 3;
      const bit = (data[byteIndex]! >> (bitPos & 7)) & 1;
      code |= bit << b;
      bitPos += 1;
    }
    return code;
  };

  const out: number[] = [];
  let prev: number[] | null = null;
  while (bitPos + codeSize <= totalBits) {
    const code = readCode();
    if (code === clearCode) {
      reset();
      prev = null;
      continue;
    }
    if (code === endCode) break;

    let entry: number[];
    if (code < dict.length) {
      entry = dict[code]!;
    } else if (code === dict.length && prev !== null) {
      entry = [...prev, prev[0]!];
    } else {
      throw new Error(`lzwDecode: invalid code ${code}`);
    }
    for (const v of entry) out.push(v);

    if (prev !== null) {
      dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    prev = entry;
  }
  return out;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export interface DecodedGifFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly delayCentiseconds: number;
  readonly transparentIndex: number; // -1 when none
  readonly indices: number[];
  readonly palette: Uint8Array; // RGB triples
}

export interface DecodedGif {
  readonly width: number;
  readonly height: number;
  readonly loopCount: number;
  readonly frames: DecodedGifFrame[];
}

// Parse an animated GIF89a into its frames (enough of the format to validate our own encoder output).
export function decodeGif(bytes: Uint8Array): DecodedGif {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== 'GIF89a') throw new Error(`decodeGif: bad header ${header}`);

  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  const packed = bytes[10]!;
  let offset = 13;

  let globalTable = new Uint8Array(0);
  if ((packed & 0x80) !== 0) {
    const size = 1 << ((packed & 0x7) + 1);
    globalTable = bytes.subarray(offset, offset + size * 3);
    offset += size * 3;
  }

  const frames: DecodedGifFrame[] = [];
  let loopCount = 0;
  let pendingDelay = 0;
  let pendingTransparent = -1;

  const readSubBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const len = bytes[offset]!;
      offset += 1;
      if (len === 0) break;
      parts.push(bytes.subarray(offset, offset + len));
      total += len;
      offset += len;
    }
    const merged = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      merged.set(part, cursor);
      cursor += part.length;
    }
    return merged;
  };

  while (offset < bytes.length) {
    const block = bytes[offset]!;
    offset += 1;
    if (block === 0x3b) break; // trailer

    if (block === 0x21) {
      const label = bytes[offset]!;
      offset += 1;
      if (label === 0xf9) {
        const size = bytes[offset]!;
        offset += 1;
        const gcePacked = bytes[offset]!;
        pendingDelay = u16le(bytes, offset + 1);
        const transIdx = bytes[offset + 3]!;
        pendingTransparent = (gcePacked & 0x01) !== 0 ? transIdx : -1;
        offset += size; // packed + delay(2) + transIdx = 4
        offset += 1; // block terminator
      } else if (label === 0xff) {
        const size = bytes[offset]!;
        offset += 1;
        const name = String.fromCharCode(...bytes.subarray(offset, offset + size));
        offset += size;
        const data = readSubBlocks();
        if (name === 'NETSCAPE2.0' && data.length >= 3) loopCount = data[1]! | (data[2]! << 8);
      } else {
        readSubBlocks();
      }
      continue;
    }

    if (block === 0x2c) {
      const left = u16le(bytes, offset);
      const top = u16le(bytes, offset + 2);
      const fw = u16le(bytes, offset + 4);
      const fh = u16le(bytes, offset + 6);
      const imgPacked = bytes[offset + 8]!;
      offset += 9;
      let table = globalTable;
      if ((imgPacked & 0x80) !== 0) {
        const size = 1 << ((imgPacked & 0x7) + 1);
        table = bytes.subarray(offset, offset + size * 3);
        offset += size * 3;
      }
      const minCodeSize = bytes[offset]!;
      offset += 1;
      const lzw = readSubBlocks();
      const indices = lzwDecode(lzw, minCodeSize);
      frames.push({
        left,
        top,
        width: fw,
        height: fh,
        delayCentiseconds: pendingDelay,
        transparentIndex: pendingTransparent,
        indices,
        palette: table,
      });
      continue;
    }

    throw new Error(`decodeGif: unexpected block 0x${block.toString(16)}`);
  }

  return { width, height, loopCount, frames };
}

// ---- APNG ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export interface ApngFrame {
  readonly sequenceNumber: number;
  readonly delayNum: number;
  readonly delayDen: number;
  readonly disposeOp: number;
  readonly blendOp: number;
  readonly png: PNG; // reconstructed and decoded
}

export interface SplitApng {
  readonly width: number;
  readonly height: number;
  readonly numFrames: number;
  readonly numPlays: number;
  readonly allCrcValid: boolean;
  readonly fcTlSequenceNumbers: number[];
  readonly frames: ApngFrame[];
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Split an APNG into its frames: verify every chunk CRC, read acTL, and reconstruct each fcTL region into a
// standalone PNG (signature + IHDR + collected IDAT + IEND) decoded by pngjs, so a test can compare frame
// pixels against the source render.
export function splitApng(bytes: Uint8Array): SplitApng {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('splitApng: bad signature');
  }

  let ihdr = new Uint8Array(0);
  let width = 0;
  let height = 0;
  let numFrames = 0;
  let numPlays = 0;
  let allCrcValid = true;
  const fcTlSequenceNumbers: number[] = [];

  interface PendingFrame {
    seq: number;
    delayNum: number;
    delayDen: number;
    disposeOp: number;
    blendOp: number;
    idat: Uint8Array[];
  }
  let pending: PendingFrame | null = null;
  const frames: ApngFrame[] = [];

  const finalize = (frame: PendingFrame): void => {
    let total = 0;
    for (const part of frame.idat) total += part.length;
    const idat = new Uint8Array(total);
    let cursor = 0;
    for (const part of frame.idat) {
      idat.set(part, cursor);
      cursor += part.length;
    }
    const png = PNG.sync.read(Buffer.from(reconstructPng(ihdr, idat)));
    frames.push({
      sequenceNumber: frame.seq,
      delayNum: frame.delayNum,
      delayDen: frame.delayDen,
      disposeOp: frame.disposeOp,
      blendOp: frame.blendOp,
      png,
    });
  };

  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = u32be(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const data = bytes.subarray(dataStart, dataStart + length);
    const crcStored = u32be(bytes, dataStart + length);
    const crcComputed = crc32(bytes.subarray(offset + 4, dataStart + length));
    if (crcStored !== crcComputed) allCrcValid = false;

    if (type === 'IHDR') {
      ihdr = data.slice();
      width = u32be(data, 0);
      height = u32be(data, 4);
    } else if (type === 'acTL') {
      numFrames = u32be(data, 0);
      numPlays = u32be(data, 4);
    } else if (type === 'fcTL') {
      if (pending !== null) finalize(pending);
      fcTlSequenceNumbers.push(u32be(data, 0));
      pending = {
        seq: u32be(data, 0),
        delayNum: (data[20]! << 8) | data[21]!,
        delayDen: (data[22]! << 8) | data[23]!,
        disposeOp: data[24]!,
        blendOp: data[25]!,
        idat: [],
      };
    } else if (type === 'IDAT') {
      if (pending !== null) pending.idat.push(data.slice());
    } else if (type === 'fdAT') {
      if (pending !== null) pending.idat.push(data.subarray(4).slice());
    } else if (type === 'IEND') {
      if (pending !== null) {
        finalize(pending);
        pending = null;
      }
      break;
    }

    offset = dataStart + length + 4;
  }

  return { width, height, numFrames, numPlays, allCrcValid, fcTlSequenceNumbers, frames };
}

function reconstructPng(ihdr: Uint8Array, idat: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', new Uint8Array(0)),
  ];
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((c) => c.charCodeAt(0)));
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}
