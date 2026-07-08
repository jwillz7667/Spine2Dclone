import { describe, expect, it } from 'vitest';
import { applyClick, applyMarquee, toggle } from './selection-ops';

describe('toggle', () => {
  it('appends an absent id (keeping the earlier primary first)', () => {
    expect(toggle(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  it('removes a present id, promoting the next to primary when the primary is removed', () => {
    expect(toggle(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(toggle(['a', 'b', 'c'], 'a')).toEqual(['b', 'c']); // b is now primary
  });
});

describe('applyClick', () => {
  it('plain click selects exactly the clicked id', () => {
    expect(applyClick(['a', 'b'], 'c', false)).toEqual(['c']);
    expect(applyClick([], 'a', false)).toEqual(['a']);
  });

  it('plain click on the sole selection returns the same reference (no update)', () => {
    const current = ['a'];
    expect(applyClick(current, 'a', false)).toBe(current);
  });

  it('additive click toggles into the ordered set', () => {
    expect(applyClick(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(applyClick(['a', 'b'], 'b', true)).toEqual(['a']);
  });
});

describe('applyMarquee', () => {
  it('plain marquee replaces with the deduped hits', () => {
    expect(applyMarquee(['x'], ['a', 'b', 'a'], false)).toEqual(['a', 'b']);
  });

  it('plain empty marquee clears the selection', () => {
    expect(applyMarquee(['a', 'b'], [], false)).toEqual([]);
  });

  it('additive marquee unions hits onto the current selection, keeping the primary', () => {
    expect(applyMarquee(['a', 'b'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });

  it('additive empty marquee leaves the selection unchanged', () => {
    expect(applyMarquee(['a', 'b'], [], true)).toEqual(['a', 'b']);
  });
});
