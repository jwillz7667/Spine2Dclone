import { isRecord } from '../internal/guards';
import type { SkeletonDocument } from '../schema/document';
import { SUPPORTED_FORMAT_MAJOR } from '../version/constants';
import { parseSemVer } from '../version/semver';
import { crc32 } from './crc32';
import { BinaryDecodeError } from './errors';

// The MRNT binary codec (phase-5 WP-5.1, section 6.1). A compact, deterministic, LOSSLESS second
// serialization of the EXACT SkeletonDocument logical schema (handoff section 6). The codec lives in
// packages/format (the contract owner, Law 3) so the editor, runtime-web, the conformance harness, and
// the native runtimes share ONE definition. The editor uses it to ENCODE only; the editor's save format
// stays JSON (section 4.2). It is NOT a new format: it carries the SAME formatVersion as the JSON and is
// validated by the SAME validator after decode (the load path runs validateDocument; section 6.1.2).
//
// DESIGN (and how it satisfies the section 6.1 container + every TASK-5.1.x guarantee). The plan's
// section 6.1.1 fixes the CONTAINER (MRNT magic, containerVersion, flags, formatVersion string, a
// deduplicated string table, a length-checked body, a CRC-32/ISO-HDLC trailer) and the load-bearing
// GUARANTEES (deterministic byte-identical re-encode, JSON to binary to JSON deep-equal losslessness via
// float64, typed decode errors). This implementation honors all of that. For the BODY it uses one
// schema-agnostic, typed value-tree encoding (a tagged value per node, with every string, including every
// object KEY, stored once in the shared table) rather than a hand-rolled field-by-field layout. That is a
// deliberate Law-3 choice: a field-by-field codec must mirror the Zod schema and silently DIVERGES from it
// on every schema change, whereas a value-tree codec encodes exactly the validated document and CANNOT
// drift from the contract. The string table is where binary crushes JSON (repeated bone/slot/attachment
// names and every field name are stored once); float64 keeps the round-trip deep-equal, not epsilon.
//
// DETERMINISM (TASK-5.1.1). The string table is built in first-encounter order under a fixed traversal
// (objects visit keys in sorted order, arrays in index order), and the body encodes object keys in that
// same sorted order, so encode(doc) twice is byte-identical and encode(decode(canonicalBytes)) reproduces
// the bytes (TASK-5.1.3). LOSSLESS (TASK-5.1.2): integers round-trip as varints, all other numbers as
// IEEE-754 float64, both decoding to the identical JS number, so decode(encode(doc)) deep-equals doc.
// Byte access is through DataView with explicit little-endian typed reads (INV-4); no `any`.

const MAGIC: readonly number[] = [0x4d, 0x52, 0x4e, 0x54]; // "MRNT"
const CONTAINER_VERSION = 1;
// flags bit0 = lossless float64 marker (SET for the default profile); bits 1..7 reserved, MUST be 0
// (section 6.1.1). A future opt-in float32 transport profile would clear bit0 under a new containerVersion.
const FLAG_LOSSLESS_FLOAT64 = 0x01;
const TRAILER_BYTES = 4; // uint32 LE CRC

// Value tags (one byte before each encoded node).
const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_FLOAT64 = 0x03;
const TAG_UINT = 0x04; // non-negative safe integer, LEB128 varint
const TAG_NINT = 0x05; // negative safe integer, magnitude as LEB128 varint
const TAG_STRING = 0x06; // varint index into the string table
const TAG_ARRAY = 0x07; // varint length, then each element
const TAG_OBJECT = 0x08; // varint field count, then per field: varint key index, then the value

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

