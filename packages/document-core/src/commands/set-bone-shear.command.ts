import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Set a bone's local shear in degrees (command-history catalog SetBoneShear). One channel (shearX,
// shearY); coalesces same-target shears within a gizmo/field session. Memento-based, absolute
// before/after, mirroring ScaleBone and RotateBone. It never coalesces with a MoveBone/RotateBone/
// ScaleBone because coalesceWith checks the concrete class (cross-channel guard).
export class SetBoneShearCommand implements Command {
  readonly kind = 'bone.shear';
  readonly label = 'Shear Bone';
  private before: { readonly shearX: number; readonly shearY: number } | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: { readonly shearX: number; readonly shearY: number },
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = { shearX: bone.shearX, shearY: bone.shearY };
    }
    ctx.mutate.patchBone(this.target, { shearX: this.after.shearX, shearY: this.after.shearY });
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { shearX: this.before.shearX, shearY: this.before.shearY });
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetBoneShearCommand && prev.target === this.target) {
      const merged = new SetBoneShearCommand(this.target, this.after);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

export const setBoneShearSpec: CommandSpec = {
  kind: 'bone.shear',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    return {
      command: new SetBoneShearCommand(target.id, {
        shearX: target.shearX + 12,
        shearY: target.shearY - 7,
      }),
    };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.shear fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.shear target missing from snapshot');
    if (a.shearX === b.shearX && a.shearY === b.shearY) {
      throw new Error('bone.shear produced no shear delta');
    }
    if (a.x !== b.x || a.rotation !== b.rotation || a.scaleX !== b.scaleX) {
      throw new Error('bone.shear changed a field outside its channel');
    }
  },
};
