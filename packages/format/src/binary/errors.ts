// The typed decode error for the MRNT binary container (phase-5 WP-5.1, TASK-5.1.5). decodeBinary
// throws a BinaryDecodeError (never a bare Error, never a silent partial document) on any malformed
// input, discriminated by a stable `code` so callers and native-runtime ports can branch on the exact
// failure (mirrors the format package's FormatValidationError discipline: errors carry a stable code,
// not a bare string).

export const BINARY_DECODE_ERROR_CODES = [
  // The 4-byte magic is not "MRNT" (Law 4: not a Spine .skel, not any other container).
  'badMagic',
  // The containerVersion byte is a binary-layout revision this decoder does not implement.
  'unsupportedContainerVersion',
  // The header formatVersion has a MAJOR this decoder does not support (Law 3 rejects unknown major).
  'unsupportedFormatMajor',
  // The trailer CRC-32/ISO-HDLC does not match the recomputed CRC (corrupt or truncated bytes).
  'crcMismatch',
  // The buffer ended before a field that was expected (truncated container).
  'truncated',
  // Structurally well-formed-magic bytes that violate the encoding (bad value tag, out-of-range string
  // index, bad flags, header/body formatVersion disagreement, trailing bytes, oversized varint).
  'malformed',
] as const;

export type BinaryDecodeErrorCode = (typeof BINARY_DECODE_ERROR_CODES)[number];

export class BinaryDecodeError extends Error {
  readonly code: BinaryDecodeErrorCode;

  constructor(code: BinaryDecodeErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BinaryDecodeError';
    this.code = code;
    // Restore the prototype chain so `instanceof BinaryDecodeError` holds after transpilation to ES5
    // targets (the standard Error-subclass guard).
    Object.setPrototypeOf(this, BinaryDecodeError.prototype);
  }
}
