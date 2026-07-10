import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { PathConstraintEntity } from '../model/doc-state';
import type { PathConstraintId } from '../model/ids';
import type { CommandSpec } from './spec';

// The path-constraint parameters a SetPathConstraintParams edit may touch: the three modes and the six
// scalars (everything but identity, target, bones, and the optional solve order). A patch is a Partial of
// these.
export type PathConstraintParamPatch = Partial<
  Omit<PathConstraintEntity, 'id' | 'name' | 'target' | 'bones' | 'order'>
>;

// The full set of patchable fields captured as the before memento. Modes and scalars have distinct value
// types, so (unlike the all-numeric transform params) the whole set is snapshotted at gesture start; undo
// restores every field to its pre-edit value, keeping a coalesced slider drag bit-exact with no per-key
// type gymnastics.
type PathConstraintParamSnapshot = Required<PathConstraintParamPatch>;

function snapshotParams(c: PathConstraintEntity): PathConstraintParamSnapshot {
  return {
    positionMode: c.positionMode,
    spacingMode: c.spacingMode,
    rotateMode: c.rotateMode,
    position: c.position,
    spacing: c.spacing,
    offsetRotation: c.offsetRotation,
    mixRotate: c.mixRotate,
    mixX: c.mixX,
    mixY: c.mixY,
  };
}

// Edit a path constraint's mode/scalar parameters (command-history catalog SetPathConstraintParams,
// `path.setParams`; PP-D11). Coalesces a slider drag: `before` captures the FULL parameter snapshot at
// gesture start and `patch` holds the absolute target, so undo is bit-exact and a coalesced drag never
// accumulates drift. A merged command keeps prev's earlier snapshot and this.patch as the latest target.
export class SetPathConstraintParamsCommand implements Command {
  readonly kind = 'path.setParams';
  readonly label = 'Set Path Constraint';
  private before: PathConstraintParamSnapshot | undefined;

  constructor(
    private readonly id: PathConstraintId,
    private readonly patch: PathConstraintParamPatch,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const constraint = ctx.mutate.getPathConstraint(this.id);
      if (!constraint) throw new CommandTargetMissingError(this.kind, this.id);
      this.before = snapshotParams(constraint);
    }
    ctx.mutate.patchPathConstraint(this.id, this.patch);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchPathConstraint(this.id, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetPathConstraintParamsCommand && prev.id === this.id) {
      const merged = new SetPathConstraintParamsCommand(this.id, this.patch);
      // Keep prev's earlier full snapshot so one undo of the coalesced drag returns to the gesture start.
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setPathConstraintParamsSpec: CommandSpec = {
  kind: 'path.setParams',
  // 'pathed' carries the 'rail-follow' path constraint (mixRotate 1, position 0).
  representativeSeedId: 'pathed',
  fixture: (model) => {
    const c = model.pathConstraints()[0];
    if (!c) return null;
    const patch: PathConstraintParamPatch = { position: c.position === 0.5 ? 0.25 : 0.5 };
    return { command: new SetPathConstraintParamsCommand(c.id, patch) };
  },
  assertApplied: (before, after) => {
    const id = before.pathConstraints[0]?.id;
    if (id === undefined) throw new Error('path.setParams fixture seed had no path constraints');
    const b = before.pathConstraints.find((c) => c.id === id);
    const a = after.pathConstraints.find((c) => c.id === id);
    if (!b || !a) throw new Error('path.setParams target missing from snapshot');
    if (a.position === b.position) throw new Error('path.setParams produced no delta');
  },
};
