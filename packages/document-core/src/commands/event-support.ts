import type { EventKeyEntity } from '../model/doc-state';
import type { EventDefId } from '../model/ids';
import type { Mutator } from '../model/mutator';
import { EventEditError } from '../command/errors';

// Shared helpers for the Stage F1 (PP-D9) event-definition and event-timeline commands. Kept out of a
// *.command.ts file so the discovery guard (one spec per command file) does not pick them up.

// Sort event keys by ascending time. Array.prototype.sort is stable, so two events at the SAME time keep
// their relative order (event times are NON-DECREASING, ADR-0008 section 2, unlike the strictly-ascending
// value timelines, so coincident firings are legal and must not be reordered against each other).
export function sortEventKeysByTime(keys: readonly EventKeyEntity[]): EventKeyEntity[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

// Reject an empty event name (the structural floor the format schema also enforces with .min(1)).
export function assertEventNameNonEmpty(name: string): void {
  if (name.length === 0) throw new EventEditError('emptyName');
}

// Reject a name another event definition already uses. `exceptId` lets RenameEvent keep its own name
// (renaming to the current name is a no-op, not a collision). Event names are the on-disk identity and are
// unique across the document (the format's EVENT_NAME_DUPLICATE).
export function assertEventNameFree(mutate: Mutator, name: string, exceptId?: EventDefId): void {
  for (const def of mutate.eventDefs()) {
    if (def.id !== exceptId && def.name === name) {
      throw new EventEditError('duplicateName', name);
    }
  }
}

// Reject an audio hint whose volume is outside [0, 1] or balance outside [-1, 1] (the format's
// EVENT_AUDIO_RANGE). A cleared hint (undefined) is always valid.
export function assertEventAudioInRange(
  audio: { readonly volume: number; readonly balance: number } | undefined,
): void {
  if (audio === undefined) return;
  if (audio.volume < 0 || audio.volume > 1) {
    throw new EventEditError('audioRange', `volume ${audio.volume} must be in [0, 1]`);
  }
  if (audio.balance < -1 || audio.balance > 1) {
    throw new EventEditError('audioRange', `balance ${audio.balance} must be in [-1, 1]`);
  }
}
