import type { Command, CommandContext } from '../command/command';
import { SkinError } from '../command/errors';
import type { SkinId } from '../model/ids';
import type { CommandSpec } from './spec';

// Create a NAMED (non-default) skin (command-history catalog CreateSkin, `skin.create`; WP-2.8). The
// 'default' skin is implicit and reserved, so a 'default' name is rejected (defaultProtected); a name that
// collides with an existing named skin is rejected too (duplicateName). Both checks run BEFORE any
// mutation, so an invalid create leaves no document change and no history entry. The SkinId is minted by
// the caller so redo reuses the same id. The new skin appends to the end of skinOrder with an empty
// attachment map. The undo memento is simply the id (removeSkin reverses the insert). NOT coalescing.
export class CreateSkinCommand implements Command {
  readonly kind = 'skin.create';
  readonly label = 'Create Skin';

  constructor(
    private readonly id: SkinId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.name === 'default') throw new SkinError('defaultProtected');
    if (ctx.mutate.skins().some((s) => s.name === this.name)) {
      throw new SkinError('duplicateName', this.name);
    }
    ctx.mutate.insertSkin(
      { id: this.id, name: this.name, attachments: new Map() },
      ctx.mutate.skins().length,
    );
  }

  undo(ctx: CommandContext): void {
    ctx.mutate.removeSkin(this.id);
  }
}

export const createSkinSpec: CommandSpec = {
  kind: 'skin.create',
  // 'minimal' carries no named skins, so creating one is a clean append with a real delta.
  representativeSeedId: 'minimal',
  fixture: (model, ids) => {
    if (model.skins().some((s) => s.name === 'skin_new')) return null;
    return { command: new CreateSkinCommand(ids.mint('skin'), 'skin_new') };
  },
  assertApplied: (before, after) => {
    if (after.skins.length !== before.skins.length + 1) {
      throw new Error('skin.create did not add exactly one named skin');
    }
  },
};
