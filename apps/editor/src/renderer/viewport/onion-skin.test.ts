import { describe, expect, it } from 'vitest';
import { deriveOnionGhosts, MAX_GHOSTS_PER_SIDE, type OnionSkinSettings } from './onion-skin';

const BASE: OnionSkinSettings = {
  enabled: true,
  before: 2,
  after: 2,
  frameStep: 1,
  opacity: 0.4,
  falloff: 0.5,
};

describe('deriveOnionGhosts', () => {
  it('returns nothing when disabled or when there is no period', () => {
    expect(deriveOnionGhosts({ ...BASE, enabled: false }, 1, 30, 2, false)).toEqual([]);
    expect(deriveOnionGhosts(BASE, 1, 30, 0, false)).toEqual([]);
    expect(deriveOnionGhosts({ ...BASE, before: 0, after: 0 }, 1, 30, 2, false)).toEqual([]);
  });

  it('places ghosts at +/- frameStep frames with nearest-first opacity falloff', () => {
    // playhead 1.0s at 30fps, step 1 frame = 1/30s. Two ghosts each side.
    const ghosts = deriveOnionGhosts(BASE, 1, 30, 2, false);
    const before = ghosts.filter((g) => g.side === 'before');
    const after = ghosts.filter((g) => g.side === 'after');

    expect(before.map((g) => g.step)).toEqual([2, 1]); // farthest-first ordering
    expect(after.map((g) => g.step)).toEqual([2, 1]);
    // Nearest ghost (step 1) is the base opacity; step 2 is base * falloff.
    const near = after.find((g) => g.step === 1)!;
    const far = after.find((g) => g.step === 2)!;
    expect(near.opacity).toBeCloseTo(0.4, 9);
    expect(far.opacity).toBeCloseTo(0.2, 9);
    // Times are symmetric around the playhead.
    expect(near.time).toBeCloseTo(1 + 1 / 30, 9);
    expect(before.find((g) => g.step === 1)!.time).toBeCloseTo(1 - 1 / 30, 9);
  });

  it('drops ghosts whose time falls outside [0, duration] when not looping', () => {
    // playhead at 0: the two before-ghosts are negative and dropped; after-ghosts remain.
    const ghosts = deriveOnionGhosts(BASE, 0, 30, 2, false);
    expect(ghosts.every((g) => g.side === 'after')).toBe(true);
    expect(ghosts).toHaveLength(2);
  });

  it('wraps ghost times into the period when looping', () => {
    // playhead at 0, looping, duration 2s: the before-ghosts wrap to near the tail.
    const ghosts = deriveOnionGhosts(BASE, 0, 30, 2, true);
    const before = ghosts.filter((g) => g.side === 'before');
    expect(before).toHaveLength(2);
    for (const g of before) {
      expect(g.time).toBeGreaterThan(0);
      expect(g.time).toBeLessThan(2);
    }
    // step-1 before ghost wraps to duration - 1/30.
    expect(before.find((g) => g.step === 1)!.time).toBeCloseTo(2 - 1 / 30, 9);
  });

  it('drops ghosts that fall below the visibility threshold', () => {
    // A tiny base opacity with steep falloff makes only the nearest ghost visible.
    const faint = deriveOnionGhosts(
      { ...BASE, before: 4, after: 0, opacity: 0.03, falloff: 0.1 },
      1,
      30,
      2,
      false,
    );
    expect(faint).toHaveLength(1);
    expect(faint[0]!.step).toBe(1);
  });

  it('honors frameStep spacing and clamps the per-side count', () => {
    const stepped = deriveOnionGhosts(
      { ...BASE, before: 0, after: 1, frameStep: 6 },
      0,
      30,
      2,
      false,
    );
    expect(stepped[0]!.time).toBeCloseTo(6 / 30, 9); // 6 frames ahead

    const many = deriveOnionGhosts(
      { ...BASE, before: 100, after: 0, opacity: 1, falloff: 1 },
      1,
      30,
      100,
      false,
    );
    expect(many.length).toBeLessThanOrEqual(MAX_GHOSTS_PER_SIDE);
  });
});
