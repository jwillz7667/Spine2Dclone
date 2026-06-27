import { z } from 'zod';
import { skeletonDocumentSchema } from '../schema/document';
import type { SkeletonDocument } from '../schema/document';
import { isRecord } from '../internal/guards';
import { formatError, isFormatErrorCode } from './errors';
import type { FormatError } from './errors';

// Encode one JSON Pointer reference token (RFC 6901): `~` -> `~0`, `/` -> `~1`.
function encodePointerToken(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

// Build a JSON Pointer from a Zod issue path. The empty path addresses the document root ("").
export function jsonPointer(path: ReadonlyArray<string | number>): string {
  return path.map((token) => `/${encodePointerToken(token)}`).join('');
}

// Map a single Zod issue to a typed FormatError. Refinement issues (color/curve range) carry a
// `params.code` naming the specific FormatErrorCode; every other issue is a generic SCHEMA_SHAPE.
function issueToFormatError(issue: z.ZodIssue): FormatError {
  if (issue.code === z.ZodIssueCode.custom) {
    const params: unknown = issue.params;
    if (isRecord(params)) {
      const candidate = params['code'];
      if (isFormatErrorCode(candidate)) {
        return formatError(candidate, jsonPointer(issue.path), issue.message);
      }
    }
  }
  return formatError('SCHEMA_SHAPE', jsonPointer(issue.path), issue.message);
}

export interface StructuralResult {
  readonly ok: boolean;
  readonly document: SkeletonDocument | null; // result.data (already typed), non-null when ok
  readonly errors: readonly FormatError[];
}

// Structural (shape) layer: Zod `.safeParse` against the closed document schema. On success the
// already-typed `result.data` flows through with ZERO casts (format-contract section 2). On failure
// every Zod issue is mapped to a FormatError so the caller sees all shape problems in one pass.
export function validateStructure(input: unknown): StructuralResult {
  const result = skeletonDocumentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, document: result.data, errors: [] };
  }
  return { ok: false, document: null, errors: result.error.issues.map(issueToFormatError) };
}
