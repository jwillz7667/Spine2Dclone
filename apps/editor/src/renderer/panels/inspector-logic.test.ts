import { describe, expect, it } from 'vitest';
import { identity, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import { computeRegionSized, placeRegion } from '@marionette/runtime-web';
import type { RegionAttachment } from '@marionette/format/types';
import {
  clampUnit,
  nextSlotAfterDelete,
  parseChannel,
  parseFinite,
  parsePhysicsParam,
  regionAttachmentDefaults,
  reorderTarget,
  togglePhysicsChannel,
  uniqueAttachmentName,
  uniqueSlotName,
  type RegionTrim,
} from './inspector-logic';

describe('uniqueAttachmentName', () => {
  it('returns the base name unchanged when it is free', () => {
    expect(uniqueAttachmentName(['head', 'torso'], 'hand')).toBe('hand');
  });

  it('appends suffix 2 on a single collision', () => {
    expect(uniqueAttachmentName(['hand'], 'hand')).toBe('hand 2');
  });

  it('skips a run of collisions to the first free suffix', () => {
    expect(uniqueAttachmentName(['hand', 'hand 2', 'hand 3'], 'hand')).toBe('hand 4');
  });
});

describe('uniqueSlotName', () => {
  it('defaults to "slot" when free', () => {
    expect(uniqueSlotName([])).toBe('slot');
  });

  it('uniquifies against existing slot names', () => {
    expect(uniqueSlotName(['slot', 'slot 2'])).toBe('slot 3');
  });
});

describe('nextSlotAfterDelete', () => {
  it('leaves a non-selected deletion untouched', () => {
    expect(nextSlotAfterDelete(['a', 'b'], 'c', 'a')).toBe('a');
  });

  it('falls back to the first remaining when the selected one is deleted', () => {
    expect(nextSlotAfterDelete(['b', 'c'], 'a', 'a')).toBe('b');
  });

  it('returns null when the selected one is deleted and none remain', () => {
    expect(nextSlotAfterDelete([], 'a', 'a')).toBeNull();
  });

  it('returns null when nothing was selected', () => {
    expect(nextSlotAfterDelete(['a'], 'b', null)).toBeNull();
  });
});

describe('clampUnit', () => {
  it('clamps below 0 and above 1 and passes through in-range values', () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.5)).toBe(1);
    expect(clampUnit(0.42)).toBe(0.42);
  });
});

describe('parseFinite', () => {
  it('parses a finite number', () => {
    expect(parseFinite('12.5', 0)).toBe(12.5);
    expect(parseFinite('-3', 0)).toBe(-3);
  });

  it('falls back on empty or non-numeric input', () => {
    expect(parseFinite('', 7)).toBe(7);
    expect(parseFinite('   ', 7)).toBe(7);
    expect(parseFinite('abc', 7)).toBe(7);
  });
});

describe('parseChannel', () => {
  it('parses and clamps to [0, 1]', () => {
    expect(parseChannel('0.5', 0)).toBe(0.5);
    expect(parseChannel('2', 0)).toBe(1);
    expect(parseChannel('-1', 0)).toBe(0);
  });

  it('falls back to the current channel on empty or NaN', () => {
    expect(parseChannel('', 0.3)).toBe(0.3);
    expect(parseChannel('xyz', 0.3)).toBe(0.3);
  });
});

describe('reorderTarget', () => {
  it('moves one step toward the start or end', () => {
    expect(reorderTarget(2, -1, 5)).toBe(1);
    expect(reorderTarget(2, 1, 5)).toBe(3);
  });

  it('is a no-op (returns the current index) at the ends', () => {
    expect(reorderTarget(0, -1, 5)).toBe(0);
    expect(reorderTarget(4, 1, 5)).toBe(4);
  });
});

