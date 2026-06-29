import { z } from 'zod';
import { isRecord } from '../../internal/guards';
import { jsonPointer } from '../../validate/structural';
import { slotSceneDocumentSchema } from '../scene-document';
import type { SlotSceneDocument } from '../scene-document';
import { slotProjectManifestSchema } from '../manifest';
import type { SlotProjectManifest } from '../manifest';
import { slotSceneError, isSlotSceneErrorCode } from './errors';
import type { SlotSceneError } from './errors';

// Structural (shape) layer for the slot scene format. Zod `.safeParse` against the closed schema. On
// success the already-typed `result.data` flows through with ZERO casts. On failure every Zod issue is
// mapped to a SlotSceneError so the caller sees all shape problems in one pass. Refinement issues that
// carry a `params.code` naming a specific SlotSceneErrorCode pass that code through; every other issue
// maps to `shapeCode` (`slotSchemaShape` for documents, `projectSchemaShape` for manifests).
// `jsonPointer` is reused from the skeletal structural layer so all three formats produce identical
// RFC-6901 paths.
function issueToSlotSceneError(
  issue: z.ZodIssue,
  shapeCode: 'slotSchemaShape' | 'projectSchemaShape',
): SlotSceneError {
  if (issue.code === z.ZodIssueCode.custom) {
    const params: unknown = issue.params;
    if (isRecord(params)) {
      const candidate = params['code'];
      if (isSlotSceneErrorCode(candidate)) {
        return slotSceneError(candidate, jsonPointer(issue.path), issue.message);
      }
    }
  }
  return slotSceneError(shapeCode, jsonPointer(issue.path), issue.message);
}

export interface SlotStructuralResult {
  readonly ok: boolean;
  readonly document: SlotSceneDocument | null; // result.data (already typed), non-null when ok
  readonly errors: readonly SlotSceneError[];
}

export function validateSlotSceneStructure(input: unknown): SlotStructuralResult {
  const result = slotSceneDocumentSchema.safeParse(input);
  if (result.success) {
    return { ok: true, document: result.data, errors: [] };
  }
  return {
    ok: false,
    document: null,
    errors: result.error.issues.map((issue) => issueToSlotSceneError(issue, 'slotSchemaShape')),
  };
}

export interface SlotManifestStructuralResult {
  readonly ok: boolean;
  readonly manifest: SlotProjectManifest | null;
  readonly errors: readonly SlotSceneError[];
}

export function validateSlotManifestStructure(input: unknown): SlotManifestStructuralResult {
  const result = slotProjectManifestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, manifest: result.data, errors: [] };
  }
  return {
    ok: false,
    manifest: null,
    errors: result.error.issues.map((issue) => issueToSlotSceneError(issue, 'projectSchemaShape')),
  };
}