// ---------------------------------------------------------------------------------------------------
// Byte writer: a growable buffer with varint, float64 (LE), and uint32 (LE) writers.
// ---------------------------------------------------------------------------------------------------

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;
  private readonly scratch = new DataView(new ArrayBuffer(8));

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let capacity = this.buf.length * 2;
    while (capacity < this.len + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.len] = value & 0xff;
    this.len += 1;
  }

  rawBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  // LEB128 unsigned varint. `value` must be a non-negative safe integer; the 7-bit groups are extracted
  // by division/modulo (not 32-bit bitwise) so values above 2^31 up to 2^53 encode exactly.
  varUint(value: number): void {
    let remaining = value;
    do {
      let group = remaining % 128;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) group += 0x80;
      this.byte(group);
    } while (remaining > 0);
  }

  float64LE(value: number): void {
    this.scratch.setFloat64(0, value, true);
    this.ensure(8);
    for (let i = 0; i < 8; i += 1) {
      this.buf[this.len + i] = this.scratch.getUint8(i);
    }
    this.len += 8;
  }

  uint32LE(value: number): void {
    this.ensure(4);
    const v = value >>> 0;
    this.buf[this.len] = v & 0xff;
    this.buf[this.len + 1] = (v >>> 8) & 0xff;
    this.buf[this.len + 2] = (v >>> 16) & 0xff;
    this.buf[this.len + 3] = (v >>> 24) & 0xff;
    this.len += 4;
  }

  snapshot(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

// ---------------------------------------------------------------------------------------------------
// Byte reader: bounds-checked, with the matching varint, float64 (LE), and uint32 (LE) readers. Every
// out-of-bounds read throws a typed BinaryDecodeError (truncated), never reads past the buffer.
// ---------------------------------------------------------------------------------------------------

class ByteReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private require(n: number): void {
    if (this.offset + n > this.data.length) {
      throw new BinaryDecodeError(
        'truncated',
        `unexpected end of buffer (need ${n} byte(s) at offset ${this.offset})`,
      );
    }
  }

  byte(): number {
    this.require(1);
    const b = this.data[this.offset]!;
    this.offset += 1;
    return b;
  }

  varUint(): number {
    let result = 0;
    let multiplier = 1;
    let group: number;
    do {
      this.require(1);
      group = this.data[this.offset]!;
      this.offset += 1;
      result += (group & 0x7f) * multiplier;
      if ((group & 0x80) !== 0) {
        multiplier *= 128;
        if (multiplier > Number.MAX_SAFE_INTEGER) {
          throw new BinaryDecodeError('malformed', 'varint exceeds the safe integer range');
        }
      }
    } while ((group & 0x80) !== 0);
    return result;
  }

  float64LE(): number {
    this.require(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  uint32LE(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  byteArray(n: number): Uint8Array {
    this.require(n);
    const slice = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }
}

// ---------------------------------------------------------------------------------------------------
// String table (first-encounter order under the fixed traversal). Object KEYS and string VALUES are
// both pooled, which is the bulk of the size win over JSON.
// ---------------------------------------------------------------------------------------------------

function collectStrings(value: unknown, table: Map<string, number>): void {
  if (typeof value === 'string') {
    if (!table.has(value)) table.set(value, table.size);
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) collectStrings(element, table);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      if (!table.has(key)) table.set(key, table.size);
      collectStrings(value[key], table);
    }
  }
  // null, boolean, number: no strings to pool.
}

function orderedStrings(table: ReadonlyMap<string, number>): string[] {
  const ordered = new Array<string>(table.size);
  for (const [text, index] of table) ordered[index] = text;
  return ordered;
}

function stringIndex(table: ReadonlyMap<string, number>, text: string): number {
  const index = table.get(text);
  if (index === undefined) {
    // The table is built from the SAME traversal as the body encode, so this is a programmer error
    // (a traversal mismatch), not malformed external input.
    throw new Error(`string "${text}" was not registered in the string table`);
  }
  return index;
}

// ---------------------------------------------------------------------------------------------------
// Value encode / decode.
// ---------------------------------------------------------------------------------------------------

function encodeNumber(writer: ByteWriter, value: number): void {
  // An exact integer within the safe range is a varint (compact); everything else is float64 (lossless).
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    if (value >= 0) {
      writer.byte(TAG_UINT);
      writer.varUint(value);
    } else {
      writer.byte(TAG_NINT);
      writer.varUint(-value);
    }
    return;
  }
  writer.byte(TAG_FLOAT64);
  writer.float64LE(value);
}

