import { describe, expect, it } from 'vitest';
import { rollupValueAt } from '@marionette/runtime-core';
import type { PresentationDirective, PresentationTimeline } from '@marionette/runtime-core';
import { symbolId } from '@marionette/format/slot';
import {
  advanceTimelineTo,
  counterRollupDisplayValue,
  currentRollupValue,
  makeTimelineCursor,
  resetTimelineCursor,
} from '../src/slot/timeline-cursor';

// WP-4.11 slice: the pure directive-cursor + rollup-display logic (the non-GL heart of the TimelinePlayer).
// It dispatches each directive once when the clock passes its atMs, in the deterministic (atMs, seq) order,
// allocation-free, and computes the pinned counter-rollup display integer via rollupValueAt.

// A small hand-built timeline (already sorted by (atMs, seq), as the sequencer emits): two landing
// directives at 0, a counterRollup starting at 100, and a late escalation at 1100.
function timeline(): PresentationTimeline {
  const directives: PresentationDirective[] = [
    { kind: 'reelStop', col: 0, atMs: 0, seq: 0 },
    { kind: 'symbolLand', row: 0, col: 0, symbol: symbolId('A'), atMs: 0, seq: 1 },
    {
      kind: 'counterRollup',
      fromUnits: 0,
      toUnits: 1000,
      startMs: 100,
      endMs: 1100,
      curve: 'linear',
      atMs: 100,
      seq: 2,
    },
    { kind: 'escalation', tier: 'big', atMs: 1100, seq: 3 },
  ];
  return { spinId: 'spin-1', durationMs: 1100, directives };
}

describe('TimelineCursor (WP-4.11 slice)', () => {
  it('fires directives once, in (atMs, seq) order, as the clock advances', () => {
    const tl = timeline();
    const cursor = makeTimelineCursor();
    const fired: number[] = [];
    const record = (d: PresentationDirective): void => {
      fired.push(d.seq);
    };

    advanceTimelineTo(cursor, tl, 0, record);
    expect(fired).toEqual([0, 1]); // both atMs-0 directives, seq order

    advanceTimelineTo(cursor, tl, 100, record);
    expect(fired).toEqual([0, 1, 2]); // the counterRollup at 100 fires; nothing re-fires

    advanceTimelineTo(cursor, tl, 1100, record);
    expect(fired).toEqual([0, 1, 2, 3]); // the escalation at 1100 fires

    // Advancing further fires nothing new (every directive fired exactly once).
    advanceTimelineTo(cursor, tl, 5000, record);
    expect(fired).toEqual([0, 1, 2, 3]);
    expect(cursor.currentTimeMs).toBe(5000);
  });

  it('does not fire a directive before its atMs', () => {
    const tl = timeline();
    const cursor = makeTimelineCursor();
    const fired: number[] = [];
    advanceTimelineTo(cursor, tl, 50, (d) => fired.push(d.seq));
    // The rollup (atMs 100) and escalation (atMs 1100) have not fired.
    expect(fired).toEqual([0, 1]);
  });

  it('replays from the start after a reset (backward seek)', () => {
    const tl = timeline();
    const cursor = makeTimelineCursor();
    advanceTimelineTo(cursor, tl, 1100, () => {});
    expect(cursor.nextIndex).toBe(4);

    resetTimelineCursor(cursor);
    expect(cursor.currentTimeMs).toBe(0);
    const fired: number[] = [];
    advanceTimelineTo(cursor, tl, 200, (d) => fired.push(d.seq));
    expect(fired).toEqual([0, 1, 2]); // re-fired from the start up to 200ms
  });

  it('counterRollupDisplayValue equals the pinned rollupValueAt', () => {
    const tl = timeline();
    const rollup = tl.directives.find((d) => d.kind === 'counterRollup')!;
    if (rollup.kind !== 'counterRollup') throw new Error('expected a counterRollup');
    // Midpoint of [100, 1100] linear 0->1000 is 500 at 600ms.
    expect(counterRollupDisplayValue(rollup, 600)).toBe(
      rollupValueAt(0, 1000, 100, 1100, 600, 'linear'),
    );
    expect(counterRollupDisplayValue(rollup, 600)).toBe(500);
    // Clamps below start and at/after end.
    expect(counterRollupDisplayValue(rollup, 0)).toBe(0);
    expect(counterRollupDisplayValue(rollup, 2000)).toBe(1000);
  });

  it('currentRollupValue returns the active rollup value (or null before any starts)', () => {
    const tl = timeline();
    expect(currentRollupValue(tl, 50)).toBeNull(); // before the rollup starts
    expect(currentRollupValue(tl, 600)).toBe(500); // mid-rollup
    expect(currentRollupValue(tl, 5000)).toBe(1000); // after completion
  });
});
