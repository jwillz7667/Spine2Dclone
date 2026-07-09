import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { SkinId } from '../model/ids';
import type { CommandSpec } from './spec';
import { currentSkinScope, skinScopeMemento, type SkinScope } from './skin-scope-support';

// Remove a NAME from a named skin's Stage F2 (ADR-0009 section 5, PP-D10) scoping list (command-history
// catalog RemoveSkinScope, `skin.scope.remove`). The skin must exist (notFound) and the name must currently
// be scoped (scopeMissing); removing the last entry clears the scoping dimension (the setSkinScope
// canonicalization drops the empty field). All checks run BEFORE any mutation. Memento-based, NOT coalescing.
export class RemoveSkinScopeCommand implements Command {
  readonly kind = 'skin.scope.remove';
  readonly label = 'Remove Skin Scope';
  private before: readonly string[] | undefined;
  private captured = false;

  constructor(
    private readonly skinId: SkinId,
    private readonly scope: SkinScope,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const skin = ctx.mutate.getSkin(this.skinId);
    if (!skin) throw new SkinError('notFound', this.skinId);
    const list = currentSkinScope(skin, this.scope);
    if (!list.includes(this.name)) throw new SkinError('scopeMissing', this.name);
    this.before = skinScopeMemento(skin, this.scope);
    this.captured = true;
    ctx.mutate.setSkinScope(
      this.skinId,
      this.scope,
      list.filter((entry) => entry !== this.name),
    );
  }

  undo(ctx: CommandContext): void {
    if (!this.captured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSkinScope(this.skinId, this.scope, this.before);
  }
}

export const removeSkinScopeSpec: CommandSpec = {
  kind: 'skin.scope.remove',
  // 'rigged' carries the named 'variant' skin pre-scoped to the 'follower' bone.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins().find((s) => (s.bones ?? []).length > 0);
    if (!skin) return null;
    const name = skin.bones?.[0];
    if (name === undefined) return null;
    return { command: new RemoveSkinScopeCommand(skin.id, 'bones', name) };
  },
  assertApplied: (before, after) => {
    const target = before.skins.find((s) => (s.bones ?? []).length > 0);
    if (target === undefined) throw new Error('skin.scope.remove fixture seed had no scoped skin');
    const a = after.skins.find((s) => s.id === target.id);
    if (!a) throw new Error('skin.scope.remove target missing from snapshot');
    if ((a.bones ?? []).length === (target.bones ?? []).length) {
      throw new Error('skin.scope.remove produced no scoping delta');
    }
  },
};
