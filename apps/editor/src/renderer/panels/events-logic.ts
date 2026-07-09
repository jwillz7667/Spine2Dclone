import type { EventAudioValue } from '../document';
import type { EventDefInit } from '../document';

// Pure naming, parsing, and normalization logic for the Events panel (Stage F1, PP-D9). The panel
// (events-panel.tsx) is thin glue over document-core commands plus the ephemeral event-selection store;
// every DECISION worth a test lives here as a pure function with no React, no document access, and no side
// effects. This is the house convention (mirrors animation-manager.ts and inspector-logic.ts): the editor
// vitest environment is `node`, so logic is unit-tested here and the .tsx is covered by typecheck and lint.

// A fresh event definition defaults to the base name "event", uniquified against the existing names so a
// brand-new event does not collide (event names are the on-disk identity and unique across the document).
export const DEFAULT_EVENT_BASENAME = 'event';

// The default audio hint values a fresh hint is created with when the author supplies a path but leaves
// the volume/balance fields empty: full volume, centered balance. Both are the neutral values.
export const DEFAULT_VOLUME = 1;
export const DEFAULT_BALANCE = 0;

// Return `base` if it is free, else `base` followed by the smallest numeric suffix (from 2) not already
// taken, for example ("event") yields "event" then "event 2", "event 3". Uniqueness here is a convenience
// for the generated default name only; the DefineEvent command (and the format validator) is the real
// uniqueness authority (EVENT_NAME_DUPLICATE), so a user-typed rename may still collide and is rejected there.
export function uniqueEventName(existingNames: readonly string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

// Parse a free-form numeric input into a finite number, falling back on empty/NaN input (mirrors
// inspector-logic.parseFinite; kept local so this module has no cross-panel dependency).
export function parseFinite(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

// Parse the OPTIONAL integer payload default: empty or non-finite yields undefined (the field is cleared);
// a finite value is truncated to an integer because the format requires `int` to be an integer (a
// non-integer would fail export as SCHEMA_SHAPE). Truncation toward zero matches Number-to-int intent.
export function parseOptionalInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

// Parse the OPTIONAL float payload default: empty or non-finite yields undefined; a finite value passes
// through unchanged (the format's `float` is any finite number).
export function parseOptionalFloat(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

// Parse the OPTIONAL string payload default: an all-whitespace/empty entry clears the field (undefined),
// otherwise the trimmed text is kept (a text field's incidental leading/trailing whitespace is dropped).
export function parseOptionalString(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

// Clamp an audio volume into the format's [0, 1] range (EVENT_AUDIO_RANGE), so the panel never authors an
// out-of-range hint the SetEventAudio command would reject.
export function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Clamp a stereo balance into the format's [-1, 1] range (EVENT_AUDIO_RANGE).
export function clampBalance(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

// Build an event audio hint from the raw path/volume/balance inputs, or undefined to CLEAR the hint. An
// empty (whitespace-only) path means "no audio", so the whole hint is dropped (the format requires a
// non-empty path, so a hint with an empty path is not representable). A present path pairs with a volume
// clamped to [0, 1] and a balance clamped to [-1, 1], defaulting the neutral values when a field is empty,
// so the result is always in range and the command never has to reject it.
export function buildEventAudio(
  pathRaw: string,
  volumeRaw: string,
  balanceRaw: string,
): EventAudioValue | undefined {
  const path = pathRaw.trim();
  if (path === '') return undefined;
  return {
    path,
    volume: clampVolume(parseFinite(volumeRaw, DEFAULT_VOLUME)),
    balance: clampBalance(parseFinite(balanceRaw, DEFAULT_BALANCE)),
  };
}

// Compose the full DefineEvent init from the raw payload/audio inputs a new-event form collects. Each
// payload field is optional (cleared to undefined when empty), the int is integer-normalized, and the
// audio hint is built and range-normalized. This is the single place the form's raw strings become the
// typed command payload, so it is the decision worth a test.
export function buildEventDefInit(inputs: {
  readonly intRaw: string;
  readonly floatRaw: string;
  readonly stringRaw: string;
  readonly pathRaw: string;
  readonly volumeRaw: string;
  readonly balanceRaw: string;
}): EventDefInit {
  return {
    int: parseOptionalInt(inputs.intRaw),
    float: parseOptionalFloat(inputs.floatRaw),
    string: parseOptionalString(inputs.stringRaw),
    audio: buildEventAudio(inputs.pathRaw, inputs.volumeRaw, inputs.balanceRaw),
  };
}
