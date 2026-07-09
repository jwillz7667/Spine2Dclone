// Pure draw-order offset math for the draw-order authoring surface (Stage F1, PP-D9). The section
// (draw-order-section.tsx) reorders slots at the playhead and commits a SetDrawOrderKeyCommand whose
// offsets these functions compute; every DECISION worth a test lives here as a pure function with no React,
// no document access, and no side effects (the house convention). Ids stay generic (TId extends string) so
// the helpers are branded-id agnostic: the section passes SlotId values, the tests pass plain strings.

// One computed per-slot offset entry (structurally the DrawOrderOffsetEntity the command consumes).
export interface DrawOrderOffset<TId extends string> {
  readonly slot: TId;
  readonly offset: number;
}

// Compute the MINIMAL consistent offset list that reorders `setupOrder` into `desiredOrder`. Each slot's
// offset is its signed index delta (position in desiredOrder minus position in setupOrder); a slot that did
// not move (offset 0) is omitted, so an identity reorder yields an empty list (the format's "empty offsets
// means setup order"). `desiredOrder` MUST be a permutation of `setupOrder`; then every derived target index
// (setupIndex + offset) equals the slot's desiredOrder position, so the targets are distinct and in range
// and SetDrawOrderKeyCommand's consistency check accepts the result. The offsets appear in setupOrder order
// for a stable, deterministic list.
export function computeDrawOrderOffsets<TId extends string>(
  setupOrder: readonly TId[],
  desiredOrder: readonly TId[],
): DrawOrderOffset<TId>[] {
  const desiredIndex = new Map<TId, number>();
  desiredOrder.forEach((id, index) => desiredIndex.set(id, index));

  const offsets: DrawOrderOffset<TId>[] = [];
  setupOrder.forEach((id, setupIdx) => {
    const target = desiredIndex.get(id);
    if (target === undefined) return; // not a permutation member; skip defensively
    const offset = target - setupIdx;
    if (offset !== 0) offsets.push({ slot: id, offset });
  });
  return offsets;
}

// Reconstruct the reordered slot list a consistent offset list produces from the setup order (the inverse
// of computeDrawOrderOffsets, the model-side of runtime-core's per-frame derivation). Each slot's target
// index is setupIndex + offset (0 for a slot absent from the list); because a consistent list's targets are
// a permutation of [0, count), placing each slot at its target index yields a total order. Used to read the
// CURRENT-at-playhead order back out of an existing key before applying another reorder.
export function applyDrawOrderOffsets<TId extends string>(
  setupOrder: readonly TId[],
  offsets: readonly DrawOrderOffset<TId>[],
): TId[] {
  const offsetBySlot = new Map<TId, number>();
  for (const entry of offsets) offsetBySlot.set(entry.slot, entry.offset);

  const placed: (TId | undefined)[] = new Array<TId | undefined>(setupOrder.length).fill(undefined);
  setupOrder.forEach((id, setupIdx) => {
    const target = setupIdx + (offsetBySlot.get(id) ?? 0);
    placed[target] = id;
  });
  // Every index is filled for a consistent list; the filter is a defensive no-op that also narrows the type.
  return placed.filter((id): id is TId => id !== undefined);
}

// Move the slot `id` one position earlier (direction -1) or later (direction +1) in `order`, returning the
// new order. A move past either end is a no-op and returns the SAME array reference, so the caller can skip
// keying an unchanged order (no useless history entry). Draw order is front-to-back: index 0 draws first
// (behind), so "earlier" (-1) moves a slot toward the back of the stack.
export function moveInOrder<TId extends string>(
  order: readonly TId[],
  id: TId,
  direction: -1 | 1,
): readonly TId[] {
  const index = order.indexOf(id);
  if (index < 0) return order;
  const target = index + direction;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  next[index] = next[target]!;
  next[target] = id;
  return next;
}
