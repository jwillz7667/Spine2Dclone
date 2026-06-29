import type { Command, CommandContext } from '../command/command';
import type { AnimationEntity } from '../model/doc-state';
import { emptyAnimationConstraintTimelines } from '../model/doc-state';
import type { AnimationId } from '../model/ids';
import { findAnimationSnapshot, type CommandSpec } from './spec';

// Create a new, empty animation (command-history catalog CreateAnimation, `anim.create`). Structural,
// never coalesces. The AnimationId is minted by the caller so redo reuses the same id. The animation
// starts with the given duration and empty bone/slot timeline maps; on export it projects to exactly
// `{ duration, bones: {}, slots: {} }`, which the format validator accepts (no empty ik/transform/
// deform/drawOrder/events collections exist in the implemented format).
export class CreateAnimationCommand implements Command {
  readonly kind = 'anim.create';
  readonly label = 'Create Animation';

  constructor(
    private readonly animId: AnimationId,
    private readonly name: string,
    private readonly duration: number,
  ) {}

  do(ctx: CommandContext): void {
    const entity: AnimationEntity = {
      id: this.animId,
      name: this.name,
      duration: this.duration,
      bones: new Map(),
      slots: new Map(),
      ...emptyAnimationConstraintTimelines(),
    };
    ctx.mutate.insertAnimation(entity);
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeAnimation(this.animId);
  }
}

export const createAnimationSpec: CommandSpec = {
  kind: 'anim.create',
  // Applicable on any seed: creating an animation needs no existing entity.
  representativeSeedId: 'minimal',
  fixture: (_model, ids) => {
    const id = ids.mint('animation');
    return { command: new CreateAnimationCommand(id, `anim_${id}`, 1) };
  },
  assertApplied: (before, after) => {
    if (after.animations.length !== before.animations.length + 1) {
      throw new Error('anim.create expected one more animation');
    }
    const beforeIds = new Set(before.animations.map((animation) => animation.id));
    const created = after.animations.find((animation) => !beforeIds.has(animation.id));
    if (!created) throw new Error('anim.create did not add a new animation');
    if (findAnimationSnapshot(after, created.id) === undefined) {
      throw new Error('anim.create animation missing from snapshot');
    }
    if (created.bones.length !== 0 || created.slots.length !== 0) {
      throw new Error('anim.create did not create an empty animation');
    }
  },
};
