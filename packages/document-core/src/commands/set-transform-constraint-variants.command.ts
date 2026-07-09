import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { TransformConstraintEntity } from '../model/doc-state';
import type { TransformConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The two Stage F2 transform-constraint variant flags a SetTransformConstraintVariants edit may touch
// (ADR-0009 section 1.2): `local` (local-space read/write instead of the world-space blend) and `relative`
// (offset relative to the bone's current value instead of an absolute blend). A patch is a Partial of these;
// `before` captures the prior values of exactly the patched keys. The numeric mix/offset channels stay on
// SetTransformConstraintParams and the cross-array `order` on ReorderConstraints, so neither is patchable here.
export interface TransformVariantPatch {
  readonly local?: boolean;
  readonly relative?: boolean;
}

type MutableVariantPatch = { local?: boolean; relative?: boolean };

// Capture, into a fresh patch, the prior values of exactly the keys present in `patch`, reading each field off
// the entity by its known key (statically typed, never `any`/`as`).
function captureBefore(
  constraint: TransformConstraintEntity,
  patch: TransformVariantPatch,
): TransformVariantPatch {
  const before: MutableVariantPatch = {};
  if (patch.local !== undefined) before.local = constraint.local;
  if (patch.relative !== undefined) before.relative = constraint.relative;
  return before;
}

// Edit a transform constraint's Stage F2 variant flags (local / relative), `transform.setVariants` (PP-D10).
// Does NOT coalesce: these are discrete boolean toggles, not a continuous scrub (mirroring how the boolean
// SetIkBendPositive is a single discrete edit). before/after are the exact prior values of the patched keys,
// so undo is bit-exact.
export class SetTransformConstraintVariantsCommand implements Command {
  readonly kind = 'transform.setVariants';
  readonly label = 'Set Transform Variants';
  private before: TransformVariantPatch | undefined;

  constructor(
    private readonly id: TransformConstraintId,
    private readonly patch: TransformVariantPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getTransformConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = captureBefore(constraint, this.patch);
    }
    ctx.mutate.patchTransformConstraint(this.id, this.patch);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchTransformConstraint(this.id, this.before);
  }
}

export const setTransformConstraintVariantsSpec: CommandSpec = {
  kind: 'transform.setVariants',
  // 'rigged' carries the 'follow' transform constraint (local false, relative false, the migrated defaults).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.transformConstraints()[0];
    if (!c) return null;
    const patch: TransformVariantPatch = { local: !c.local, relative: !c.relative };
    return { command: new SetTransformConstraintVariantsCommand(c.id, patch) };
  },
  assertApplied: (before, after) => {
    const id = before.transformConstraints[0]?.id;
    if (id === undefined) throw new Error('transform.setVariants fixture seed had no constraints');
    const b = before.transformConstraints.find((c) => c.id === id);
    const a = after.transformConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('transform.setVariants target missing from snapshot');
    if (a.local === b.local && a.relative === b.relative) {
      throw new Error('transform.setVariants produced no delta');
    }
  },
};
