import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SkinError } from '../command/errors';
import type { SkinId } from '../model/ids';
import type { CommandSpec } from './spec';
import {
  assertSkinScopeResolves,
  currentSkinScope,
  skinScopeMemento,
  type SkinScope,
} from './skin-scope-support';

// Add a NAME to a named skin's Stage F2 (ADR-0009 section 5, PP-D10) scoping list (command-history catalog
// AddSkinScope, `skin.scope.add`). The skin must exist (notFound), the name must resolve to a live bone /
// constraint (scopeUnknownBone / scopeUnknownConstraint), and it must not already be scoped (scopeDuplicate).
// All checks run BEFORE any mutation, so an invalid add leaves no document change and no history entry.
// Memento-based (the whole prior list, so undo restores the exact prior scoping, including the unscoped
// absent-field state). NOT coalescing (a discrete author action).
export class AddSkinScopeCommand implements Command {
  readonly kind = 'skin.scope.add';
  readonly label = 'Add Skin Scope';
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
    assertSkinScopeResolves(ctx.mutate, this.scope, this.name);
    const list = currentSkinScope(skin, this.scope);
    if (list.includes(this.name)) throw new SkinError('scopeDuplicate', this.name);
    this.before = skinScopeMemento(skin, this.scope);
    this.captured = true;
    ctx.mutate.setSkinScope(this.skinId, this.scope, [...list, this.name]);
  }

  undo(ctx: CommandContext): void {
    if (!this.captured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setSkinScope(this.skinId, this.scope, this.before);
  }
}

export const addSkinScopeSpec: CommandSpec = {
  kind: 'skin.scope.add',
  // 'rigged' carries the named 'variant' skin plus bones to scope to.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const skin = model.skins()[0];
    const bone = model.bones().find((b) => !(skin?.bones ?? []).includes(b.name));
    if (!skin || !bone) return null;
    return { command: new AddSkinScopeCommand(skin.id, 'bones', bone.name) };
  },
  assertApplied: (before, after) => {
    const id = before.skins[0]?.id;
    if (id === undefined) throw new Error('skin.scope.add fixture seed had no named skins');
    const b = before.skins.find((s) => s.id === id);
    const a = after.skins.find((s) => s.id === id);
    if (!b || !a) throw new Error('skin.scope.add target missing from snapshot');
    if ((a.bones ?? []).length === (b.bones ?? []).length) {
      throw new Error('skin.scope.add produced no scoping delta');
    }
  },
};
