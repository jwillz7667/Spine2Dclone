// Pure ordered-set operations for bone multi-selection (PP-D1). The selection store delegates to these so
// the click / shift-click / marquee semantics are unit-tested without Zustand. The selection is an
// ORDERED set: no duplicates, and index 0 is the PRIMARY (the gizmo pivot; rotate/scale act about it).
// Generic over the id brand so the helpers take BoneId in the store and plain strings in tests.

// Add id if absent (appended, keeping the earlier primary), else remove it. When the removed id was the
// primary, the next remaining id becomes the primary (the array keeps its order).
export function toggle<T extends string>(current: readonly T[], id: T): readonly T[] {
  return current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
}

// Resolve a click: a plain click selects exactly the clicked id (it becomes the primary); an additive
// (shift/cmd) click toggles it in the ordered set. A plain click on the already-sole selection returns
// the same reference so the store skips a needless update (and thus a re-render).
export function applyClick<T extends string>(
  current: readonly T[],
  id: T,
  additive: boolean,
): readonly T[] {
  if (additive) return toggle(current, id);
  if (current.length === 1 && current[0] === id) return current;
  return [id];
}

// Resolve a marquee release: a plain marquee replaces the selection with the hit ids (deduped, order
// preserved); an additive marquee unions the hits onto the current selection, keeping the current primary
// first. An empty non-additive marquee clears; an empty additive marquee leaves the selection unchanged.
export function applyMarquee<T extends string>(
  current: readonly T[],
  hits: readonly T[],
  additive: boolean,
): readonly T[] {
  const deduped = dedupe(hits);
  if (!additive) return deduped;
  const have = new Set(current);
  return [...current, ...deduped.filter((id) => !have.has(id))];
}

function dedupe<T extends string>(ids: readonly T[]): readonly T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
