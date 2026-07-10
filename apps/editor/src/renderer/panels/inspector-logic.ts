import type { PhysicsChannel, RGBA } from '@marionette/format/types';

// Pure naming, parsing, and placement logic for the slot/attachment inspector (WP-1.2, editor half). The
// panel (inspector-panel.tsx) is thin glue over document-core commands plus the ephemeral slot-selection
// store; every DECISION worth a test lives here as a pure function with no React, no document access, and
// no side effects. This is the house convention (mirrors animation-manager.ts and hierarchy-tree.ts): the
// editor vitest environment is `node`, so logic is unit-tested here and the .tsx is covered by typecheck
// and lint. Ids stay generic (TId extends string) so the helpers are branded-id agnostic.

// The base name a fresh slot defaults to before uniquification. Not a format constant (the validator
// never reads it); an editor UX default, uniquified per uniqueSlotName so a new slot does not export as
// an immediately-invalid duplicate (the validator owns SLOT_NAME_DUPLICATE at export).
export const DEFAULT_SLOT_BASENAME = 'slot';

// Return `base` if it is free, else `base` followed by the smallest numeric suffix (from 2) not already
// taken, for example ("hand") yields "hand" then "hand 2", "hand 3". Uniqueness here is a convenience for
// generated default names only; the format validator is the real uniqueness authority at export.
function nextFreeName(existingNames: readonly string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

// The attachment map key a newly added region defaults to: the atlas region name, uniquified against the
// names already on the slot so adding the same region twice does not collide on the map key (the key, not
// the `path`, must be unique within a slot; the path may repeat across attachments).
export function uniqueAttachmentName(existingNames: readonly string[], base: string): string {
  return nextFreeName(existingNames, base);
}

// The default name for a fresh slot, uniquified against the existing slot names.
export function uniqueSlotName(existingNames: readonly string[]): string {
  return nextFreeName(existingNames, DEFAULT_SLOT_BASENAME);
}

// Reconcile the EPHEMERAL slot selection after a DeleteSlot COMMITS: editor state, never part of the
// command (the document/editor wall, LAW 1). If the deleted slot was not the selected one the selection is
// untouched; if it was, fall back to the first remaining slot, or null when none remain. Generic over the
// id brand so it is trivially testable with plain strings (mirrors chooseActiveAfterDelete).
export function nextSlotAfterDelete<TId extends string>(
  remainingIds: readonly TId[],
  deletedId: TId,
  currentSelected: TId | null,
): TId | null {
  if (currentSelected !== deletedId) return currentSelected;
  return remainingIds[0] ?? null;
}

// Clamp to [0, 1] for RGBA channel inputs (NaN passes through unchanged; parseChannel filters NaN before
// calling this, so the channel path never sees it).
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Parse a free-form numeric input into a finite number, falling back on empty/NaN input. Used for the
// region-attachment transform fields, which are arbitrary finite values (position, rotation, scale, size),
// so this does NOT clamp. The fallback is the field's current committed value, so an invalid edit reverts.
export function parseFinite(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

// Parse an RGBA channel input: finite, then clamped to [0, 1]. Falls back to the current channel value on
// empty/NaN so a partial or garbage edit reverts to the live value rather than corrupting the color.
export function parseChannel(raw: string, fallback: number): number {
  return clampUnit(parseFinite(raw, fallback));
}

// The clamped target index for moving a slot one step in the draw order: direction -1 moves up (toward
// index 0, drawn earlier), +1 moves down (drawn later). Clamps into [0, count-1], so a move past either
// end returns the current index (a no-op the panel skips, avoiding a useless history entry). The result
// feeds ReorderSlotCommand, whose own clamp matches this range.
export function reorderTarget(currentIndex: number, direction: -1 | 1, count: number): number {
  return Math.max(0, Math.min(currentIndex + direction, count - 1));
}

// The physics-constraint numeric parameters the Inspector edits (PP-D12). `step`/`mass` are strictly
// positive, `inertia`/`damping`/`mix` are bounded to [0, 1], `strength` is non-negative, and `wind`/`gravity`
// are unbounded finite world-force inputs (ADR-0014 section 1). The skeleton physics settings block reuses
// the `gravity`/`wind`/`mix` cases (its three fields share the same ranges), so one parser covers both.
export type PhysicsParamField =
  | 'step'
  | 'inertia'
  | 'strength'
  | 'damping'
  | 'mass'
  | 'wind'
  | 'gravity'
  | 'mix';

// Parse a physics-parameter input into a value that satisfies its range, or null when the field is empty,
// non-numeric, or out of range. The Inspector drops a null (no command) so a mid-edit or invalid entry never
// reaches SetPhysicsConstraintParams (the ranges here match the format's PHYSICS_*_RANGE guards, so a parsed
// value is always accepted by the command).
export function parsePhysicsParam(field: PhysicsParamField, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  switch (field) {
    case 'step':
    case 'mass':
      return value > 0 ? value : null;
    case 'inertia':
    case 'damping':
    case 'mix':
      return value >= 0 && value <= 1 ? value : null;
    case 'strength':
      return value >= 0 ? value : null;
    case 'wind':
    case 'gravity':
      return value;
  }
}

// The five simulated local channels a physics constraint may drive (ADR-0014), in canonical order so a
// toggled set stays stable regardless of click sequence.
export const PHYSICS_CHANNELS: readonly PhysicsChannel[] = [
  'x',
  'y',
  'rotation',
  'scaleX',
  'shearX',
];

// Toggle one channel in a physics constraint's simulated set, returning the new set in canonical order, or
// null when the toggle would EMPTY the set. The Inspector drops a null (no command) so the last channel can
// never be turned off, keeping SetPhysicsConstraintChannels' non-empty guard from ever firing on a UI edit
// (a physics constraint must simulate at least one channel). Pure list logic, trivially testable.
export function togglePhysicsChannel(
  current: readonly PhysicsChannel[],
  channel: PhysicsChannel,
): PhysicsChannel[] | null {
  const present = new Set(current);
  if (present.has(channel)) present.delete(channel);
  else present.add(channel);
  if (present.size === 0) return null;
  return PHYSICS_CHANNELS.filter((c) => present.has(c));
}

// The minimum trim metadata regionAttachmentDefaults needs from an atlas region. AtlasRegion carries these
// fields (plus name/x/y/rotated), so a real AtlasRegion is structurally assignable here; the narrow shape
// keeps this module decoupled from the full format type and trivially constructible in tests.
export interface RegionTrim {
  readonly w: number; // trimmed (packed) width
  readonly h: number; // trimmed (packed) height
  readonly offsetX: number; // top-left X of the trimmed content within the original sprite
  readonly offsetY: number; // top-left Y of the trimmed content within the original sprite (Y-down)
  readonly originalW: number; // original (untrimmed) sprite width
  readonly originalH: number; // original (untrimmed) sprite height
}

// The placement + size + color a fresh region attachment is created with (everything but name/path).
export interface RegionAttachmentDefaults {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// THE TRIM-OFFSET DEFAULT (WP-1.2 TASK-1.2.3). A packer trims transparent borders off a sprite, so the
// atlas region is the opaque sub-rectangle of the original, located at (offsetX, offsetY) from the
// original's top-left with size (w, h). The runtime draws a region attachment as a CENTERED quad (sprite
// anchor 0.5) of size width x height, placed by compose(x, y, rotation, scaleX, scaleY) (see
// runtime-web/src/scene/region-placement.ts computeRegionSized). To make the trimmed quad land exactly
// where the trimmed content sat inside the original, the quad must be sized to the trim (width=w,
// height=h) and its center offset from the original's center by the trimmed-content-center displacement:
//
//   x = offsetX + w/2 - originalW/2
//   y = offsetY + h/2 - originalH/2
//
// The Y sign is POSITIVE (same form as X), NOT negated. The editor viewport's world Y axis points DOWN
// (PixiJS screen convention: the world container applies only translate + uniform positive scale with no
// Y flip, and bone world matrices are assigned to display objects verbatim), the region sprite is centered
// and unflipped (attachment-sprites.ts), and offsetY is measured from the original's TOP (Y-down). Image
// Y and world Y therefore share orientation, so no sign flip is needed. The placement-equivalence test
// pins this against the ACTUAL computeRegionSized/placeRegion math; the wrong sign misses by originalH - h
// pixels. For an UNTRIMMED region (offsetX=offsetY=0, w=originalW, h=originalH) this yields x=0, y=0,
// width=originalW, height=originalH (identity placement).
export function regionAttachmentDefaults(region: RegionTrim): RegionAttachmentDefaults {
  return {
    x: region.offsetX + region.w / 2 - region.originalW / 2,
    y: region.offsetY + region.h / 2 - region.originalH / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: region.w,
    height: region.h,
    color: { r: 1, g: 1, b: 1, a: 1 },
  };
}
