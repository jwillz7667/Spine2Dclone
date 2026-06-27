import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { BoneId } from '../model/ids';
import { findBoneSnapshot, type CommandSpec } from './spec';

// Wrap degrees into [-180, 180). Pure: no I/O, no clock.
export function wrapDegrees(deg: number): number {
  const m = (((deg + 180) % 360) + 360) % 360;
  return m - 180;
}

// The Phase-0 computed-result REFERENCE command (command-history Section 4.3). Its `after` is computed
// ONCE from current state on first do and then REPLAYED verbatim on redo (never recomputed), so redo
// after an intervening edit still writes the originally-computed value. Bone-only (LAW 5: Phase 0 has
// no mesh, so the heavyweight computed-result commands cannot be the reference). Never coalesces.
export class NormalizeBoneRotationCommand implements Command {
  readonly kind = 'bone.rotation.normalize';
  readonly label = 'Normalize Bone Rotation';
  private before: number | undefined;
  private after: number | undefined;

  constructor(private readonly target: BoneId) {}

  do(ctx: CommandContext): void {
    const bone = ctx.mutate.getBone(this.target);
    if (!bone) throw new CommandTargetMissingError(this.kind, this.target);
    if (this.after === undefined) {
      this.before = bone.rotation; // value copy
      this.after = wrapDegrees(bone.rotation); // compute ONCE from current state
    }
    ctx.mutate.patchBone(this.target, { rotation: this.after }); // do AND redo write the stored result
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchBone(this.target, { rotation: this.before });
  }
}

export const normalizeBoneRotationSpec: CommandSpec = {
  kind: 'bone.rotation.normalize',
  // 'rotated' seeds a bone whose rotation is out of range, so normalization produces a real delta.
  representativeSeedId: 'rotated',
  fixture: (model) => {
    const target = model.bones()[0];
    if (!target) return null;
    // Already-normalized rotations are idempotent here, so there would be no delta to assert: skip.
    if (wrapDegrees(target.rotation) === target.rotation) return null;
    return { command: new NormalizeBoneRotationCommand(target.id) };
  },
  assertApplied: (before, after) => {
    const id = before.boneOrder[0];
    if (id === undefined) throw new Error('bone.rotation.normalize fixture seed had no bones');
    const b = findBoneSnapshot(before, id);
    const a = findBoneSnapshot(after, id);
    if (!b || !a) throw new Error('bone.rotation.normalize target missing from snapshot');
    if (a.rotation === b.rotation) throw new Error('bone.rotation.normalize produced no delta');
    if (a.rotation !== wrapDegrees(b.rotation)) {
      throw new Error('bone.rotation.normalize did not write the wrapped rotation');
    }
  },
};
