import type { PathPositionMode, PathRotateMode, PathSpacingMode } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import type { PathConstraintEntity } from '../model/doc-state';
import type { BoneId, PathConstraintId, SlotId } from '../model/ids';
import { assertConstraintNameFree, assertValidPathConstraint } from './constraint-support';
import type { CommandSpec } from './spec';

// The path-constraint parameters a caller supplies (everything but identity and the optional solve order).
export interface PathConstraintParams {
  readonly positionMode: PathPositionMode;
  readonly spacingMode: PathSpacingMode;
  readonly rotateMode: PathRotateMode;
  readonly position: number;
  readonly spacing: number;
  readonly offsetRotation: number;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
}

// Create a path constraint (command-history catalog CreatePathConstraint, `path.createConstraint`; PP-D11).
// The target SLOT and bones are validated BEFORE any mutation (assertValidPathConstraint: the target slot
// exists and carries a path where statically decidable, bones non-empty and resolvable) and the name is
// checked unique across ALL THREE constraint arrays (assertConstraintNameFree), so an invalid constraint
// leaves no document change and no history entry. The new constraint appends to the end of the path solve
// order (after IK and transform in the default order, ADR-0011 section 2.3). NOT coalescing.
export class CreatePathConstraintCommand implements Command {
  readonly kind = 'path.createConstraint';
  readonly label = 'Create Path Constraint';

  constructor(
    private readonly id: PathConstraintId,
    private readonly name: string,
    private readonly target: SlotId,
    private readonly bones: readonly BoneId[],
    private readonly params: PathConstraintParams,
  ) {}

  do(ctx: CommandContext): void {
    assertValidPathConstraint(ctx.mutate, this.target, this.bones);
    assertConstraintNameFree(ctx.mutate, this.name);
    const entity: PathConstraintEntity = {
      id: this.id,
      name: this.name,
      target: this.target,
      bones: this.bones,
      positionMode: this.params.positionMode,
      spacingMode: this.params.spacingMode,
      rotateMode: this.params.rotateMode,
      position: this.params.position,
      spacing: this.params.spacing,
      offsetRotation: this.params.offsetRotation,
      mixRotate: this.params.mixRotate,
      mixX: this.params.mixX,
      mixY: this.params.mixY,
    };
    ctx.mutate.insertPathConstraint(entity, ctx.mutate.pathConstraints().length);
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removePathConstraint(this.id);
  }
}

export const createPathConstraintSpec: CommandSpec = {
  kind: 'path.createConstraint',
  // 'pathed' carries a slot ('path_slot') whose setup attachment is a path ('rail') and bones to constrain.
  representativeSeedId: 'pathed',
  fixture: (model, ids) => {
    const bone = model.bones()[0];
    if (!bone) return null;
    // Only applicable where a slot's setup attachment is actually a path (otherwise assertValidPathConstraint
    // rejects with targetNotPath); this keeps the fixture null on non-path seeds.
    const target = model.slots().find((s) => {
      if (s.attachment === null) return false;
      const att = model.getAttachment(s.id, s.attachment);
      return att?.kind === 'path';
    });
    if (!target) return null;
    if (model.pathConstraints().some((c) => c.name === 'pc_new')) return null;
    return {
      command: new CreatePathConstraintCommand(
        ids.mint('pathConstraint'),
        'pc_new',
        target.id,
        [bone.id],
        {
          positionMode: 'percent',
          spacingMode: 'length',
          rotateMode: 'tangent',
          position: 0,
          spacing: 0,
          offsetRotation: 0,
          mixRotate: 1,
          mixX: 1,
          mixY: 1,
        },
      ),
    };
  },
  assertApplied: (before, after) => {
    if (after.pathConstraints.length !== before.pathConstraints.length + 1) {
      throw new Error('path.createConstraint did not add exactly one path constraint');
    }
  },
};
