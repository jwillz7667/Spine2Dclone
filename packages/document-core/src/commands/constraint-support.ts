import { ConstraintError } from '../command/errors';
import type { BoneId, SlotId } from '../model/ids';
import type { DocumentReadModel } from '../model/read-model';

// Shared authoring-time guards for the WP-2.6 (IK) and WP-2.7 (transform) constraint commands. They mirror
// the format validator's referential checks (validate/constraints.ts) at the command boundary so an
// invalid constraint is rejected BEFORE any mutation (no document change, no history entry), and they ADD
// the no-cycle guard the format deliberately does not adjudicate (ADR-0003 section 5: cycles are caught at
// authoring time, the solver's resolveWorld stays a pure ancestor walk). Constraint names are unique across
// BOTH the IK and transform arrays (the format's CONSTRAINT_NAME_DUPLICATE), so the uniqueness check spans
// both.

// True when `ancestorId` is a STRICT ancestor of `descendantId` (walks the descendant's parent chain; a
// bone is not its own ancestor). Pure, bounded by the bone depth.
export function isStrictAncestor(
  model: DocumentReadModel,
  ancestorId: BoneId,
  descendantId: BoneId,
): boolean {
  let current = model.getBone(descendantId)?.parent ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = model.getBone(current)?.parent ?? null;
  }
  return false;
}

// Reject a constraint name already used by ANY existing IK, transform, OR path constraint (excluding the
// constraint being renamed, identified by its current name when given). Constraint names are unique across
// ALL THREE arrays, one namespace (ADR-0011 section 2.3 extends CONSTRAINT_NAME_DUPLICATE to path).
export function assertConstraintNameFree(
  model: DocumentReadModel,
  name: string,
  exceptName?: string,
): void {
  const used =
    model.ikConstraints().some((c) => c.name === name && c.name !== exceptName) ||
    model.transformConstraints().some((c) => c.name === name && c.name !== exceptName) ||
    model.pathConstraints().some((c) => c.name === name && c.name !== exceptName);
  if (used) throw new ConstraintError('duplicateName', name);
}

// Validate a path constraint's target SLOT and bones before authoring (CreatePathConstraint; ADR-0011
// section 2): the target slot exists, its setup attachment is a path where STATICALLY decidable (when the
// slot's setup attachment resolves to a non-path in the default skin, reject; a null or skin-only setup
// attachment is animatable and deferred to the runtime), the bone list is non-empty, and every bone exists.
// A path constraint places NO parent-chain requirement on its bones (each independently samples the arc,
// ADR-0011 section 2.1), so no continuity or cycle check applies. Throws a typed ConstraintError BEFORE any
// mutation.
export function assertValidPathConstraint(
  model: DocumentReadModel,
  target: SlotId,
  bones: readonly BoneId[],
): void {
  const slot = model.getSlot(target);
  if (slot === undefined) throw new ConstraintError('targetMissing', target);
  if (slot.attachment !== null) {
    const attachment = model.getAttachment(target, slot.attachment);
    if (attachment !== undefined && attachment.kind !== 'path') {
      throw new ConstraintError(
        'targetNotPath',
        `slot ${target} setup attachment "${slot.attachment}" is a ${attachment.kind}, not a path`,
      );
    }
  }
  if (bones.length < 1) throw new ConstraintError('chainArity', 'path constraint has no bones');
  for (const boneId of bones) {
    if (model.getBone(boneId) === undefined) throw new ConstraintError('boneMissing', boneId);
  }
}

// Reject a target/chain that would form a cycle: the target must not BE a constrained bone, nor a
// descendant of one (a constrained bone must not be an ancestor of its own target, ADR-0003 section 5).
function assertNoCycle(
  model: DocumentReadModel,
  constrainedBones: readonly BoneId[],
  target: BoneId,
): void {
  for (const boneId of constrainedBones) {
    if (boneId === target || isStrictAncestor(model, boneId, target)) {
      throw new ConstraintError('cycle', `bone ${boneId} is an ancestor of target ${target}`);
    }
  }
}

// Validate an IK constraint's chain and target before authoring (CreateIkConstraint): bones exist, chain
// arity is 1 or 2, a 2-bone chain is parent-then-direct-child, the target exists, and no cycle. Throws a
// typed ConstraintError on the first violation, BEFORE any mutation.
export function assertValidIkChain(
  model: DocumentReadModel,
  bones: readonly BoneId[],
  target: BoneId,
): void {
  if (bones.length < 1 || bones.length > 2) {
    throw new ConstraintError('chainArity', `chain has ${bones.length} bones`);
  }
  for (const boneId of bones) {
    if (model.getBone(boneId) === undefined) throw new ConstraintError('boneMissing', boneId);
  }
  if (model.getBone(target) === undefined) throw new ConstraintError('targetMissing', target);
  if (bones.length === 2) {
    const parentId = bones[0]!;
    const childId = bones[1]!;
    if (model.getBone(childId)?.parent !== parentId) {
      throw new ConstraintError(
        'chainDiscontinuous',
        `${childId} is not a direct child of ${parentId}`,
      );
    }
  }
  assertNoCycle(model, bones, target);
}

// Validate a transform constraint's bones and target before authoring (CreateTransformConstraint): every
// constrained bone exists, the target exists, and no cycle. Transform constraints place no arity or
// continuity requirement on `bones` (each constrained bone is driven independently).
export function assertValidTransformConstraint(
  model: DocumentReadModel,
  bones: readonly BoneId[],
  target: BoneId,
): void {
  if (bones.length < 1)
    throw new ConstraintError('chainArity', 'transform constraint has no bones');
  for (const boneId of bones) {
    if (model.getBone(boneId) === undefined) throw new ConstraintError('boneMissing', boneId);
  }
  if (model.getBone(target) === undefined) throw new ConstraintError('targetMissing', target);
  assertNoCycle(model, bones, target);
}
