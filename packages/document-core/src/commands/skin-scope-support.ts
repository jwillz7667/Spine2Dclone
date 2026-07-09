import { SkinError } from '../command/errors';
import type { Mutator } from '../model/mutator';

// Shared support for the Stage F2 (ADR-0009 section 5, PP-D10) skin-scoping commands. NOT a *.command.ts
// file, so it exports no CommandSpec (the discovery guard maps one spec per command file).

// The two skin-scoping dimensions: a skin's active-only `bones` and `constraints` name lists. Both are
// single lists of on-disk NAMES (a constraint name resolves across both the IK and transform arrays, which
// share one namespace, ADR-0004).
export type SkinScope = 'bones' | 'constraints';

// A skin's current scoping list for `scope` (or [] when unset).
export function currentSkinScope(
  skin: { readonly bones?: readonly string[]; readonly constraints?: readonly string[] },
  scope: SkinScope,
): readonly string[] {
  return (scope === 'bones' ? skin.bones : skin.constraints) ?? [];
}

// The stored scoping list for `scope` (undefined when the dimension is unset), the exact memento the
// commands capture so undo restores the absent-field state, not an empty array.
export function skinScopeMemento(
  skin: { readonly bones?: readonly string[]; readonly constraints?: readonly string[] },
  scope: SkinScope,
): readonly string[] | undefined {
  return scope === 'bones' ? skin.bones : skin.constraints;
}

// Assert a scoping NAME resolves to a live bone / constraint (mirrors the format's SKIN_BONE_UNKNOWN /
// SKIN_CONSTRAINT_UNKNOWN at the command boundary, so an unresolvable scope never enters the document).
export function assertSkinScopeResolves(mutate: Mutator, scope: SkinScope, name: string): void {
  if (scope === 'bones') {
    if (!mutate.findBoneByName(name)) throw new SkinError('scopeUnknownBone', name);
    return;
  }
  const isConstraint =
    mutate.ikConstraints().some((c) => c.name === name) ||
    mutate.transformConstraints().some((c) => c.name === name);
  if (!isConstraint) throw new SkinError('scopeUnknownConstraint', name);
}
