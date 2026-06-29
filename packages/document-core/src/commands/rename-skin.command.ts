import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { SkinId } from '../model/ids';
import type { CommandSpec } from './spec';

// Rename a NAMED skin (command-history catalog RenameSkin, `skin.rename`; WP-2.8). The 'default' name is
// reserved (defaultProtected), the target must exist (notFound), and the new name must not collide with a
// DIFFERENT named skin (duplicateName); a no-op rename to the skin's own name is allowed. All checks run
// BEFORE any mutation, so an invalid rename leaves no document change and no history entry. A single-field
// change with zero cascade because identity is the SkinId, not the name. Memento-based. NOT coalescing.
export class RenameSkinCommand implements Command {
  readonly kind = 'skin.rename';
  readonly label = 'Rename Skin';
  private before: string | undefined;

  constructor(
    private readonly id: SkinId,
    private readonly newName: string,
  ) {}

  do(ctx: CommandContext): void {
    if (this.newName === 'default') throw new SkinError('defaultProtected');
    const skin = ctx.mutate.getSkin(this.id);
    if (!skin) throw new SkinError('notFound', this.id);
    if (ctx.mutate.skins().some((s) => s.name === this.newName && s.id !== this.id)) {
      throw new SkinError('duplicateName', this.newName);
    }
    this.before = skin.name;
    ctx.mutate.patchSkin(this.id, { name: this.newName });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.patchSkin(this.id, { name: this.before });
  }
}

export const renameSkinSpec: CommandSpec = {
  kind: 'skin.rename',
  // 'rigged' carries the named 'variant' skin, so a rename produces a real name delta.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins()[0];
    if (!skin) return null;
    return { command: new RenameSkinCommand(skin.id, `${skin.name}_renamed`) };
  },
  assertApplied: (before, after) => {
    const id = before.skins[0]?.id;
    if (id === undefined) throw new Error('skin.rename fixture seed had no named skins');
    const b = before.skins.find((s) => s.id === id);
    const a = after.skins.find((s) => s.id === id);
    if (!b || !a) throw new Error('skin.rename target missing from snapshot');
    if (a.name === b.name) throw new Error('skin.rename produced no name delta');
  },
};
