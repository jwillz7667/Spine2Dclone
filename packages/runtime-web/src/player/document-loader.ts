import { decodeBinary, parseDocument } from '@marionette/format';
import { parseEffectsDocument } from '@marionette/format/effects';
import type { EffectsDocument, SkeletonDocument } from '@marionette/format/types';

// The packaged player's document decode (PP-C5). A skeleton document reaches the player as MRNT binary
// bytes, JSON text, JSON bytes, or an already-parsed object; this module normalizes all four to a
// VALIDATED SkeletonDocument, failing loud with a typed PlayerLoadError (Law 3: validate on import). It is
// PURE (no PixiJS, no fetch, no Node built-ins): it uses the global TextDecoder / JSON, so it is fully
// headless-testable. The binary path decodes through the format codec and then runs the SAME section-6
// validator the JSON path runs, so the binary load is not a weaker gate.

// The MRNT container magic ("MRNT"); a byte source starting with it is decoded as binary, otherwise it is
// treated as UTF-8 JSON text (mirrors the format codec's magic).
const MRNT_MAGIC: readonly number[] = [0x4d, 0x52, 0x4e, 0x54];

// A skeleton document source the player accepts: MRNT / JSON bytes, JSON text, or a parsed object.
export type SkeletonSource = Uint8Array | string | SkeletonDocument | unknown;

// An effects document source (JSON only; effects has no binary container): bytes, text, or a parsed object.
export type EffectsSource = Uint8Array | string | EffectsDocument | unknown;

// Thrown when a player asset cannot be decoded / validated. A typed error carrying a code and the wrapped
// cause (the underlying FormatValidationError / BinaryDecodeError / SyntaxError), so a host can branch on
// `code` and inspect `cause` rather than string-matching. Mirrors the LocalizedError enum discipline.
export type PlayerLoadErrorCode =
  | 'skeletonDecode'
  | 'skeletonValidate'
  | 'effectsDecode'
  | 'effectsValidate'
  | 'jsonParse'
  | 'assetFetch';

export class PlayerLoadError extends Error {
  override readonly name = 'PlayerLoadError';
  readonly code: PlayerLoadErrorCode;

  constructor(code: PlayerLoadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

const UTF8 = new TextDecoder();

function hasMrntMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MRNT_MAGIC.length) return false;
  for (let i = 0; i < MRNT_MAGIC.length; i += 1) {
    if (bytes[i] !== MRNT_MAGIC[i]) return false;
  }
  return true;
}

// Parse JSON text into an unknown value, wrapping a syntax error in a typed PlayerLoadError.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new PlayerLoadError('jsonParse', 'player asset is not valid JSON', { cause });
  }
}

// Decode + validate a skeleton document from any accepted source. MRNT bytes decode through the format
// codec (a corrupt container throws BinaryDecodeError, wrapped as skeletonDecode); JSON bytes / text parse
// then validate; a parsed object validates directly. A validation failure is wrapped as skeletonValidate
// (the underlying FormatValidationError is the cause) so the caller sees a typed player error.
export function decodeSkeletonDocument(source: SkeletonSource): SkeletonDocument {
  if (source instanceof Uint8Array) {
    if (hasMrntMagic(source)) {
      let decoded: SkeletonDocument;
      try {
        decoded = decodeBinary(source);
      } catch (cause) {
        throw new PlayerLoadError('skeletonDecode', 'failed to decode MRNT skeleton container', {
          cause,
        });
      }
      return validateSkeleton(decoded);
    }
    return validateSkeleton(parseJson(UTF8.decode(source)));
  }
  if (typeof source === 'string') return validateSkeleton(parseJson(source));
  return validateSkeleton(source);
}

function validateSkeleton(input: unknown): SkeletonDocument {
  try {
    // Runtimes treat `hash` as opaque (format-contract section 9.3), so hash verification is off.
    return parseDocument(input, { verifyHash: false });
  } catch (cause) {
    throw new PlayerLoadError('skeletonValidate', 'skeleton document failed validation', { cause });
  }
}

// Decode + validate an effects document (JSON only). Same typed-error discipline as the skeleton path.
export function decodeEffectsDocument(source: EffectsSource): EffectsDocument {
  const input =
    source instanceof Uint8Array
      ? parseJson(UTF8.decode(source))
      : typeof source === 'string'
        ? parseJson(source)
        : source;
  try {
    return parseEffectsDocument(input);
  } catch (cause) {
    throw new PlayerLoadError('effectsValidate', 'effects document failed validation', { cause });
  }
}