function encodeValue(writer: ByteWriter, value: unknown, table: ReadonlyMap<string, number>): void {
  if (value === null) {
    writer.byte(TAG_NULL);
    return;
  }
  if (typeof value === 'boolean') {
    writer.byte(value ? TAG_TRUE : TAG_FALSE);
    return;
  }
  if (typeof value === 'number') {
    encodeNumber(writer, value);
    return;
  }
  if (typeof value === 'string') {
    writer.byte(TAG_STRING);
    writer.varUint(stringIndex(table, value));
    return;
  }
  if (Array.isArray(value)) {
    writer.byte(TAG_ARRAY);
    writer.varUint(value.length);
    for (const element of value) encodeValue(writer, element, table);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    writer.byte(TAG_OBJECT);
    writer.varUint(keys.length);
    for (const key of keys) {
      writer.varUint(stringIndex(table, key));
      encodeValue(writer, value[key], table);
    }
    return;
  }
  // undefined, function, symbol, bigint: not representable in a JSON document. A SkeletonDocument that
  // reached encode with one of these is a programmer error upstream, not malformed external input.
  throw new Error(`cannot encode a value of type ${typeof value} into the MRNT container`);
}

// A decoded JSON value. The codec produces exactly this shape; the load path narrows it to a
// SkeletonDocument by validating with the section-6 validator (validateDocument).
type DecodedValue =
  | null
  | boolean
  | number
  | string
  | DecodedValue[]
  | { [key: string]: DecodedValue };

function stringFromTable(strings: readonly string[], index: number): string {
  const text = strings[index];
  if (text === undefined) {
    throw new BinaryDecodeError(
      'malformed',
      `string-table index ${index} is out of range (table has ${strings.length} entries)`,
    );
  }
  return text;
}

function decodeValue(reader: ByteReader, strings: readonly string[]): DecodedValue {
  const tag = reader.byte();
  switch (tag) {
    case TAG_NULL:
      return null;
    case TAG_FALSE:
      return false;
    case TAG_TRUE:
      return true;
    case TAG_FLOAT64:
      return reader.float64LE();
    case TAG_UINT:
      return reader.varUint();
    case TAG_NINT: {
      const magnitude = reader.varUint();
      // A canonical encoder never emits NINT(0); guard so a hand-crafted byte cannot decode to -0.
      return magnitude === 0 ? 0 : -magnitude;
    }
    case TAG_STRING:
      return stringFromTable(strings, reader.varUint());
    case TAG_ARRAY: {
      const length = reader.varUint();
      const array: DecodedValue[] = [];
      for (let i = 0; i < length; i += 1) array.push(decodeValue(reader, strings));
      return array;
    }
    case TAG_OBJECT: {
      const count = reader.varUint();
      const object: { [key: string]: DecodedValue } = {};
      for (let i = 0; i < count; i += 1) {
        const key = stringFromTable(strings, reader.varUint());
        object[key] = decodeValue(reader, strings);
      }
      return object;
    }
    default:
      throw new BinaryDecodeError(
        'malformed',
        `unknown value tag 0x${tag.toString(16).padStart(2, '0')} at offset ${reader.position - 1}`,
      );
  }
}

// ---------------------------------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------------------------------

// Encode a SkeletonDocument into an MRNT binary container. Pure and deterministic: the same document
// encodes to byte-identical output (TASK-5.1.1). The header formatVersion is the document's own
// formatVersion (Law 3); the body re-encodes the full document (including its formatVersion field) so the
// round-trip is lossless.
export function encodeBinary(doc: SkeletonDocument): Uint8Array {
  const table = new Map<string, number>();
  collectStrings(doc, table);

  const writer = new ByteWriter();
  for (const b of MAGIC) writer.byte(b);
  writer.byte(CONTAINER_VERSION);
  writer.byte(FLAG_LOSSLESS_FLOAT64);

  const formatVersionBytes = UTF8_ENCODER.encode(doc.formatVersion);
  writer.varUint(formatVersionBytes.length);
  writer.rawBytes(formatVersionBytes);

  const ordered = orderedStrings(table);
  writer.varUint(ordered.length);
  for (const text of ordered) {
    const bytes = UTF8_ENCODER.encode(text);
    writer.varUint(bytes.length);
    writer.rawBytes(bytes);
  }

  encodeValue(writer, doc, table);

  const body = writer.snapshot();
  const out = new Uint8Array(body.length + TRAILER_BYTES);
  out.set(body, 0);
  const crc = crc32(body);
  out[body.length] = crc & 0xff;
  out[body.length + 1] = (crc >>> 8) & 0xff;
  out[body.length + 2] = (crc >>> 16) & 0xff;
  out[body.length + 3] = (crc >>> 24) & 0xff;
  return out;
}

