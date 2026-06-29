import { z } from 'zod';
import { isRecord } from '../../internal/guards';
import { jsonPointer } from '../../validate/structural';
import { effectsDocumentSchema } from '../schema/document';
import type { EffectsDocument } from '../schema/document';
import { projectManifestSchema } from '../schema/manifest';
import type { ProjectManifest } from '../schema/manifest';
import { effectsError, isEffectsErrorCode } from './errors';
import type { EffectsError } from './errors';

// Structural (shape) layer for the effects format. Zod `.safeParse` against the closed schema. On
// success the already-typed `result.data` flows through with ZERO casts. On failure every Zod issue
// is mapped to an EffectsError so the caller sees all shape problems in one pass. Refinement issues
// (the RGB range) carry a `params.code` naming the specific EffectsErrorCode; every other issue maps
// to `shapeCode` (EFFECT_SCHEMA_SHAPE for documents, PROJECT_SCHEMA_SHAPE for manifests). `jsonPointer`
// is reused from the skeletal structural layer so the two formats produce identical RFC-6901 paths.
function issueToEffectsError(
  issue: z.ZodIssue,
  shapeCode: 'EFFECT_SCHEMA_SHAPE' | 'PROJECT_SCHEMA_SHAPE',
): EffectsError {
  if (issue.code === z.ZodIssueCode.custom) {
    const params: unknown = issue.params;
    if (isRecord(params)) {
      const candidate = params['code'];
      if (isEffectsErrorCode(candidate)) {
        return effectsError(candidate, jsonPointer(issue.path), issue.message);
      }
    }
  }
  return effectsError(shapeCode, jsonPointer(issue.path), issue.message);
}

export interface EffectsStructuralResult {
  readonly ok: boolean;
  readonly document: EffectsDocument | null; // result.data (already typed), non-null when ok
  readonly errors: readonly EffectsError[];
}

export function validateEffectsStructure(input: unknown): EffectsStructuralResult {
  const result = effectsDocumentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, document: result.data, errors: [] };
  }
  return {
    ok: false,
    document: null,
    errors: result.error.issues.map((issue) => issueToEffectsError(issue, 'EFFECT_SCHEMA_SHAPE')),
  };
}

export interface ManifestStructuralResult {
  readonly ok: boolean;
  readonly manifest: ProjectManifest | null;
  readonly errors: readonly EffectsError[];
}

export function validateManifestStructure(input: unknown): ManifestStructuralResult {
  const result = projectManifestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, manifest: result.data, errors: [] };
  }
  return {
    ok: false,
    manifest: null,
    errors: result.error.issues.map((issue) => issueToEffectsError(issue, 'PROJECT_SCHEMA_SHAPE')),
  };
}
