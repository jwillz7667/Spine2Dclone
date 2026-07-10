import type { Bone, TransformMode } from '@marionette/format';
import type { Diagnostics } from '../diagnostics';
import { isTransformMode } from '../enums';
import {
  asRecord,
  ptr,
  readNumber,
  readOptionalString,
  readRequiredString,
  readString,
  type JsonRecord,
} from '../read';

// Spine's five inherit modes use the same identifiers our format does (handoff section 6 / the published
// Spine documentation both list normal, onlyTranslation, noRotationOrReflection, noScale,
// noScaleOrReflection), so the transform mode maps by identity. An unknown value is SPINE_SCHEMA.
function readTransformMode(rec: JsonRecord, base: string, diag: Diagnostics): TransformMode {
  const raw = readString(rec, 'transform', base, diag, 'normal');
  if (isTransformMode(raw)) return raw;
  diag.error('SPINE_SCHEMA', ptr(base, 'transform'), `unknown bone transform mode "${raw}"`);
  return 'normal';
}

// Convert Spine's `bones` array. Field defaults follow the published documentation: length 0, x/y 0,
// rotation 0, scaleX/scaleY 1, shearX/shearY 0, transform "normal". A root bone has no `parent`, which
// we model as parent: null. The nonessential bone `color` and the `skin` flag (skin scoping lives on the
// skin's `bones` list, handled by the skins converter) are intentionally not carried onto the bone.
export function convertBones(bones: readonly unknown[], base: string, diag: Diagnostics): Bone[] {
  const out: Bone[] = [];
  for (const [index, raw] of bones.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    if (name === undefined) continue;
    out.push({
      name,
      parent: readOptionalString(rec, 'parent', path, diag) ?? null,
      length: readNumber(rec, 'length', path, diag, 0),
      x: readNumber(rec, 'x', path, diag, 0),
      y: readNumber(rec, 'y', path, diag, 0),
      rotation: readNumber(rec, 'rotation', path, diag, 0),
      scaleX: readNumber(rec, 'scaleX', path, diag, 1),
      scaleY: readNumber(rec, 'scaleY', path, diag, 1),
      shearX: readNumber(rec, 'shearX', path, diag, 0),
      shearY: readNumber(rec, 'shearY', path, diag, 0),
      transformMode: readTransformMode(rec, path, diag),
    });
  }
  return out;
}
