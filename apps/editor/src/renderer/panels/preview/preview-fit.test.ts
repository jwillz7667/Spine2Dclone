import { describe, expect, it } from 'vitest';
import { fitBounds, fitSize } from './preview-fit';

describe('preview fit', () => {
  it('centers content and scales it to fit within padding', () => {
    // 100x100 content into a 300x300 viewport with 10px padding: avail 280, scale 2.8, centered.
    const fit = fitSize(100, 100, 300, 300, 10);

    expect(fit.scale).toBeCloseTo(2.8, 5);
    // Content center (50,50) maps to the viewport center (150,150): 50*2.8 + offset = 150.
    expect(50 * fit.scale + fit.offsetX).toBeCloseTo(150, 5);
    expect(50 * fit.scale + fit.offsetY).toBeCloseTo(150, 5);
  });

  it('picks the limiting axis for non-square content', () => {
    // 200 wide x 50 tall into 400x400: width limits (400/200 = 2) over height (400/50 = 8).
    const fit = fitSize(200, 50, 400, 400);

    expect(fit.scale).toBeCloseTo(2, 5);
  });

  it('caps the scale so tiny content is not blown up to fill the panel', () => {
    const fit = fitSize(1, 1, 400, 400);

    expect(fit.scale).toBeLessThanOrEqual(4);
    // A single point still centers in the viewport.
    expect(0.5 * fit.scale + fit.offsetX).toBeCloseTo(200, 5);
  });

  it('falls back to scale 1 centered for a degenerate box', () => {
    const fit = fitBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 200, 200);

    expect(fit.scale).toBe(1);
    // Zero-size box centered on its own center (5,5) -> viewport center 100.
    expect(5 * fit.scale + fit.offsetX).toBeCloseTo(100, 5);
  });

  it('falls back to scale 1 for a non-positive viewport (unmeasured canvas)', () => {
    const fit = fitSize(100, 100, 0, 0);

    expect(fit.scale).toBe(1);
    expect(Number.isFinite(fit.offsetX)).toBe(true);
    expect(Number.isFinite(fit.offsetY)).toBe(true);
  });
});
