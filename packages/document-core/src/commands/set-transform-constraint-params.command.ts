import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { TransformConstraintEntity } from '../model/doc-state';
import type { TransformConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The twelve numeric mix/offset channels a SetTransformConstraintParams edit may touch (everything on the
// entity except its identity fields). A patch is a Partial of these; `before` captures the prior values of
// exactly the patched keys.
type TransformConstraintParamPatch = Partial<
  Omit<TransformConstraintEntity, 'id' | 'name' | 'bones' | 'target'>
>;

// The patchable channel keys as a typed tuple, so before-capture iterates a fixed, statically-typed key set
// (no `any`, no `as`): each key is a numeric field on TransformConstraintEntity.
const PARAM_KEYS = [
  'mixRotate',
  'mixX',
  'mixY',
  'mixScaleX',
  'mixScaleY',
  'mixShearY',
  'offsetRotation',
  'offsetX',
  'offsetY',
  'offsetScaleX',
  'offsetScaleY',
  'offsetShearY',
] as const satisfies readonly (keyof TransformConstraintParamPatch)[];

// A mutable accumulator for before-capture (the public patch type is readonly; this is its writable twin).
type MutableParamPatch = { -readonly [K in keyof TransformConstraintParamPatch]: number };

// Capture, into a fresh patch, the prior values of exactly the keys present in `patch`, reading each numeric
// field off the entity by its known key (so the access is statically typed, never `any`/`as`).
function captureBefore(
  constraint: TransformConstraintEntity,
  patch: TransformConstraintParamPatch,
): TransformConstraintParamPatch {
  const before: MutableParamPatch = {};
  for (const key of PARAM_KEYS) {
    if (patch[key] !== undefined) before[key] = constraint[key];
  }
  return before;
}

// Edit a transform constraint's mix/offset channels (command-history catalog SetTransformConstraintParams,
// `transform.setParams`; WP-2.7). Coalesces a slider drag: `before` captures ONLY the patched keys' prior
// values on first do and `patch` holds the absolute target, so undo is bit-exact and a coalesced drag never
// accumulates drift. A merged command keeps the EARLIEST captured before for prev's keys and this.patch as
// the latest target. (A slider stroke patches the same key(s) each step, so the union of before keys equals
// prev's keys and the merge prefers prev's original values.)
export class SetTransformConstraintParamsCommand implements Command {
  readonly kind = 'transform.setParams';
  readonly label = 'Set Transform Constraint';
  private before: TransformConstraintParamPatch | undefined;

  constructor(
    private readonly id: TransformConstraintId,
    private readonly patch: TransformConstraintParamPatch,
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

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetTransformConstraintParamsCommand && prev.id === this.id) {
      const merged = new SetTransformConstraintParamsCommand(this.id, this.patch);
      // Prefer prev's earlier before values for the union of keys; this.before fills any key prev never
      // touched. For a same-key slider stroke this equals prev.before.
      merged.before = { ...this.before, ...prev.before };
      return merged;
    }
    return null;
  }
}

export const setTransformConstraintParamsSpec: CommandSpec = {
  kind: 'transform.setParams',
  // 'rigged' carries the 'follow' transform constraint (mixRotate 1, everything else 0).
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const c = model.transformConstraints()[0];
    if (!c) return null;
    const patch: TransformConstraintParamPatch = { mixRotate: c.mixRotate === 1 ? 0.5 : 1 };
    return { command: new SetTransformConstraintParamsCommand(c.id, patch) };
  },
  assertApplied: (before, after) => {
    const id = before.transformConstraints[0]?.id;
    if (id === undefined) throw new Error('transform.setParams fixture seed had no constraints');
    const b = before.transformConstraints.find((c) => c.id === id);
    const a = after.transformConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('transform.setParams target missing from snapshot');
    if (a.mixRotate === b.mixRotate) throw new Error('transform.setParams produced no delta');
  },
};
