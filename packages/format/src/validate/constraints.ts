import type { Bone } from '../schema/bone';
import type { SkeletonDocument } from '../schema/document';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { jsonPointer } from './structural';

// CONSTRAINT family (format-contract section 4.7, ADR-0003). Referential integrity for IK and
// transform constraints: bones and targets must exist, a 2-bone IK chain must be parent-then-direct-
// child, and constraint names must be unique across BOTH arrays. Arity (IK_BONES_ARITY) and mix range
// (IK_MIX_RANGE / TC_MIX_RANGE) are structural (schema/constraint.ts), so by the time semantic runs an
// IK chain is already known to be 1 or 2 bones. The no-cycle property (ADR-0003 section 5) is
// safe-by-construction in the solver (resolveWorld is a pure ancestor walk on current local state) and
// is additionally guarded at editor authoring time; the frozen FormatErrorCode union carries no cycle
// code, so the format does not adjudicate it.

function boneByName(doc: SkeletonDocument): Map<string, Bone> {
  const map = new Map<string, Bone>();
  for (const bone of doc.bones) map.set(bone.name, bone);
  return map;
}

function checkConstraintNames(doc: SkeletonDocument, errors: FormatError[]): void {
  const seen = new Set<string>();
  for (const [index, constraint] of doc.ikConstraints.entries()) {
    if (seen.has(constraint.name)) {
      errors.push(
        formatError(
          'CONSTRAINT_NAME_DUPLICATE',
          jsonPointer(['ikConstraints', index, 'name']),
          `constraint name "${constraint.name}" is not unique`,
          { name: constraint.name },
        ),
      );
    } else {
      seen.add(constraint.name);
    }
  }
  for (const [index, constraint] of doc.transformConstraints.entries()) {
    if (seen.has(constraint.name)) {
      errors.push(
        formatError(
          'CONSTRAINT_NAME_DUPLICATE',
          jsonPointer(['transformConstraints', index, 'name']),
          `constraint name "${constraint.name}" is not unique`,
          { name: constraint.name },
        ),
      );
    } else {
      seen.add(constraint.name);
    }
  }
}

function checkIk(doc: SkeletonDocument, bones: Map<string, Bone>, errors: FormatError[]): void {
  for (const [index, ik] of doc.ikConstraints.entries()) {
    for (const [boneIdx, boneName] of ik.bones.entries()) {
      if (!bones.has(boneName)) {
        errors.push(
          formatError(
            'IK_BONE_MISSING',
            jsonPointer(['ikConstraints', index, 'bones', boneIdx]),
            `ik constraint "${ik.name}" references bone "${boneName}", which does not exist`,
            { bone: boneName, constraint: ik.name },
          ),
        );
      }
    }
    if (!bones.has(ik.target)) {
      errors.push(
        formatError(
          'IK_TARGET_MISSING',
          jsonPointer(['ikConstraints', index, 'target']),
          `ik constraint "${ik.name}" targets bone "${ik.target}", which does not exist`,
          { target: ik.target, constraint: ik.name },
        ),
      );
    }
    if (ik.bones.length === 2) {
      const parentName = ik.bones[0]!;
      const childName = ik.bones[1]!;
      const child = bones.get(childName);
      if (child !== undefined && bones.has(parentName) && child.parent !== parentName) {
        errors.push(
          formatError(
            'IK_CHAIN_DISCONTINUOUS',
            jsonPointer(['ikConstraints', index, 'bones', 1]),
            `ik constraint "${ik.name}" chain is discontinuous: "${childName}" is not a direct child of "${parentName}"`,
            { parent: parentName, child: childName, constraint: ik.name },
          ),
        );
      }
    }
  }
}

function checkTransform(
  doc: SkeletonDocument,
  bones: Map<string, Bone>,
  errors: FormatError[],
): void {
  for (const [index, tc] of doc.transformConstraints.entries()) {
    for (const [boneIdx, boneName] of tc.bones.entries()) {
      if (!bones.has(boneName)) {
        errors.push(
          formatError(
            'TC_BONE_MISSING',
            jsonPointer(['transformConstraints', index, 'bones', boneIdx]),
            `transform constraint "${tc.name}" references bone "${boneName}", which does not exist`,
            { bone: boneName, constraint: tc.name },
          ),
        );
      }
    }
    if (!bones.has(tc.target)) {
      errors.push(
        formatError(
          'TC_TARGET_MISSING',
          jsonPointer(['transformConstraints', index, 'target']),
          `transform constraint "${tc.name}" targets bone "${tc.target}", which does not exist`,
          { target: tc.target, constraint: tc.name },
        ),
      );
    }
  }
}

// Explicit constraint order (ADR-0009 section 1.3): `order` is a single ordering over the combined
// ikConstraints + transformConstraints set. Omitted everywhere means the default IK-then-transform
// document order (ADR-0003); present anywhere it must be present EVERYWHERE and be a dense, unique
// permutation of [0, N). A partial assignment, a duplicate, a gap, or an out-of-range value is
// CONSTRAINT_ORDER_INVALID: the ordering is not a well-formed total order the runtime can sort by.
function checkConstraintOrder(doc: SkeletonDocument, errors: FormatError[]): void {
  const entries: ReadonlyArray<{
    readonly order: number | undefined;
    readonly nodePath: ReadonlyArray<string | number>;
    readonly orderPath: ReadonlyArray<string | number>;
  }> = [
    ...doc.ikConstraints.map((c, index) => ({
      order: c.order,
      nodePath: ['ikConstraints', index],
      orderPath: ['ikConstraints', index, 'order'],
    })),
    ...doc.transformConstraints.map((c, index) => ({
      order: c.order,
      nodePath: ['transformConstraints', index],
      orderPath: ['transformConstraints', index, 'order'],
    })),
  ];
  const present = entries.filter((entry) => entry.order !== undefined);
  if (present.length === 0) return;

  if (present.length !== entries.length) {
    const missing = entries.find((entry) => entry.order === undefined)!;
    errors.push(
      formatError(
        'CONSTRAINT_ORDER_INVALID',
        jsonPointer(missing.nodePath),
        `constraint order must be set on all constraints or none: ${present.length} of ${entries.length} set`,
        { set: present.length, total: entries.length },
      ),
    );
    return;
  }

  const orders = present.map((entry) => entry.order!).sort((a, b) => a - b);
  const dense = orders.every((value, index) => value === index);
  if (!dense) {
    errors.push(
      formatError(
        'CONSTRAINT_ORDER_INVALID',
        jsonPointer(present[0]!.orderPath),
        `constraint order must be a dense, unique permutation of [0, ${entries.length}); got [${orders.join(', ')}]`,
        { orders: orders.join(','), total: entries.length },
      ),
    );
  }
}

export function checkConstraints(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const bones = boneByName(doc);
  checkConstraintNames(doc, errors);
  checkIk(doc, bones, errors);
  checkTransform(doc, bones, errors);
  checkConstraintOrder(doc, errors);
  return errors;
}
