import type {
  IkConstraint,
  PathConstraint,
  PathPositionMode,
  PathRotateMode,
  PathSpacingMode,
  TransformConstraint,
} from '@marionette/format';
import type { Diagnostics } from '../diagnostics';
import {
  asRecord,
  ptr,
  readNumber,
  readOptionalNumber,
  readRequiredString,
  readString,
  readStringArrayField,
  type JsonRecord,
} from '../read';

// Optional explicit solve order. Spine and our format both use a non-negative integer index into the
// single ordering over all constraints. Present values are carried through; the format validator owns
// the density/uniqueness check across the combined constraint set (CONSTRAINT_ORDER_INVALID).
function readOrder(rec: JsonRecord, base: string, diag: Diagnostics): { order?: number } {
  const order = readOptionalNumber(rec, 'order', base, diag);
  return order === undefined ? {} : { order };
}

// Convert Spine's top-level `ik` array. Defaults per the published documentation: mix 1, softness 0,
// bendPositive true, compress/stretch/uniform false. Our format encodes the bend as a signed direction
// (+1 / -1) that supersedes the boolean: bendPositive true -> +1, false -> -1.
export function convertIkConstraints(
  ik: readonly unknown[],
  base: string,
  diag: Diagnostics,
): IkConstraint[] {
  const out: IkConstraint[] = [];
  for (const [index, raw] of ik.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    const target = readRequiredString(rec, 'target', path, diag);
    if (name === undefined || target === undefined) continue;
    const bendPositive = rec['bendPositive'] === undefined ? true : rec['bendPositive'] === true;
    out.push({
      name,
      bones: readStringArrayField(rec, 'bones', path, diag),
      target,
      mix: readNumber(rec, 'mix', path, diag, 1),
      bend: bendPositive ? 1 : -1,
      softness: readNumber(rec, 'softness', path, diag, 0),
      stretch: rec['stretch'] === true,
      compress: rec['compress'] === true,
      uniform: rec['uniform'] === true,
      ...readOrder(rec, path, diag),
    });
  }
  return out;
}

// Convert Spine's top-level `transform` array. Spine keeps ONE mix per family (rotateMix, translateMix,
// scaleMix, shearMix) while our format splits translate and scale per axis, so translateMix drives both
// mixX and mixY and scaleMix drives both mixScaleX and mixScaleY. Offsets map by name (rotation, x, y,
// scaleX, scaleY, shearY). Defaults: mixes 1, offsets 0, local/relative false.
export function convertTransformConstraints(
  transform: readonly unknown[],
  base: string,
  diag: Diagnostics,
): TransformConstraint[] {
  const out: TransformConstraint[] = [];
  for (const [index, raw] of transform.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    const target = readRequiredString(rec, 'target', path, diag);
    if (name === undefined || target === undefined) continue;
    const translateMix = readNumber(rec, 'translateMix', path, diag, 1);
    const scaleMix = readNumber(rec, 'scaleMix', path, diag, 1);
    out.push({
      name,
      bones: readStringArrayField(rec, 'bones', path, diag),
      target,
      mixRotate: readNumber(rec, 'rotateMix', path, diag, 1),
      mixX: translateMix,
      mixY: translateMix,
      mixScaleX: scaleMix,
      mixScaleY: scaleMix,
      mixShearY: readNumber(rec, 'shearMix', path, diag, 1),
      offsetRotation: readNumber(rec, 'rotation', path, diag, 0),
      offsetX: readNumber(rec, 'x', path, diag, 0),
      offsetY: readNumber(rec, 'y', path, diag, 0),
      offsetScaleX: readNumber(rec, 'scaleX', path, diag, 0),
      offsetScaleY: readNumber(rec, 'scaleY', path, diag, 0),
      offsetShearY: readNumber(rec, 'shearY', path, diag, 0),
      local: rec['local'] === true,
      relative: rec['relative'] === true,
      ...readOrder(rec, path, diag),
    });
  }
  return out;
}

function readPositionMode(rec: JsonRecord, base: string, diag: Diagnostics): PathPositionMode {
  const raw = readString(rec, 'positionMode', base, diag, 'percent');
  if (raw === 'fixed' || raw === 'percent') return raw;
  diag.error('SPINE_SCHEMA', ptr(base, 'positionMode'), `unknown path positionMode "${raw}"`);
  return 'percent';
}

function readSpacingMode(rec: JsonRecord, base: string, diag: Diagnostics): PathSpacingMode {
  const raw = readString(rec, 'spacingMode', base, diag, 'length');
  if (raw === 'length' || raw === 'fixed' || raw === 'percent' || raw === 'proportional')
    return raw;
  diag.error('SPINE_SCHEMA', ptr(base, 'spacingMode'), `unknown path spacingMode "${raw}"`);
  return 'length';
}

function readRotateMode(rec: JsonRecord, base: string, diag: Diagnostics): PathRotateMode {
  const raw = readString(rec, 'rotateMode', base, diag, 'tangent');
  if (raw === 'tangent' || raw === 'chain') return raw;
  // Spine spells the length-preserving mode "chain scale"; our format spells it "chainScale".
  if (raw === 'chainScale' || raw === 'chain scale') return 'chainScale';
  diag.error('SPINE_SCHEMA', ptr(base, 'rotateMode'), `unknown path rotateMode "${raw}"`);
  return 'tangent';
}

// Convert Spine's top-level `path` constraint array. A path constraint drives rotation and x/y only, so
// Spine's single translateMix maps to both mixX and mixY. Defaults: positionMode percent, spacingMode
// length, rotateMode tangent, position/spacing/rotation 0, mixes 1.
export function convertPathConstraints(
  paths: readonly unknown[],
  base: string,
  diag: Diagnostics,
): PathConstraint[] {
  const out: PathConstraint[] = [];
  for (const [index, raw] of paths.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    const target = readRequiredString(rec, 'target', path, diag);
    if (name === undefined || target === undefined) continue;
    const translateMix = readNumber(rec, 'translateMix', path, diag, 1);
    out.push({
      name,
      target,
      bones: readStringArrayField(rec, 'bones', path, diag),
      positionMode: readPositionMode(rec, path, diag),
      spacingMode: readSpacingMode(rec, path, diag),
      rotateMode: readRotateMode(rec, path, diag),
      position: readNumber(rec, 'position', path, diag, 0),
      spacing: readNumber(rec, 'spacing', path, diag, 0),
      offsetRotation: readNumber(rec, 'rotation', path, diag, 0),
      mixRotate: readNumber(rec, 'rotateMix', path, diag, 1),
      mixX: translateMix,
      mixY: translateMix,
      ...readOrder(rec, path, diag),
    });
  }
  return out;
}

// Physics constraints (Spine 4.2) are not converted: the physics JSON field layout is outside the
// published documentation this importer was built from. Their presence is surfaced (never silently
// dropped) and an empty physicsConstraints list is emitted so the document validates.
export function warnPhysicsConstraints(
  physics: readonly unknown[],
  base: string,
  diag: Diagnostics,
): void {
  if (physics.length > 0) {
    diag.warn(
      'physics-constraint',
      base,
      `${physics.length} physics constraint(s) are not converted (field layout outside the published documentation)`,
      { count: physics.length },
    );
  }
}
