import type { SpineImportErrorCode } from '../types';

// A thrown, fatal binary-decode fault. Unlike the JSON path (which collects every diagnostic in one
// pass), a structural fault in a byte stream desynchronizes every subsequent read, so decoding stops at
// the first fault and surfaces it loudly (PP-A5 guardrail: fail loud, never guess). importSpineSkel
// catches this and returns it as the single typed SpineImportError. `code` is one of the binary or
// version SpineImportErrorCode values; `path` is a JSON-Pointer-style locator into the logical document.
export class SpineBinaryError extends Error {
  constructor(
    readonly code: SpineImportErrorCode,
    readonly path: string,
    message: string,
    readonly detail?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = 'SpineBinaryError';
  }
}

// The shared string table (Spine binary stores repeated strings once and references them by index). Index
// 0 is the null reference; index N (N > 0) addresses entry N - 1. Entries may themselves be null.
export type StringTable = readonly (string | null)[];

// A cursor over the .skel byte buffer implementing the primitive encodings described by the PUBLISHED
// Spine binary format reference (esotericsoftware.com/spine-binary-format), and NOTHING derived from any
// Spine runtime source (LAW 4 + PP-A5 clean-room guardrail):
//   - integers/floats are big-endian; a float is a 32-bit int reinterpreted as IEEE-754.
//   - a varint is little-endian base-128 (7 data bits per byte, high bit = continuation, max 5 bytes);
//     the "positive" form is used directly, the signed form applies zigzag decoding (v >>> 1) ^ -(v & 1).
//   - an inline string is a varint+ (byteLength + 1): 0 => null, 1 => "", n => (n - 1) UTF-8 bytes.
//   - a color is a 32-bit RGBA integer (one byte per channel, R in the high byte).
// Every read is bounds-checked; reading past the end throws SPINE_BINARY_TRUNCATED rather than returning
// undefined or hanging.
export class SkelReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private cursor = 0;
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.cursor;
  }

  get atEnd(): boolean {
    return this.cursor >= this.bytes.byteLength;
  }

  private require(count: number, path: string, what: string): void {
    if (this.cursor + count > this.bytes.byteLength) {
      throw new SpineBinaryError(
        'SPINE_BINARY_TRUNCATED',
        path,
        `unexpected end of .skel input reading ${what} (need ${count} byte(s) at offset ${this.cursor}, have ${this.bytes.byteLength - this.cursor})`,
        { offset: this.cursor },
      );
    }
  }

  byte(path: string, what = 'byte'): number {
    this.require(1, path, what);
    const value = this.bytes[this.cursor]!;
    this.cursor += 1;
    return value;
  }

  bool(path: string, what = 'boolean'): boolean {
    return this.byte(path, what) !== 0;
  }

  // A signed 8-bit value (used where the format stores a small signed constant such as a bend direction).
  sbyte(path: string, what = 'signed byte'): number {
    const value = this.byte(path, what);
    return value < 0x80 ? value : value - 0x100;
  }

  short(path: string, what = 'short'): number {
    this.require(2, path, what);
    const value = this.view.getUint16(this.cursor, false);
    this.cursor += 2;
    return value;
  }

  int32(path: string, what = 'int'): number {
    this.require(4, path, what);
    const value = this.view.getInt32(this.cursor, false);
    this.cursor += 4;
    return value;
  }

  float(path: string, what = 'float'): number {
    this.require(4, path, what);
    const value = this.view.getFloat32(this.cursor, false);
    this.cursor += 4;
    return value;
  }

  // A base-128 varint. `optimizePositive` false applies zigzag decoding for values optimized around zero.
  // At most 5 bytes encode a 32-bit value; a 6th continuation byte is malformed input, not a hang.
  varint(path: string, optimizePositive: boolean, what = 'varint'): number {
    let raw = 0;
    let shift = 0;
    for (let i = 0; i < 5; i += 1) {
      const b = this.byte(path, what);
      raw |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        const unsigned = raw >>> 0;
        return optimizePositive ? unsigned : (unsigned >>> 1) ^ -(unsigned & 1);
      }
      shift += 7;
    }
    throw new SpineBinaryError(
      'SPINE_BINARY_INVALID',
      path,
      `malformed varint at offset ${this.cursor} (more than 5 continuation bytes)`,
      { offset: this.cursor },
    );
  }

  // A non-negative count or index. The unsigned varint can decode to a value with the high bit set (a
  // corrupt stream); such an absurd length is rejected so callers never allocate or loop on it.
  count(path: string, what = 'count'): number {
    const value = this.varint(path, true, what);
    if (value < 0 || value > 0x7fffffff) {
      throw new SpineBinaryError('SPINE_BINARY_INVALID', path, `invalid ${what} ${value}`, {
        value,
      });
    }
    return value;
  }

  // An inline UTF-8 string: varint+ (byteLength + 1). 0 => null, 1 => empty, n => (n - 1) bytes.
  string(path: string, what = 'string'): string | null {
    const encoded = this.count(path, `${what} length`);
    if (encoded === 0) return null;
    if (encoded === 1) return '';
    const byteLength = encoded - 1;
    this.require(byteLength, path, what);
    const slice = this.bytes.subarray(this.cursor, this.cursor + byteLength);
    this.cursor += byteLength;
    return this.decoder.decode(slice);
  }

  // A reference into the shared string table: varint+ index, 0 => null, else table[index - 1]. An index
  // past the table is a corrupt reference, surfaced loudly rather than yielding undefined.
  stringRef(table: StringTable, path: string, what = 'string reference'): string | null {
    const index = this.count(path, `${what} index`);
    if (index === 0) return null;
    if (index - 1 >= table.length) {
      throw new SpineBinaryError(
        'SPINE_BINARY_INVALID',
        path,
        `${what} index ${index} is out of range (table holds ${table.length} string(s))`,
        { index, tableSize: table.length },
      );
    }
    return table[index - 1] ?? null;
  }

  // A 32-bit RGBA color rendered as the 8-digit "RRGGBBAA" hex string the conversion core parses (the
  // JSON path reads the same hex form), so binary and JSON colors converge through one code path.
  colorRgba(path: string, what = 'color'): string {
    const value = this.int32(path, what) >>> 0;
    return value.toString(16).padStart(8, '0');
  }

  // A dark-tint color: a 32-bit value where -1 (0xFFFFFFFF) is the "no dark tint" sentinel. A real color
  // uses the high three bytes (RGB); the low byte is unused, so it is emitted as a 6-digit "RRGGBB" hex
  // matching the JSON slot `dark` convention (alpha is forced to 1 by the converter).
  colorDark(path: string, what = 'dark color'): string | null {
    const value = this.int32(path, what);
    if (value === -1) return null;
    const rgb = (value >>> 8) & 0xffffff;
    return rgb.toString(16).padStart(6, '0');
  }
}
