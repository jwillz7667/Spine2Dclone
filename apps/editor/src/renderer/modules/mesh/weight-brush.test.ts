import { describe, expect, it } from 'vitest';
import {
  brushDab,
  brushFalloff,
  heatColor,
  neighborAverageWeights,
  type BrushVertex,
} from './weight-brush';

// A row of 5 vertices along the x axis at x = 0, 10, 20, 30, 40 (y = 0).
const ROW: BrushVertex[] = [0, 10, 20, 30, 40].map((x, index) => ({
  index,
  position: { x, y: 0 },
}));

function dabMap(dabs: { vertexIndex: number; deltaWeight: number }[]): Map<number, number> {
  return new Map(dabs.map((d) => [d.vertexIndex, d.deltaWeight]));
}

describe('brushFalloff', () => {
  it('is 1 at the center and 0 at/beyond the rim, monotonically decreasing', () => {
    expect(brushFalloff(0, 10)).toBe(1);
    expect(brushFalloff(10, 10)).toBe(0);
    expect(brushFalloff(15, 10)).toBe(0);
    const near = brushFalloff(2, 10);
    const far = brushFalloff(8, 10);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThan(1);
    expect(far).toBeGreaterThan(0);
  });

  it('collapses to a point at the center for a non-positive radius', () => {
    expect(brushFalloff(0, 0)).toBe(1);
    expect(brushFalloff(0.1, 0)).toBe(0);
  });
});

describe('brushDab', () => {
  it('add raises the active weight on covered vertices and leaves out-of-radius vertices untouched', () => {
    // Brush at x = 0, radius 15: covers vertices 0 (d=0) and 1 (d=10); vertices 2,3,4 are outside.
    const dabs = brushDab({
      vertices: ROW,
      center: { x: 0, y: 0 },
      radius: 15,
      strength: 0.5,
      mode: 'add',
      currentWeights: new Map(),
    });
    const map = dabMap(dabs);
    expect(map.has(0)).toBe(true);
    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(false); // out of radius: untouched
    expect(map.has(3)).toBe(false);
    expect(map.has(4)).toBe(false);
    // All deltas are positive (raising).
    for (const [, delta] of map) expect(delta).toBeGreaterThan(0);
    // Falloff: the center vertex gets a larger delta than the edge vertex.
    expect(map.get(0)!).toBeGreaterThan(map.get(1)!);
  });

  it('add clamps so current + delta never exceeds 1', () => {
    const dabs = brushDab({
      vertices: [ROW[0]!],
      center: { x: 0, y: 0 },
      radius: 10,
      strength: 1,
      mode: 'add',
      currentWeights: new Map([[0, 0.8]]),
    });
    // Center vertex, full strength: raw delta 1 clamped to 1 - 0.8 = 0.2 (within float epsilon).
    expect(dabs).toHaveLength(1);
    expect(dabs[0]!.vertexIndex).toBe(0);
    expect(dabs[0]!.deltaWeight).toBeCloseTo(0.2, 10);
  });

  it('subtract reports a positive magnitude clamped to the current weight (command negates it)', () => {
    const dabs = brushDab({
      vertices: [ROW[0]!, ROW[1]!],
      center: { x: 0, y: 0 },
      radius: 15,
      strength: 1,
      mode: 'subtract',
      currentWeights: new Map([
        [0, 0.3],
        [1, 0.9],
      ]),
    });
    const map = dabMap(dabs);
    // Vertex 0 (center, current 0.3, raw 1) -> magnitude clamped to 0.3.
    expect(map.get(0)).toBeCloseTo(0.3, 6);
    // Vertex 1 (current 0.9, raw < 0.9) -> the raw falloff magnitude, below 0.9.
    expect(map.get(1)!).toBeGreaterThan(0);
    expect(map.get(1)!).toBeLessThan(0.9);
  });

  it('subtract omits a vertex whose current active weight is already zero', () => {
    const dabs = brushDab({
      vertices: [ROW[0]!],
      center: { x: 0, y: 0 },
      radius: 10,
      strength: 1,
      mode: 'subtract',
      currentWeights: new Map([[0, 0]]),
    });
    expect(dabs).toEqual([]);
  });

  it('smooth moves covered vertices toward the neighbor average, reducing local variance', () => {
    // A 3-vertex run with a spike at the middle: weights 0, 1, 0. Smoothing the middle toward its
    // neighbors' average (0) lowers it; smoothing the ends toward the middle (1) raises them, so the
    // variance of the covered set drops.
    const verts: BrushVertex[] = [
      { index: 0, position: { x: 0, y: 0 } },
      { index: 1, position: { x: 10, y: 0 } },
      { index: 2, position: { x: 20, y: 0 } },
    ];
    const current = new Map([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
    const adjacency = new Map<number, readonly number[]>([
      [0, [1]],
      [1, [0, 2]],
      [2, [1]],
    ]);
    const targets = neighborAverageWeights(current, adjacency);
    expect(targets.get(1)).toBe(0); // middle's neighbors average to 0
    expect(targets.get(0)).toBe(1); // ends' single neighbor is the spike

    const dabs = brushDab({
      vertices: verts,
      center: { x: 10, y: 0 }, // centered on the spike, radius covers all three
      radius: 25,
      strength: 1,
      mode: 'smooth',
      currentWeights: current,
      smoothTargets: targets,
    });
    const map = dabMap(dabs);
    // The middle moves down (negative delta), the ends move up (positive delta): variance reduced.
    expect(map.get(1)!).toBeLessThan(0);
    expect(map.get(0)!).toBeGreaterThan(0);
    expect(map.get(2)!).toBeGreaterThan(0);

    // Applying the deltas brings every weight closer to the mean (0.333...) than before.
    const variance = (ws: number[]): number => {
      const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
      return ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length;
    };
    const before = [current.get(0)!, current.get(1)!, current.get(2)!];
    const after = [
      current.get(0)! + (map.get(0) ?? 0),
      current.get(1)! + (map.get(1) ?? 0),
      current.get(2)! + (map.get(2) ?? 0),
    ];
    expect(variance(after)).toBeLessThan(variance(before));
  });
});

describe('heatColor', () => {
  it('maps 0 to cold blue and 1 to hot red', () => {
    expect(heatColor(0)).toEqual({ r: 0, g: 0, b: 1 });
    expect(heatColor(1)).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('clamps out-of-range weights to the ramp ends', () => {
    expect(heatColor(-1)).toEqual({ r: 0, g: 0, b: 1 });
    expect(heatColor(2)).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('passes through green in the middle of the ramp', () => {
    expect(heatColor(0.5)).toEqual({ r: 0, g: 1, b: 0 });
  });
});
