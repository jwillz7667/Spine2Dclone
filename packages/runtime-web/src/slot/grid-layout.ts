import type { GridConfig } from '@marionette/format/slot-types';

// The pure grid-to-pixel layout for the slot scene (phase-4 WP-4.11 / PP-C4). Given the authored
// GridConfig (cell size + gap + dims), it maps a (row, col) cell to its CENTER and rectangle in
// grid-local pixel space (row 0 top, col 0 left, y grows downward, matching the screen convention the
// host camera maps). PixiJS-free and deterministic: the SlotSceneView places symbol containers and win
// overlays through these functions, and a vfxBurst anchored to a cell resolves to the same cell center,
// so the particle layer and the grid agree. The GL adapter owns only the mounting; this owns the math.

export interface GridMetrics {
  readonly cols: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cellGap: number;
}

export interface CellRect {
  // The cell center in grid-local pixels (a symbol container's origin sits here).
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

export function gridMetrics(grid: GridConfig): GridMetrics {
  return {
    cols: grid.cols,
    rows: grid.rows,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    cellGap: grid.cellGap,
  };
}

// The horizontal / vertical stride between adjacent cell centers (cell size plus the gap).
function colStride(m: GridMetrics): number {
  return m.cellWidth + m.cellGap;
}
function rowStride(m: GridMetrics): number {
  return m.cellHeight + m.cellGap;
}

// The center of cell (row, col) in grid-local pixels. The first cell's center is half a cell in from the
// top-left origin, and each subsequent cell is one stride further.
export function cellCenter(m: GridMetrics, row: number, col: number): { x: number; y: number } {
  return {
    x: col * colStride(m) + m.cellWidth / 2,
    y: row * rowStride(m) + m.cellHeight / 2,
  };
}

// The full rectangle of cell (row, col): its center plus the authored cell size.
export function cellRect(m: GridMetrics, row: number, col: number): CellRect {
  const { x, y } = cellCenter(m, row, col);
  return { cx: x, cy: y, width: m.cellWidth, height: m.cellHeight };
}

// The total pixel size of the grid (cells plus the interior gaps; no outer margin).
export function gridSize(m: GridMetrics): { width: number; height: number } {
  const width = m.cols > 0 ? m.cols * m.cellWidth + (m.cols - 1) * m.cellGap : 0;
  const height = m.rows > 0 ? m.rows * m.cellHeight + (m.rows - 1) * m.cellGap : 0;
  return { width, height };
}
