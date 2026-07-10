import { decodeSkel } from './binary/decode-skel';
import { SpineBinaryError } from './binary/reader';
import { finalizeSpineImport } from './pipeline';
import type { SpineImportError, SpineImportOptions, SpineImportResult } from './types';

// Import a user-owned exported Spine .skel BINARY project and convert it to a VALIDATED
// @marionette/format 0.6.0 SkeletonDocument (PP-A5 slice 2). Pure and deterministic: it reads the bytes
// the caller supplies (no filesystem, no globals), decodes them per the PUBLISHED Spine binary format
// reference into the SAME name-based intermediate the JSON path builds, and runs the SAME conversion and
// validation pipeline, so equivalent .skel and JSON content converge to identical documents.
//
// Legal posture (LAW 4 + PP-A5 guardrails): import only, never export; strict clean-room, implemented
// solely from Esoteric's PUBLISHED binary format documentation and inspection of user-owned files, never
// from Spine runtime or editor source. See the package README.
//
// Failure is loud and typed. A malformed binary (truncation, out-of-range reference, unknown enum
// constant, absurd count) stops decoding at the first fault and returns one SpineBinaryError-derived
// SpineImportError (SPINE_BINARY_TRUNCATED / SPINE_BINARY_INVALID); an unsupported or missing version
// returns SPINE_VERSION_UNSUPPORTED / SPINE_VERSION_MISSING; and a decoded-but-invalid document surfaces
// each underlying format error as SPINE_DOCUMENT_INVALID, exactly like the JSON path.
export function importSpineSkel(
  input: Uint8Array | ArrayBuffer,
  options?: SpineImportOptions,
): SpineImportResult {
  const bytes = toBytes(input);
  if (bytes === undefined) {
    const error: SpineImportError = {
      code: 'SPINE_BINARY_INVALID',
      path: '',
      message: 'importSpineSkel expects a Uint8Array or ArrayBuffer of .skel bytes',
    };
    return { ok: false, errors: [error], warnings: [] };
  }

  let intermediate: unknown;
  try {
    intermediate = decodeSkel(bytes);
  } catch (caught) {
    if (caught instanceof SpineBinaryError) {
      const error: SpineImportError =
        caught.detail === undefined
          ? { code: caught.code, path: caught.path, message: caught.message }
          : {
              code: caught.code,
              path: caught.path,
              message: caught.message,
              detail: caught.detail,
            };
      return { ok: false, errors: [error], warnings: [] };
    }
    throw caught;
  }

  return finalizeSpineImport(intermediate, options);
}

// Normalize the accepted binary inputs to a Uint8Array view. A DataView or Node Buffer is a Uint8Array
// subclass or wraps an ArrayBuffer, so both are covered. Anything else (a stray string or object crossing
// an untyped boundary) is rejected rather than mis-decoded.
function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array | undefined {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return undefined;
}
