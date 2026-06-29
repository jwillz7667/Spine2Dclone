import { rollupValueAt } from '@marionette/runtime-core';
import type { PresentationDirective, PresentationTimeline } from '@marionette/runtime-core';

// The pure directive-cursor + rollup-display logic of the slot TimelinePlayer (phase-4 WP-4.11 TASK-4.11.2
// /4.11.3, the CI-verifiable slice). A PresentationTimeline is a flat list of directives pre-sorted by
// (atMs, seq) by the runtime-core sequencer; the player owns a monotonic clock and dispatches each
// directive once when the clock passes its atMs. This module is the non-GL HEART of the player: it
// advances a single index over the sorted directives (O(1) amortized per directive, ZERO per-frame
// allocation, the onFire callback is supplied by the caller) and computes the pinned counter-rollup
// display integer. The actual GL work (pooled skeleton instances, ParticleContainer VFX, the glyph
// counter, cascade tweens) is the renderer that consumes these dispatched directives; that draw path needs
// a WebGL context and is not exercised here. This logic is pure (no pixi), so it is headless-testable and
// is the SAME cursor the editor preview and runtime-web both drive (one code path, no second timing model).
//
// Clock ownership: the player owns `currentTimeMs` (advanced from a monotonic clock that lives in
// runtime-web, never in runtime-core). The editor mirrors it one-way into Zustand for scrub UI; runtime-web
// imports no editor state. Conversion to seconds happens only at the GL edge, never here.

export interface TimelineCursor {
  // The player's authoritative clock position, in integer milliseconds.
  currentTimeMs: number;
  // The index of the next not-yet-fired directive in the timeline's sorted `directives` array.
  nextIndex: number;
}

export function makeTimelineCursor(): TimelineCursor {
  return { currentTimeMs: 0, nextIndex: 0 };
}

// Reset the cursor to time 0 with nothing fired. A backward seek resets then re-advances to the target,
// replaying the timeline from the start (the renderer re-applies directives idempotently); a forward-only
// cursor never walks the index backward, which keeps dispatch O(total directives) across a full playback.
export function resetTimelineCursor(cursor: TimelineCursor): void {
  cursor.currentTimeMs = 0;
  cursor.nextIndex = 0;
}

// Advance the cursor to `timeMs` (must be >= currentTimeMs; for a rewind, reset first), firing every
// not-yet-fired directive whose atMs <= timeMs in timeline order via `onFire`. Allocation-free: it walks a
// single index and invokes the caller's callback; it never builds an array. Because the timeline is sorted
// by the total (atMs, seq) order, directives fire in exactly the deterministic emission order on every
// runtime.
export function advanceTimelineTo(
  cursor: TimelineCursor,
  timeline: PresentationTimeline,
  timeMs: number,
  onFire: (directive: PresentationDirective) => void,
): void {
  cursor.currentTimeMs = timeMs;
  const directives = timeline.directives;
  while (cursor.nextIndex < directives.length && directives[cursor.nextIndex]!.atMs <= timeMs) {
    onFire(directives[cursor.nextIndex]!);
    cursor.nextIndex += 1;
  }
}

// A counterRollup directive (narrowed from the union) and its pinned display value.
type CounterRollupDirective = Extract<PresentationDirective, { kind: 'counterRollup' }>;

// The displayed integer win-counter value for one counterRollup directive at `atMs`, computed through the
// pinned integer/fixed-point `rollupValueAt` (section 5.4.2) so the on-screen integer is the cross-runtime
// contract value, not a renderer-local float curve.
export function counterRollupDisplayValue(directive: CounterRollupDirective, atMs: number): number {
  return rollupValueAt(
    directive.fromUnits,
    directive.toUnits,
    directive.startMs,
    directive.endMs,
    atMs,
    directive.curve,
  );
}

// The active win-counter display value at `atMs`: the value of the LATEST counterRollup whose startMs has
// passed (the one currently animating or last completed), or null when no rollup has started yet. A
// convenience for the HUD counter; the directives are sorted, so the latest-started rollup is the last
// counterRollup with startMs <= atMs.
export function currentRollupValue(timeline: PresentationTimeline, atMs: number): number | null {
  let active: CounterRollupDirective | null = null;
  for (const directive of timeline.directives) {
    if (directive.kind === 'counterRollup' && directive.startMs <= atMs) active = directive;
  }
  return active === null ? null : counterRollupDisplayValue(active, atMs);
}
