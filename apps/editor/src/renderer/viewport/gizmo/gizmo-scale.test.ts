import { describe, expect, it } from 'vitest';
import {
  SCALE_AXIS_DIST,
  SCALE_CORNER,
  scaleFromDrag,
  scaleHandleAtLocal,
  type ScaleDragInput,
} from './gizmo-scale';

describe('scaleHandleAtLocal', () => {
  it('hits each handle at its local-frame position', () => {
    expect(scaleHandleAtLocal(SCALE_AXIS_DIST, 0)).toBe('scale-x');
    expect(scaleHandleAtLocal(0, SCALE_AXIS_DIST)).toBe('scale-y');
    expect(scaleHandleAtLocal(SCALE_CORNER, SCALE_CORNER)).toBe('scale-uniform');
  });

  it('misses empty space between and beyond the handles', () => {
    expect(scaleHandleAtLocal(0, 0)).toBeNull(); // origin (the move-free handle owns it)
    expect(scaleHandleAtLocal(SCALE_AXIS_DIST, 30)).toBeNull(); // off the x box in y
    expect(scaleHandleAtLocal(120, 0)).toBeNull(); // beyond the ring
  });

  it('does not claim the move-axis shaft interior (the box sits past the arrow tip)', () => {
    // The move shaft runs 0..66; the scale-x box is centered at 72, so a shaft-interior point is not it.
    expect(scaleHandleAtLocal(50, 0)).toBeNull();
    expect(scaleHandleAtLocal(SCALE_AXIS_DIST - 20, 0)).toBeNull();
  });
});

const BASE: Omit<ScaleDragInput, 'handle'> = {
  startScaleX: 2,
  startScaleY: 0.5,
  grabProjX: 40,
  grabProjY: 40,
  grabDist: 56,
  projX: 40,
  projY: 40,
  dist: 56,
};

describe('scaleFromDrag', () => {
  it('holds the start scale when the cursor has not moved (factor 1, no jump on grab)', () => {
    expect(scaleFromDrag({ ...BASE, handle: 'scale-x' })).toEqual({ scaleX: 2, scaleY: 0.5 });
    expect(scaleFromDrag({ ...BASE, handle: 'scale-uniform' })).toEqual({ scaleX: 2, scaleY: 0.5 });
  });

  it('scales one axis by the projection ratio and leaves the other at its start', () => {
    const out = scaleFromDrag({ ...BASE, handle: 'scale-x', projX: 60 }); // 60/40 = 1.5
    expect(out.scaleX).toBeCloseTo(3, 12);
    expect(out.scaleY).toBe(0.5);
  });

  it('scales both axes uniformly by the radial ratio', () => {
    const out = scaleFromDrag({ ...BASE, handle: 'scale-uniform', dist: 84 }); // 84/56 = 1.5
    expect(out.scaleX).toBeCloseTo(3, 12);
    expect(out.scaleY).toBeCloseTo(0.75, 12);
  });

  it('is invariant to parent scale (the ratio cancels a uniformly scaled projection)', () => {
    // A parent scale of 3x scales both grab and now projections equally; the resulting factor is unchanged.
    const plain = scaleFromDrag({ ...BASE, handle: 'scale-x', grabProjX: 40, projX: 60 });
    const scaled = scaleFromDrag({ ...BASE, handle: 'scale-x', grabProjX: 120, projX: 180 });
    expect(scaled.scaleX).toBeCloseTo(plain.scaleX, 12);
  });

  it('flips sign (mirror) when dragged through the origin', () => {
    const out = scaleFromDrag({ ...BASE, handle: 'scale-x', projX: -40 }); // -40/40 = -1
    expect(out.scaleX).toBeCloseTo(-2, 12);
  });

  it('holds the start scale on a degenerate near-zero grab projection (no divide by zero)', () => {
    const out = scaleFromDrag({ ...BASE, handle: 'scale-x', grabProjX: 0, projX: 50 });
    expect(out.scaleX).toBe(2);
  });
});
