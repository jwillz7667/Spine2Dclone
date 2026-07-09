// Low-level byte primitives shared by the GIF and APNG encoders: a growable little/big-endian byte writer,
// a CRC-32 (ISO 3309, the PNG/zlib polynomial) for APNG chunk checksums, and a minimal PNG chunk reader
// that splits the per-frame pngjs output into its IHDR and concatenated IDAT payloads. All pure, allocation
// bounded (the writer doubles its backing buffer), and deterministic: no clock, no randomness.

// A growable output buffer. Doubles its backing store on demand and hands back an exact-length copy at the
// end. Endianness helpers are explicit at every call site so the produced byte stream is unambiguous.
export class ByteWriter {
  private buf: Uint8Array;
  private length = 0;

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(Math.max(1, initialCapacity));
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buf.length) return;
    let capacity = this.buf.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.buf.subarray(0, this.length));
    this.buf = grown;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buf[this.length] = value & 0xff;
    this.length += 1;
  }

  u16le(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
  }

  u16be(value: number): void {
    this.u8(value >>> 8);
    this.u8(value);
  }

  u32be(value: number): void {
    this.u8(value >>> 24);
    this.u8(value >>> 16);
    this.u8(value >>> 8);
    this.u8(value);
  }

  bytes(source: Uint8Array): void {
    this.ensure(source.length);
    this.buf.set(source, this.length);
    this.length += source.length;
  }

  ascii(text: string): void {
    this.ensure(text.length);
    for (let i = 0; i < text.length; i += 1) this.buf[this.length + i] = text.charCodeAt(i) & 0xff;
    this.length += text.length;
  }

  get size(): number {
    return this.length;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

// The CRC-32 lookup table (polynomial 0xEDB88320), built once at module load. Deterministic and constant.
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

// Fold `bytes` into a running CRC (pass the previous return value as `crc`; seed with 0xffffffff). Returns
// the intermediate register, NOT the finalized checksum, so a checksum can span several buffers without an
// intermediate concatenation. Call finalizeCrc on the last return value to get the value written to a chunk.
export function updateCrc(crc: number, bytes: Uint8Array): number {
  let c = crc >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return c >>> 0;
}

export function finalizeCrc(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

// The 8-byte PNG file signature every PNG (and APNG) starts with.
export const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngChunks {
  // The raw 13-byte IHDR payload (reused verbatim as the APNG IHDR).
  readonly ihdr: Uint8Array;
  // Every IDAT payload concatenated in stream order (the compressed image data for this frame).
  readonly idat: Uint8Array;
  readonly width: number;
  readonly height: number;
}

// Split a single PNG (the per-frame pngjs output) into the pieces the APNG assembler needs: its IHDR
// payload and its concatenated IDAT payloads. Validates the signature and the IHDR length; throws a plain
// Error on a structurally invalid PNG (the input is our own encoder's output, so this is an invariant
// check, not an external boundary).
export function readPngChunks(png: Uint8Array): PngChunks {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (png[i] !== PNG_SIGNATURE[i]) throw new Error('readPngChunks: not a PNG (bad signature)');
  }

  let ihdr: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];
  let idatTotal = 0;
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= png.length) {
    const dataLength =
      (png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!;
    const type = String.fromCharCode(
      png[offset + 4]!,
      png[offset + 5]!,
      png[offset + 6]!,
      png[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    if (dataEnd + 4 > png.length) throw new Error(`readPngChunks: truncated chunk ${type}`);
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length !== 13) throw new Error('readPngChunks: IHDR must be 13 bytes');
      ihdr = data;
    } else if (type === 'IDAT') {
      idatParts.push(data);
      idatTotal += data.length;
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4; // skip the 4-byte CRC
  }

  if (ihdr === null) throw new Error('readPngChunks: missing IHDR');
  if (idatParts.length === 0) throw new Error('readPngChunks: missing IDAT');

  const idat = new Uint8Array(idatTotal);
  let cursor = 0;
  for (const part of idatParts) {
    idat.set(part, cursor);
    cursor += part.length;
  }

  const width = (ihdr[0]! << 24) | (ihdr[1]! << 16) | (ihdr[2]! << 8) | ihdr[3]!;
  const height = (ihdr[4]! << 24) | (ihdr[5]! << 16) | (ihdr[6]! << 8) | ihdr[7]!;
  return { ihdr, idat, width, height };
}
