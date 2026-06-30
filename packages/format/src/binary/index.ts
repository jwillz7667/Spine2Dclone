// Barrel for the MRNT binary codec (phase-5 WP-5.1). A compact, deterministic, lossless second
// serialization of the SkeletonDocument logical schema, carrying the SAME formatVersion as the JSON and
// validated by the SAME validator after decode (section 6.1.2). The pinned CRC-32/ISO-HDLC is exported
// for the cross-language equivalence golden vector (phase-5 TASK-5.5.7).
export { encodeBinary, decodeBinary } from './codec';
export { crc32 } from './crc32';
export { BinaryDecodeError, BINARY_DECODE_ERROR_CODES } from './errors';
export type { BinaryDecodeErrorCode } from './errors';
