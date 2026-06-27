// Pure naming and selection logic for the animation manager panel (WP-1.9). The panel
// (animation-panel.tsx) is thin glue over commands plus ephemeral Zustand; every DECISION worth a test
// lives here as a pure function with no React, no document access, and no side effects. This is the house
// convention: the editor vitest environment is `node`, so logic is unit-tested here and the .tsx is
// covered by typecheck and lint. Ids stay generic (TId extends string) so the helpers are branded-id
// agnostic: the panel passes AnimationId values (which are assignable to string), the tests pass plain
// strings.

// A fresh animation defaults to a one-second duration and the base name "animation". Neither is a format
// constant (the validator never reads them); both are editor UX defaults. The panel uniquifies the base
// name against the existing set so a brand-new animation does not export as an immediately-invalid
// duplicate (TASK-1.9.4 keeps names non-unique at author time, this is only a sane default).
export const DEFAULT_ANIMATION_DURATION = 1;
export const DEFAULT_ANIMATION_BASENAME = 'animation';

// Return `base` if it is free, else `base` followed by the smallest numeric suffix (starting at 2) that is
// not taken, for example ("idle copy") yields "idle copy" then "idle copy 2", "idle copy 3". Uniqueness
// here is a convenience for the default name only; the format validator is the real uniqueness authority
// at export.
export function uniqueAnimationName(existingNames: readonly string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

// Reconcile the EPHEMERAL active-animation selection after a delete COMMITS (TASK-1.9.3): this is editor
// state, never part of the delete command (the document/editor wall, LAW 1). If the deleted animation was
// not the active one the selection is untouched; if it was, fall back to the first remaining animation, or
// null when none remain. Generic over the id brand so it is trivially testable with plain strings.
export function chooseActiveAfterDelete<TId extends string>(
  remainingIds: readonly TId[],
  deletedId: TId,
  currentActive: TId | null,
): TId | null {
  if (currentActive !== deletedId) return currentActive;
  return remainingIds[0] ?? null;
}

// The default name for a duplicate of `sourceName`: "<source> copy", uniquified against the existing names
// so duplicating "idle" twice yields "idle copy" then "idle copy 2".
export function duplicateNameFor(sourceName: string, existingNames: readonly string[]): string {
  return uniqueAnimationName(existingNames, `${sourceName} copy`);
}

// The set of names that occur more than once, for a non-blocking duplicate-name warning badge in the
// panel. Author-time names need not be unique (the validator enforces uniqueness at export), so this only
// SURFACES collisions; it never blocks an edit.
export function duplicateNameKeys(animations: readonly { name: string }[]): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const animation of animations) {
    counts.set(animation.name, (counts.get(animation.name) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name);
  }
  return duplicates;
}
