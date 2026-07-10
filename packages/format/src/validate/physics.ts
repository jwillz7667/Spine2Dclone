import type { SkeletonDocument } from '../schema/document';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { jsonPointer } from './structural';

// CONSTRAINT family (ADR-0014 section 1): physics-constraint referential checks. A physics constraint binds
// to ONE bone (both the driven bone and its own setpoint reference), so the only reference to resolve is
// that bone (PHYSICS_BONE_MISSING). The channel-set arity (non-empty, unique) is structural
// (schema/constraint.ts: PHYSICS_CHANNELS_EMPTY / PHYSICS_CHANNEL_DUPLICATE) and the model parameter ranges
// are structural refinements too, so by the time this semantic pass runs each physics constraint is already
// known to be well-shaped. Name uniqueness and the dense-order permutation span all FOUR constraint arrays
// and live in validate/constraints.ts.
export function checkPhysicsConstraints(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneNames = new Set(doc.bones.map((bone) => bone.name));

  for (const [index, pc] of doc.physicsConstraints.entries()) {
    if (!boneNames.has(pc.bone)) {
      errors.push(
        formatError(
          'PHYSICS_BONE_MISSING',
          jsonPointer(['physicsConstraints', index, 'bone']),
          `physics constraint "${pc.name}" simulates bone "${pc.bone}", which does not exist`,
          { bone: pc.bone, constraint: pc.name },
        ),
      );
    }
  }
  return errors;
}
