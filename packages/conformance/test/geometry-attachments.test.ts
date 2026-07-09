import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/io';

// PP-B2 (ADR-0012) geometry-attachment conformance coverage. The generic per-rig gate (phase2-rigs.test.ts)
// already proves rig-clipping and rig-hit-point validate and regenerate from runtime-core within tolerance;
// this file adds the OBSERVABILITY assertions that the new solve branches are actually exercised (the
// a2-coverage compensating control for the shared native core): a runtime that ignored these branches would
// produce constant/absent lanes and fail here, so no branch can quietly lose its cross-implementation check.

describe('rig-clipping: clip evaluation is observably exercised', () => {
  const fixture = loadFixture('rig-clipping');

  it('captures a clip state on every sample', () => {
    for (const sample of fixture.samples) {
      expect(sample.clips).toBeDefined();
      expect(sample.clips!.length).toBe(1);
      expect(sample.clips![0]!.worldPolygon.length).toBe(8); // a quad, 4 vertices
    }
  });

  it('the world clip polygon animates (the clip bone moves it)', () => {
    const first = fixture.samples.find((s) => s.time === 0)!.clips![0]!.worldPolygon;
    const last = fixture.samples.find((s) => s.time === 1)!.clips![0]!.worldPolygon;
    const moved = first.some((v, i) => Math.abs(v - last[i]!) > 1e-2);
    expect(moved, 'the clip polygon must move over the clip').toBe(true);
  });

  it('the clipped slot set follows the draw order (it changes when a draw-order key reorders slots)', () => {
    const before = fixture.samples.find((s) => s.time === 0)!.clips![0]!.clippedSlots;
    const after = fixture.samples.find((s) => s.time === 1)!.clips![0]!.clippedSlots;
    // Before the reorder key (t < 0.5): the slots after the clip slot up to the end slot are [under, meshslot].
    expect(before).toEqual(['under', 'meshslot']);
    // After the t=0.5 key moves meshslot ahead of under, only meshslot remains in the clip range.
    expect(after).toEqual(['meshslot']);
  });
});

describe('rig-hit-point: bounding-box hit testing and point resolution are observably exercised', () => {
  const fixture = loadFixture('rig-hit-point');

  it('captures a box (with per-probe hits) and a point on every sample', () => {
    for (const sample of fixture.samples) {
      expect(sample.boxes).toBeDefined();
      expect(sample.boxes!.length).toBe(1);
      expect(sample.boxes![0]!.worldVertices.length).toBe(8);
      expect(sample.boxes![0]!.hits.length).toBe(4);
      expect(sample.points).toBeDefined();
      expect(sample.points!.length).toBe(1);
    }
  });

  it('the box world vertices move with the bone', () => {
    const first = fixture.samples.find((s) => s.time === 0)!.boxes![0]!.worldVertices;
    const last = fixture.samples.find((s) => s.time === 1)!.boxes![0]!.worldVertices;
    expect(first.some((v, i) => Math.abs(v - last[i]!) > 1e-2)).toBe(true);
  });

  it('the hit results toggle across the sweep (the box crosses different probe points)', () => {
    const patterns = fixture.samples.map((s) => s.boxes![0]!.hits.join(','));
    // At least two distinct hit patterns, and at least one probe that is hit at some sample.
    expect(new Set(patterns).size).toBeGreaterThan(1);
    const anyHit = fixture.samples.some((s) => s.boxes![0]!.hits.some((h) => h));
    expect(anyHit).toBe(true);
  });

  it('the point world position and rotation track the bone (both change over the sweep)', () => {
    const first = fixture.samples.find((s) => s.time === 0)!.points![0]!;
    const last = fixture.samples.find((s) => s.time === 1)!.points![0]!;
    expect(Math.abs(first.x - last.x) + Math.abs(first.y - last.y)).toBeGreaterThan(1e-2);
    expect(Math.abs(first.rotation - last.rotation)).toBeGreaterThan(1e-2); // 30 -> 75 degrees
  });
});
