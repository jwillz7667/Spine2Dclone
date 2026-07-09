import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { IkConstraintEntity } from '../model/doc-state';
import type { IkConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The four Stage F2 IK depth fields a SetIkDepthParams edit may touch (ADR-0009 section 1.1): the non-negative
// `softness` distance and the `stretch` / `compress` / `uniform` booleans. `bend` stays on SetIkBendPositive
// (the boolean seam is kept, ADR-0009 section 1.4 decision) and `order` on ReorderConstraints, so neither is
// patchable here. A patch is a Partial of these; `before` captures the prior values of exactly the patched keys.
export interface IkDepthPatch {
  readonly softness?: number;
  readonly stretch?: boolean;
  readonly compress?: boolean;
  readonly uniform?: boolean;
}

// A mutable accumulator for before-capture (the public patch type is readonly; this is its writable twin).
type MutableDepthPatch = {
  softness?: number;
  stretch?: boolean;
  compress?: boolean;
  uniform?: boolean;
};

// Capture, into a fresh patch, the prior values of exactly the keys present in `patch`, reading each field off
// the entity by its known key (so the access is statically typed, never `any`/`as`).
function captureBefore(constraint: IkConstraintEntity, patch: IkDepthPatch): IkDepthPatch {
  const before: MutableDepthPatch = {};
  if (patch.softness !== undefined) before.softness = constraint.softness;
  if (patch.stretch !== undefined) before.stretch = constraint.stretch;
  if (patch.compress !== undefined) before.compress = constraint.compress;
  if (patch.uniform !== undefined) before.uniform = constraint.uniform;
  return before;
}

// Edit an IK constraint's Stage F2 depth fields (softness / stretch / compress / uniform), `ik.setDepth`
// (PP-D10). Coalesces a slider drag on `softness` (and folds a burst of toggle flips in one gesture): `before`
// captures ONLY the patched keys' prior values on first do and `patch` holds the absolute target, so undo is
// bit-exact and a coalesced drag never accumulates drift, mirroring SetTransformConstraintParams. A merged
// command keeps the EARLIEST captured before for prev's keys and this.patch as the latest target.
export class SetIkDepthParamsCommand implements Command {
  readonly kind = 'ik.setDepth';
  readonly label = 'Set IK Depth';
  private before: IkDepthPatch | undefined;

  constructor(
    private readonly id: IkConstraintId,
    private readonly patch: IkDepthPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getIkConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = captureBefore(constraint, this.patch);
    }
    ctx.mutate.patchIkConstraint(this.id, this.patch);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchIkConstraint(this.id, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetIkDepthParamsCommand && prev.id === this.id) {
      const merged = new SetIkDepthParamsCommand(this.id, this.patch);
      // Prefer prev's earlier before values for the union of keys; this.before fills any key prev never
      // touched. For a same-key slider stroke this equals prev.before.
      merged.before = { ...this.before, ...prev.before };
      return merged;
    }
    return null;
  }
}

export const setIkDepthParamsSpec: CommandSpec = {
  kind: 'ik.setDepth',
  // 'rigged' carries the 'limb-ik' constraint (softness 0, the three booleans false, the migrated defaults).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.ikConstraints()[0];
    if (!c) return null;
    const patch: IkDepthPatch = { softness: c.softness === 5 ? 10 : 5, stretch: !c.stretch };
    return { command: new SetIkDepthParamsCommand(c.id, patch) };
  },
  assertApplied: (before, after) => {
    const id = before.ikConstraints[0]?.id;
    if (id === undefined) throw new Error('ik.setDepth fixture seed had no IK constraints');
    const b = before.ikConstraints.find((c) => c.id === id);
    const a = after.ikConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('ik.setDepth target missing from snapshot');
    if (a.softness === b.softness && a.stretch === b.stretch) {
      throw new Error('ik.setDepth produced no delta');
    }
  },
};
