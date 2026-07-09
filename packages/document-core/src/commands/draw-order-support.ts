import type { DrawOrderKeyEntity, DrawOrderOffsetEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import type { Mutator } from '../model/mutator';
import { DrawOrderError } from '../command/errors';

// Shared helpers for the Stage F1 (PP-D9) draw-order timeline commands. Kept out of a *.command.ts file so
// the discovery guard (one spec per command file) does not pick them up.

// Sort draw-order keys by ascending time. Draw-order key times are STRICTLY ascending (a discrete swap
// between two keys at the same time is undefined, ADR-0008 section 3), so callers guarantee unique times
// and the comparator never ties.
export function sortDrawOrderKeysByTime(keys: readonly DrawOrderKeyEntity[]): DrawOrderKeyEntity[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

// Assert an offset list is a CONSISTENT partial reordering of the setup draw order (the format's
// DRAWORDER_INCOMPLETE), thrown BEFORE any mutation so an inconsistent draw-order key leaves no document
// change and no history entry. Each listed slot must exist and appear at most once, and the derived target
// indices (setup index + offset) must all be distinct and within [0, slotCount). The setup index is the
// slot's position in the current setup draw order (mutate.slots(), which is slotOrder). This is the
// command-boundary mirror of the export validator's DRAWORDER_INCOMPLETE.
export function assertConsistentDrawOrder(
  mutate: Mutator,
  offsets: readonly DrawOrderOffsetEntity[],
): void {
  const order = mutate.slots(); // in slotOrder (the setup draw order)
  const slotCount = order.length;
  const setupIndex = new Map<SlotId, number>();
  order.forEach((slot, index) => setupIndex.set(slot.id, index));

  const seenSlots = new Set<SlotId>();
  const targets = new Map<number, SlotId>();
  for (const entry of offsets) {
    const index = setupIndex.get(entry.slot);
    if (index === undefined) throw new DrawOrderError('slotMissing', entry.slot);
    if (seenSlots.has(entry.slot)) throw new DrawOrderError('slotDuplicate', entry.slot);
    seenSlots.add(entry.slot);
    const target = index + entry.offset;
    if (target < 0 || target >= slotCount) {
      throw new DrawOrderError(
        'targetOutOfRange',
        `slot ${entry.slot} target ${target} is outside [0, ${slotCount})`,
      );
    }
    const other = targets.get(target);
    if (other !== undefined) {
      throw new DrawOrderError('targetCollision', `slots ${other} and ${entry.slot} both target ${target}`);
    }
    targets.set(target, entry.slot);
  }
}
