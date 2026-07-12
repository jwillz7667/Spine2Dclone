import { describe, expect, it } from 'vitest';
import { MIN_CELL_SCREEN_PX, chooseStep, computeGrid } from './grid-lines';

describe('chooseStep', () => {
  it('picks the smallest 1/2/5 decade step at least MIN_CELL_SCREEN_PX on screen', () => {
    // zoom 1: minWorld = 28 -> the 1/2/5 ladder in decade 10 gives 50.
    expect(chooseStep(1)).toEqual({ step: 50, majorEvery: 2 });
    // zoom 0.5: minWorld = 56 -> 100 (mantissa 1, majors every 10th).
    expect(chooseStep(0.5)).toEqual({ step: 100, majorEvery: 10 });
    // zoom 4: minWorld = 7 -> 10.
    expect(chooseStep(4)).toEqual({ step: 10, majorEvery: 10 });
  });

  it('keeps the on-screen cell at or above the minimum at extreme zooms', () => {
    for (const zoom of [0.05, 0.1, 0.37, 1, 2.5, 13, 64]) {
      const { step } = chooseStep(zoom);
      expect(step * zoom).toBeGreaterThanOrEqual(MIN_CELL_SCREEN_PX - 1e-9);
      // Never more than one 1/2/5 rung above the minimum (2.5x covers the widest rung gap 2 -> 5).
      expect(step * zoom).toBeLessThan(MIN_CELL_SCREEN_PX * 2.5 + 1e-9);
    }
  });

  it('majors land on multiples of the next decade', () => {
    for (const zoom of [0.05, 0.4, 1, 8, 64]) {
      const { step, majorEvery } = chooseStep(zoom);
      const major = step * majorEvery;
      const decade = Math.pow(10, Math.ceil(Math.log10(step)));
      expect(major % decade).toBeCloseTo(0, 9);
    }
  });
});

describe('computeGrid', () => {
  // camera x/y are the screen position of the world origin; zoom 1, origin centered in 800x600.
  const camera = { x: 400, y: 300, zoom: 1 } as const;

  it('spans exactly the visible world range and excludes the axes from grid lines', () => {
    const grid = computeGrid(camera, 800, 600);
    for (const line of grid.verticals) {
      expect(Math.abs(line.at)).toBeGreaterThan(0);
      expect(line.at).toBeGreaterThanOrEqual(-400);
      expect(line.at).toBeLessThanOrEqual(400);
      expect(Math.abs(line.at % grid.step)).toBe(0); // abs: -350 % 50 is -0, and Object.is(-0, 0) is false
    }
    expect(grid.showAxisX).toBe(true);
    expect(grid.showAxisY).toBe(true);
  });

  it('hides an axis that is out of view', () => {
    const panned = { x: -2000, y: 300, zoom: 1 } as const; // origin far left of the screen
    const grid = computeGrid(panned, 800, 600);
    expect(grid.showAxisY).toBe(false);
    expect(grid.showAxisX).toBe(true);
  });

  it('marks majors on the majorEvery cadence', () => {
    const grid = computeGrid(camera, 800, 600);
    const { step, majorEvery } = chooseStep(camera.zoom);
    for (const line of grid.verticals) {
      const index = Math.round(line.at / step);
      expect(line.major).toBe(index % majorEvery === 0);
    }
  });

  it('caps line count to the visible span at minimum zoom (no runaway allocation)', () => {
    const grid = computeGrid({ x: 0, y: 0, zoom: 0.05 }, 3840, 2160);
    expect(grid.verticals.length).toBeLessThan(3840 / MIN_CELL_SCREEN_PX + 2);
    expect(grid.horizontals.length).toBeLessThan(2160 / MIN_CELL_SCREEN_PX + 2);
  });
});
