import type { TransformMode } from '@marionette/format/types';
import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import type { BoneEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { CommandSpec } from './spec';

// The setup transform a new bone is created with (everything but its identity and parent).
export interface BoneGeometry {
  readonly name: string;
  readonly length: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
  readonly transformMode: TransformMode;
}

// Create a bone (command-history Section 11, catalog row CreateBone). Structural, never coalesces.
// The BoneId is minted by the caller (the tool or the harness fixture) so redo reuses the same id.
// Inserts immediately after the parent (or at the end for a root), which keeps parents before children
// in boneOrder. selectionHint selects the new bone on execute/redo and clears on undo.
export class CreateBoneCommand implements Command {
  readonly kind = 'bone.create';
  readonly label = 'Create Bone';

  constructor(
    private readonly boneId: BoneId,
    private readonly parent: BoneId | null,
    private readonly geom: BoneGeometry,
  ) {}

  do(ctx: CommandContext): void {
    const entity: BoneEntity = {
      id: this.boneId,
      name: this.geom.name,
      parent: this.parent,
      length: this.geom.length,
      x: this.geom.x,
      y: this.geom.y,
      rotation: this.geom.rotation,
      scaleX: this.geom.scaleX,
      scaleY: this.geom.scaleY,
      shearX: this.geom.shearX,
      shearY: this.geom.shearY,
      transformMode: this.geom.transformMode,
    };
    const ordered = ctx.mutate.bones();
    let index = ordered.length;
    if (this.parent !== null) {
      const parentIndex = ordered.findIndex((bone) => bone.id === this.parent);
      index = parentIndex >= 0 ? parentIndex + 1 : ordered.length;
    }
    ctx.mutate.insertBone(entity, index);
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeBone(this.boneId);
  }

  selectionHint(phase: HistoryPhase): SelectionHint {
    if (phase === 'undo') return { kind: 'clear' };
    return { kind: 'select', entities: [{ type: 'bone', id: this.boneId }] };
  }
}

export const createBoneSpec: CommandSpec = {
  kind: 'bone.create',
  representativeSeedId: 'minimal',
  fixture: (model, ids) => {
    const parentBone = model.bones()[0];
    const parent = parentBone ? parentBone.id : null;
    const id = ids.mint('bone');
    return {
      command: new CreateBoneCommand(id, parent, {
        name: `created_${id}`,
        length: 50,
        x: 10,
        y: 20,
        rotation: 15,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      }),
    };
  },
  assertApplied: (before, after) => {
    if (after.bones.length !== before.bones.length + 1) {
      throw new Error(
        `bone.create expected one more bone (before ${before.bones.length}, after ${after.bones.length})`,
      );
    }
    if (after.boneOrder.length !== before.boneOrder.length + 1) {
      throw new Error('bone.create expected boneOrder to grow by one');
    }
    const beforeIds = new Set(before.bones.map((bone) => bone.id));
    const created = after.bones.find((bone) => !beforeIds.has(bone.id));
    if (!created) throw new Error('bone.create did not add a new bone');
    // The created bone must carry the fixture geometry exactly (catches a bug that inserts a bone with
    // wrong or default field values, which a count-only check would miss).
    if (
      created.length !== 50 ||
      created.x !== 10 ||
      created.y !== 20 ||
      created.rotation !== 15 ||
      created.scaleX !== 1 ||
      created.scaleY !== 1 ||
      created.shearX !== 0 ||
      created.shearY !== 0 ||
      created.transformMode !== 'normal' ||
      !created.name.startsWith('created_')
    ) {
      throw new Error('bone.create did not apply the fixture geometry to the new bone');
    }
  },
};
