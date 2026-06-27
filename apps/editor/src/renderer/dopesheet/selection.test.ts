import { describe, expect, it } from 'vitest';
import type { KeyframeId } from '../document';
import { hitTestKey, marqueeSelect, type LaidOutKey } from './selection';

const kid = (s: string): KeyframeId => s as KeyframeId;

const KEYS: readonly LaidOutKey[] = [
  { id: kid('k1'), x: 100, y: 50 },
  { id: kid('k2'), x: 200, y: 50 },
  { id: kid('k3'), x: 200, y: 100 },
  { id: kid('k4'), x: 340, y: 100 },
];

const RADIUS = 6;

describe('dopesheet selection', () => {
  it('hit-tests the diamond within the pixel tolerance', () => {
    expect(hitTestKey(KEYS, 100, 50, RADIUS)).toBe(kid('k1'));
    expect(hitTestKey(KEYS, 103, 48, RADIUS)).toBe(kid('k1')); // l1 = 5 <= 6
    expect(hitTestKey(KEYS, 100, 60, RADIUS)).toBeNull(); // l1 = 10 > 6
  });

  it('resolves overlapping diamonds to the nearest', () => {
    const overlapping: readonly LaidOutKey[] = [
      { id: kid('a'), x: 200, y: 50 },
      { id: kid('b'), x: 203, y: 50 },
    ];
    expect(hitTestKey(overlapping, 201, 50, RADIUS)).toBe(kid('a'));
    expect(hitTestKey(overlapping, 202.5, 50, RADIUS)).toBe(kid('b'));
  });

  it('box-selects exactly the diamonds intersecting the marquee', () => {
    const selected = marqueeSelect(KEYS, { x0: 150, y0: 40, x1: 260, y1: 60 }, RADIUS);
    expect(selected).toEqual([kid('k2')]);
  });

  it('treats the marquee corners order-independently', () => {
    const a = marqueeSelect(KEYS, { x0: 150, y0: 40, x1: 360, y1: 110 }, RADIUS);
    const b = marqueeSelect(KEYS, { x0: 360, y0: 110, x1: 150, y1: 40 }, RADIUS);
    expect(a).toEqual([kid('k2'), kid('k3'), kid('k4')]);
    expect(b).toEqual(a);
  });

  it('includes a diamond grazing the marquee edge at exactly the radius and excludes just beyond', () => {
    expect(marqueeSelect(KEYS, { x0: 106, y0: 44, x1: 160, y1: 56 }, RADIUS)).toEqual([kid('k1')]);
    expect(marqueeSelect(KEYS, { x0: 107, y0: 44, x1: 160, y1: 56 }, RADIUS)).toEqual([]);
  });
});
