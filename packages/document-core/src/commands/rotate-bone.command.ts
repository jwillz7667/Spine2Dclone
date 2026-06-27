import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Rotate a bone's local rotation in degrees (command-history catalog, distinct single-channel primitive
// from MoveBone). Memento-based; coalesces same-target rotates within one gizmo session. It never
// coalesces with a MoveBone because coalesceWith checks the concrete class (cross-channel guard).
export class RotateBoneCommand implements Command {
  readonly kind = 'bone.rotate';
  readonly label = 'Rotate Bone';
  private before: number | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = bone.rotation;
    }
    ctx.mutate.patchBone(this.target, { rotation: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { rotation: this.before });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof RotateBoneCommand && prev.target === this.target) {
      const merged = new RotateBoneCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const rotateBoneSpec: CommandSpec = {
  kind: 'bone.rotate',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return { command: new RotateBoneCommand(target.id, target.rotation + 42) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.rotate fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.rotate target missing from snapshot');
    if (a.rotation === b.rotation) throw new Error('bone.rotate produced no rotation delta');
    if (a.x !== b.x || a.y !== b.y)
      throw new Error('bone.rotate changed a field outside its channel');
  },
};
