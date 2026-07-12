import { screenToWorld, type Camera } from './camera';

// Pure math for the viewport reference grid (no Pixi, no DOM). Given the camera and the viewport's
// screen size, produce the world-space line positions to draw: an adaptive minor/major grid whose
// on-screen spacing stays readable at any zoom, plus the world axes. The overlay draws exactly what
// this returns, so spacing/major selection is unit-testable without a renderer.

export interface GridLine {
  // World-space coordinate of the line (x for verticals, y for horizontals).
  readonly at: number;
  readonly major: boolean;
}

export interface GridModel {
  // Minor step in world units (already adapted to zoom).
  readonly step: number;
  readonly verticals: readonly GridLine[];
  readonly horizontals: readonly GridLine[];
  // World axes are drawn separately (x axis = the horizontal line y=0, y axis = the vertical x=0);
  // they are present only when inside the visible range.
  readonly showAxisX: boolean;
  readonly showAxisY: boolean;
}

// The smallest on-screen spacing a minor cell may have before the grid steps up to the next
// 1/2/5-decade size. 28px keeps cells countable without turning into noise at low zoom.
export const MIN_CELL_SCREEN_PX = 28;

// Choose the minor step as the smallest 1/2/5 x 10^n (world units) whose screen size is at least
// minPx. The 1/2/5 ladder keeps steps decimal-friendly; majors land on decade multiples: a mantissa-1
// step promotes every 10th line, mantissa-2 every 5th, mantissa-5 every 2nd, so a major line always
// sits on a multiple of 10^(n+1).
export function chooseStep(
  zoom: number,
  minPx: number = MIN_CELL_SCREEN_PX,
): { step: number; majorEvery: number } {
  const minWorld = minPx / zoom;
  const decade = Math.pow(10, Math.floor(Math.log10(minWorld)));
  for (const [mantissa, majorEvery] of [
    [1, 10],
    [2, 5],
    [5, 2],
  ] as const) {
    const step = mantissa * decade;
    if (step >= minWorld) return { step, majorEvery };
  }
  return { step: 10 * decade, majorEvery: 10 };
}

function linesForRange(min: number, max: number, step: number, majorEvery: number): GridLine[] {
  const lines: GridLine[] = [];
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  for (let i = first; i <= last; i++) {
    if (i === 0) continue; // the axis is drawn separately, on top of the grid
    lines.push({ at: i * step, major: i % majorEvery === 0 });
  }
  return lines;
}

export function computeGrid(camera: Camera, screenWidth: number, screenHeight: number): GridModel {
  const { step, majorEvery } = chooseStep(camera.zoom);
  const [minX, minY] = screenToWorld(camera, 0, 0);
  const [maxX, maxY] = screenToWorld(camera, screenWidth, screenHeight);
  return {
    step,
    verticals: linesForRange(minX, maxX, step, majorEvery),
    horizontals: linesForRange(minY, maxY, step, majorEvery),
    showAxisY: minX <= 0 && maxX >= 0,
    showAxisX: minY <= 0 && maxY >= 0,
  };
}