describe('regionAttachmentDefaults', () => {
  it('yields identity placement for an untrimmed region', () => {
    const untrimmed: RegionTrim = {
      w: 100,
      h: 80,
      offsetX: 0,
      offsetY: 0,
      originalW: 100,
      originalH: 80,
    };

    expect(regionAttachmentDefaults(untrimmed)).toEqual({
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 100,
      height: 80,
      color: { r: 1, g: 1, b: 1, a: 1 },
    });
  });

  it('offsets the trimmed-content center from the original center (known case, positive Y sign)', () => {
    // Opaque content occupies original-image rect [20, 60] x [15, 45]: w=40, h=30 at (offsetX,offsetY)=
    // (20,15) of a 100x80 original. Center displacement: x = 20 + 20 - 50 = -10, y = 15 + 15 - 40 = -10.
    const trimmed: RegionTrim = {
      w: 40,
      h: 30,
      offsetX: 20,
      offsetY: 15,
      originalW: 100,
      originalH: 80,
    };

    const defaults = regionAttachmentDefaults(trimmed);

    expect(defaults.x).toBe(-10);
    expect(defaults.y).toBe(-10);
    expect(defaults.width).toBe(40);
    expect(defaults.height).toBe(30);
  });

  // The load-bearing acceptance: a trimmed sprite renders at the same on-screen pixel position as its
  // untrimmed original within 1px at identity attachment transform. This routes BOTH placements through
  // the runtime's real computeRegionSized/placeRegion/transformPoint, so it is self-consistent with the
  // renderer and pins the Y sign: an opaque pixel of the original maps to one quad-local coordinate, and
  // its world position must agree whether the sprite is the full original or the trimmed region. The
  // quad-local mapping below uses the renderer's convention (image Y-down, no flip, world Y-down), the
  // same one regionAttachmentDefaults's Y formula assumes; the wrong sign misses by originalH - h pixels.
  it('places a trimmed region pixel-identically to its untrimmed original (pins the Y sign)', () => {
    const originalW = 100;
    const originalH = 80;
    const trim: RegionTrim = { w: 40, h: 30, offsetX: 20, offsetY: 15, originalW, originalH };
    const full: RegionTrim = {
      w: originalW,
      h: originalH,
      offsetX: 0,
      offsetY: 0,
      originalW,
      originalH,
    };

    const fullAttachment = toRegionAttachment(regionAttachmentDefaults(full));
    const trimAttachment = toRegionAttachment(regionAttachmentDefaults(trim));

    // A physical opaque pixel of the original sprite, in original-image coords (top-left origin, Y-down),
    // chosen inside the trimmed rect so it exists in both renderings.
    const px = 35;
    const py = 28;

    const worldThroughFull = worldOfPixel(fullAttachment, full, px, py);
    const worldThroughTrim = worldOfPixel(trimAttachment, trim, px, py);

    expect(Math.abs(worldThroughTrim[0] - worldThroughFull[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(worldThroughTrim[1] - worldThroughFull[1])).toBeLessThanOrEqual(1);
    // The math is exact (the 1px budget is slack), so pin it tightly to catch any sign/scale regression.
    expect(worldThroughTrim[0]).toBeCloseTo(worldThroughFull[0], 9);
    expect(worldThroughTrim[1]).toBeCloseTo(worldThroughFull[1], 9);
  });
});

// Build a setup-pose region attachment from authored defaults (identity bone). type/path are inert for
// placement (computeRegionSized reads only the transform + size fields).
function toRegionAttachment(
  defaults: ReturnType<typeof regionAttachmentDefaults>,
): RegionAttachment {
  return { type: 'region', path: 'sprite', ...defaults };
}

// The world position of an original-image pixel rendered through a region attachment at identity bone.
// The region's quad is centered (anchor 0.5), so the pixel's quad-local coordinate is its offset from the
// region's center, normalized by the region's trimmed size: lx,ly in [-0.5, 0.5], Y-down (no flip),
// matching the renderer. placeRegion(identity, sized) is the sprite's world matrix; transformPoint maps
// the quad-local point through it.
function worldOfPixel(
  attachment: RegionAttachment,
  region: RegionTrim,
  px: number,
  py: number,
): readonly [number, number] {
  const lx = (px - (region.offsetX + region.w / 2)) / region.w;
  const ly = (py - (region.offsetY + region.h / 2)) / region.h;
  const sized = computeRegionSized(attachment);
  const world: Mat2x3 = placeRegion(identity(), sized);
  return transformPoint(world, lx, ly);
}

describe('inspector-logic: parsePhysicsParam', () => {
  it('accepts strictly positive step and mass', () => {
    expect(parsePhysicsParam('step', '0.016')).toBeCloseTo(0.016);
    expect(parsePhysicsParam('mass', '2')).toBe(2);
    expect(parsePhysicsParam('step', '0')).toBeNull();
    expect(parsePhysicsParam('mass', '-1')).toBeNull();
    expect(parsePhysicsParam('mass', '0')).toBeNull();
  });

  it('bounds inertia, damping, and mix to [0, 1]', () => {
    expect(parsePhysicsParam('inertia', '0')).toBe(0);
    expect(parsePhysicsParam('damping', '1')).toBe(1);
    expect(parsePhysicsParam('mix', '0.5')).toBe(0.5);
    expect(parsePhysicsParam('inertia', '1.1')).toBeNull();
    expect(parsePhysicsParam('mix', '-0.01')).toBeNull();
  });

  it('accepts non-negative strength and any finite wind/gravity', () => {
    expect(parsePhysicsParam('strength', '0')).toBe(0);
    expect(parsePhysicsParam('strength', '40')).toBe(40);
    expect(parsePhysicsParam('strength', '-1')).toBeNull();
    expect(parsePhysicsParam('wind', '-25')).toBe(-25);
    expect(parsePhysicsParam('gravity', '9.8')).toBeCloseTo(9.8);
  });

  it('rejects empty and non-numeric input for every field', () => {
    expect(parsePhysicsParam('mix', '')).toBeNull();
    expect(parsePhysicsParam('mix', '   ')).toBeNull();
    expect(parsePhysicsParam('gravity', 'abc')).toBeNull();
    expect(parsePhysicsParam('wind', 'NaN')).toBeNull();
    expect(parsePhysicsParam('gravity', 'Infinity')).toBeNull();
  });
});

describe('inspector-logic: togglePhysicsChannel', () => {
  it('adds a channel and keeps canonical order', () => {
    expect(togglePhysicsChannel(['rotation'], 'x')).toEqual(['x', 'rotation']);
    expect(togglePhysicsChannel(['shearX', 'x'], 'rotation')).toEqual(['x', 'rotation', 'shearX']);
  });

  it('removes a present channel', () => {
    expect(togglePhysicsChannel(['x', 'rotation'], 'x')).toEqual(['rotation']);
  });

  it('returns null when the toggle would empty the set (keeping at least one channel)', () => {
    expect(togglePhysicsChannel(['rotation'], 'rotation')).toBeNull();
  });
});
