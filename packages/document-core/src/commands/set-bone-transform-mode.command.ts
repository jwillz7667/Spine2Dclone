import type { TransformMode } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Set a bone's transformMode (command-history catalog SetBoneTransformMode, bone.transformMode). A
// single-field enum change with a value memento; it is its own undo step (never coalesces, since it is
// a discrete enum pick, not a drag).
export class SetBoneTransformModeCommand implements Command {
  readonly kind = 'bone.transformMode';
  readonly label = 'Set Transform Mode';
  private before: TransformMode | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly after: TransformMode,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const bone = ctx.mutate.getBone(this.target);
      if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
      this.before = bone.transformMode;
    }
    ctx.mutate.patchBone(this.target, { transformMode: this.after });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { transformMode: this.before });
  }
}

export const setBoneTransformModeSpec: CommandSpec = {
  kind: 'bone.transformMode',
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    // Pick any mode other than the current one so the fixture yields a real delta.
    const next: TransformMode = target.transformMode === 'normal' ? 'onlyTranslation' : 'normal';
    return { command: new SetBoneTransformModeCommand(target.id, next) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.transformMode fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.transformMode target missing from snapshot');
    if (a.transformMode === b.transformMode) {
      throw new Error('bone.transformMode produced no delta');
    }
    if (a.rotation !== b.rotation || a.x !== b.x || a.scaleX !== b.scaleX) {
      throw new Error('bone.transformMode changed a field outside its channel');
    }
  },
};
