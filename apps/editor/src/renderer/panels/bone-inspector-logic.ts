import type { DispatchableBoneEdit } from '../viewport/edit-dispatcher';

// Pure parsing, validation, and edit-construction logic for the bone transform inspector (PP-D1). The
// panel (inspector-panel.tsx) is thin glue over the edit dispatcher plus the ephemeral selection store;
// every DECISION worth a test lives here as a pure function with no React, no document access, and no
// side effects (the house convention, mirroring inspector-logic.ts and hierarchy-tree.ts). The editor
// vitest environment is `node`, so the logic is unit-tested here and the .tsx is covered by typecheck
// and lint.

// The seven editable local transform fields, grouped by the channel they route to.
export type BoneTransformField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'shearX' | 'shearY';

// The live local transform the inspector reads and edits (a structural subset of BoneEntity, so a real
// BoneEntity is assignable here and tests can pass a plain object).
export interface BoneTransformValues {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
}

// Parse a numeric field edit, returning the validated value to commit, or null when the edit must NOT be
// dispatched (invalid input OR no change). All fields require a finite number; scaleX/scaleY additionally
// reject exactly 0, because the animation-mode delta is a componentwise quotient against the setup scale
// (setupDelta), so a zero scale would divide by zero, and a zero-scale bone is degenerate. Returning null
// on an unchanged value keeps an idempotent commit (blur with no edit) from creating an empty undo step.
export function parseBoneField(
  field: BoneTransformField,
  raw: string,
  current: number,
): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if ((field === 'scaleX' || field === 'scaleY') && value === 0) return null;
  if (value === current) return null;
  return value;
}

// Build the dispatcher edit for a single-field change. Each channel carries BOTH its components, so a
// per-field edit reads the unchanged component from the live values (for example, editing x keeps the
// live y). The desired value is the local transform the bone should HAVE, which is exactly what the
// dispatcher expects (setup mode writes it; animation mode keys the setup-relative delta).
export function buildBoneEdit(
  field: BoneTransformField,
  value: number,
  live: BoneTransformValues,
): DispatchableBoneEdit {
  switch (field) {
    case 'x':
      return { channel: 'translate', x: value, y: live.y };
    case 'y':
      return { channel: 'translate', x: live.x, y: value };
    case 'rotation':
      return { channel: 'rotate', rotation: value };
    case 'scaleX':
      return { channel: 'scale', scaleX: value, scaleY: live.scaleY };
    case 'scaleY':
      return { channel: 'scale', scaleX: live.scaleX, scaleY: value };
    case 'shearX':
      return { channel: 'shear', shearX: value, shearY: live.shearY };
    case 'shearY':
      return { channel: 'shear', shearX: live.shearX, shearY: value };
  }
}