// Decode an MRNT binary container into a SkeletonDocument value. The container is checked in this order:
// length, magic, CRC (integrity before any structural decode), containerVersion, flags, formatVersion
// MAJOR. Any violation throws a typed BinaryDecodeError (never a bare throw, never a silent partial doc).
// The returned value is the structural document; the load path validates it with the SAME section-6
// validator (validateDocument), so the binary path does not get a weaker validator (section 6.1.2).
export function decodeBinary(input: Uint8Array): SkeletonDocument {
  const minimum = MAGIC.length + 1 + 1 + 1 + TRAILER_BYTES; // magic + cver + flags + fvLen + crc
  if (input.length < minimum) {
    throw new BinaryDecodeError('truncated', 'buffer is too short to be an MRNT container');
  }
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (input[i] !== MAGIC[i]) {
      throw new BinaryDecodeError('badMagic', 'not an MRNT container (bad magic bytes)');
    }
  }

  // Integrity check before structural decode (a corrupt file fails loudly first, section 6.1.1).
  const trailerOffset = input.length - TRAILER_BYTES;
  const storedCrc =
    (input[trailerOffset]! |
      (input[trailerOffset + 1]! << 8) |
      (input[trailerOffset + 2]! << 16) |
      (input[trailerOffset + 3]! << 24)) >>>
    0;
  const computedCrc = crc32(input.subarray(0, trailerOffset));
  if (storedCrc !== computedCrc) {
    throw new BinaryDecodeError(
      'crcMismatch',
      'CRC-32 mismatch (the container is corrupt or truncated)',
    );
  }

  const reader = new ByteReader(input.subarray(0, trailerOffset));
  for (let i = 0; i < MAGIC.length; i += 1) reader.byte(); // skip the verified magic

  const containerVersion = reader.byte();
  if (containerVersion !== CONTAINER_VERSION) {
    throw new BinaryDecodeError(
      'unsupportedContainerVersion',
      `unsupported containerVersion ${containerVersion} (this decoder implements ${CONTAINER_VERSION})`,
    );
  }

  const flags = reader.byte();
  if (flags !== FLAG_LOSSLESS_FLOAT64) {
    throw new BinaryDecodeError(
      'malformed',
      `unexpected flags 0x${flags.toString(16).padStart(2, '0')} (containerVersion ${CONTAINER_VERSION} is lossless-float64 only; reserved bits must be 0)`,
    );
  }

  const formatVersionLength = reader.varUint();
  const formatVersion = UTF8_DECODER.decode(reader.byteArray(formatVersionLength));
  const parsed = parseSemVer(formatVersion);
  if (parsed === null) {
    throw new BinaryDecodeError(
      'malformed',
      `header formatVersion "${formatVersion}" is not a valid semver`,
    );
  }
  if (parsed.major !== SUPPORTED_FORMAT_MAJOR) {
    throw new BinaryDecodeError(
      'unsupportedFormatMajor',
      `unsupported formatVersion major ${parsed.major} (this decoder supports major ${SUPPORTED_FORMAT_MAJOR})`,
    );
  }

  const stringCount = reader.varUint();
  const strings = new Array<string>(stringCount);
  for (let i = 0; i < stringCount; i += 1) {
    const length = reader.varUint();
    strings[i] = UTF8_DECODER.decode(reader.byteArray(length));
  }

  const value = decodeValue(reader, strings);
  if (!isRecord(value)) {
    throw new BinaryDecodeError('malformed', 'the decoded document body is not an object');
  }
  if (value['formatVersion'] !== formatVersion) {
    throw new BinaryDecodeError(
      'malformed',
      'the header formatVersion does not match the document body formatVersion',
    );
  }
  if (reader.remaining !== 0) {
    throw new BinaryDecodeError(
      'malformed',
      `${reader.remaining} unexpected trailing byte(s) after the document body`,
    );
  }

  // The structural decode reconstructs the SkeletonDocument value tree; the load path validates it with
  // validateDocument (Law 3), mirroring a JSON.parse boundary. This is the one boundary assertion.
  // eslint-disable-next-line no-restricted-syntax -- decode-boundary cast; callers validate with the section-6 validator (section 6.1.2, INV-4).
  return value as SkeletonDocument;
}
