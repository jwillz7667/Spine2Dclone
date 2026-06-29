import { describe, expect, it } from 'vitest';
import {
  buildRibbonStrip,
  makeRibbonInstance,
  prepareRibbon,
  recordRibbonPoint,
} from '../src/effects/ribbon-solve';
import { ribbonTrailLayer } from './effects-fixtures';

// WP-3.3: the ribbon-trail solve (phase-3-vfx-particles.md section 8.6). The ribbon records anchor
// points into a ring (one point per frame when moved >= segmentSpacing) and builds a triangle strip
// (two vertices per point, offset perpendicular by 0.5 * width). Deterministic given the anchor path.

describe('ribbon: point recording', () => {
  it('records a new point only after the anchor moves >= segmentSpacing', () => {
    const inst = makeRibbonInstance(prepareRibbon(ribbonTrailLayer({ segmentSpacing: 10 })));
    recordRibbonPoint(inst, 0, 0); // first point always recorded
    expect(inst.ring.count).toBe(1);
    recordRibbonPoint(inst, 5, 0); // moved 5 < 10 -> not recorded
    expect(inst.ring.count).toBe(1);
    recordRibbonPoint(inst, 10, 0); // moved 10 >= 10 -> recorded
    expect(inst.ring.count).toBe(2);
    recordRibbonPoint(inst, 12, 0); // moved 2 from last -> not recorded
    expect(inst.ring.count).toBe(2);
  });

  it('never exceeds maxSegments points (hard cap, drops the oldest)', () => {
    const inst = makeRibbonInstance(
      prepareRibbon(ribbonTrailLayer({ maxSegments: 4, segmentSpacing: 1 })),
    );
    for (let i = 0; i < 20; i += 1) recordRibbonPoint(inst, i * 2, 0); // each step moves 2 >= 1
    expect(inst.ring.count).toBe(4);
  });
});

describe('ribbon: strip geometry', () => {
  it('a moving anchor produces a vertex strip of the expected length (2 vertices per point)', () => {
    const inst = makeRibbonInstance(
      prepareRibbon(
        ribbonTrailLayer({
          maxSegments: 8,
          segmentSpacing: 1,
          widthOverLength: {
            stops: [
              { t: 0, value: 4, curve: 'linear' },
              { t: 1, value: 0, curve: 'linear' },
            ],
          },
        }),
      ),
    );
    // Move the anchor straight along +x; record 5 points.
    for (let i = 0; i < 5; i += 1) recordRibbonPoint(inst, i * 2, 0);
    buildRibbonStrip(inst);
    expect(inst.vertexCount).toBe(5);
    // For a +x path, the perpendicular is +/- y; the head (k=0) has width ~ widthOverLength(0) = 4, so
    // the two head vertices sit at y = +/- 2 around the head point.
    const headLeftY = inst.vy[0]!;
    const headRightY = inst.vy[1]!;
    expect(Math.abs(headLeftY - headRightY)).toBeCloseTo(4, 6); // total width 4 at the head
  });

  it('the head taper follows widthOverLength: tail (k near max) is narrower than the head', () => {
    const inst = makeRibbonInstance(
      prepareRibbon(
        ribbonTrailLayer({
          maxSegments: 8,
          segmentSpacing: 1,
          widthOverLength: {
            stops: [
              { t: 0, value: 6, curve: 'linear' },
              { t: 1, value: 0, curve: 'linear' },
            ],
          },
        }),
      ),
    );
    for (let i = 0; i < 6; i += 1) recordRibbonPoint(inst, i * 2, 0);
    buildRibbonStrip(inst);
    const headWidth = Math.abs(inst.vy[0]! - inst.vy[1]!); // k=0
    const tailWidth = Math.abs(inst.vy[8]! - inst.vy[9]!); // k=4 (10th/11th vertices)
    expect(headWidth).toBeGreaterThan(tailWidth);
  });
});

describe('ribbon: determinism', () => {
  it('is a pure function of the recorded anchor path', () => {
    const path: [number, number][] = [
      [0, 0],
      [3, 1],
      [6, 0],
      [9, 2],
      [12, 0],
    ];
    const run = () => {
      const inst = makeRibbonInstance(
        prepareRibbon(ribbonTrailLayer({ maxSegments: 8, segmentSpacing: 1 })),
      );
      for (const [x, y] of path) recordRibbonPoint(inst, x, y);
      buildRibbonStrip(inst);
      return { count: inst.vertexCount, vx: Array.from(inst.vx), vy: Array.from(inst.vy) };
    };
    expect(run()).toStrictEqual(run());
  });
});
