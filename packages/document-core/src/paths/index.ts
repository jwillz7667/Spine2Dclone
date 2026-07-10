// Public barrel for the pure path-geometry helpers (PP-D11). The path commands import from here to
// recompute the arc-length table on every control-point edit; the unit tests import the same surface. No
// I/O, no solve, no document access.
export {
  cubicBezierLength,
  pathCurveCount,
  computePathLengths,
  computePathLengthsFromFlat,
  pointsFromFlat,
  flatFromPoints,
} from './path-geometry';
export type { Vec2 } from './path-geometry';
