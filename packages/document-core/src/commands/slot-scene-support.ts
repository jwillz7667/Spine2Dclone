import type { GridConfig } from '@marionette/format/slot-types';
import { gridConfigSchema, symbolId } from '@marionette/format/slot';
import { SlotEditError } from '../command/errors';

// Shared authoring-time guards and preset constructors for the WP-4.5 (grid) slot-scene command. They
// mirror the format slot-scene validator's GRID_* semantic checks at the command boundary so an invalid
// grid is rejected BEFORE any mutation (no document change, no history entry). The per-field scalar bounds
// (cols/rows in [1, 12], cellWidth/Height > 0, reelStopStaggerMs >= 0, gravity in its enum) are enforced by
// reusing the format gridConfigSchema; the cross-field semantic invariants (topology/dims/gravity
// consistency and the anticipation bounds against cols) are enforced explicitly here, each surfacing its
// own typed SlotEditError reason, exactly the split the format module documents (the schema owns shapes,
// the validator owns semantics).

// Validate a candidate GridConfig before authoring (SetGridConfig). First runs the format schema (so the
// scalar bounds and the closed shape are enforced with one source of truth), then the cross-field semantic
// invariants. Throws a typed SlotEditError on the first violation, BEFORE any mutation.
export function assertValidGridConfig(grid: GridConfig): void {
  // The schema is the single source for scalar bounds + closed shape; a shape/bound fault throws here. We
  // do not reshape the parsed result (the caller already holds a GridConfig); we only use it as a gate.
  const parsed = gridConfigSchema.safeParse(grid);
  if (!parsed.success) {
    throw new SlotEditError('emptyName', parsed.error.issues[0]?.message ?? 'invalid grid shape');
  }

  if (grid.topology === 'cluster') {
    if (grid.cols !== grid.rows) {
      throw new SlotEditError('clusterNotSquare', `cols ${grid.cols} !== rows ${grid.rows}`);
    }
    if (grid.gravity !== 'cluster-down') {
      throw new SlotEditError('clusterGravity', `cluster grid must use cluster-down gravity`);
    }
  } else if (grid.topology === 'reelStrip') {
    if (grid.rows < 2 || grid.rows > 6) {
      throw new SlotEditError('reelStripRows', `rows ${grid.rows} must be in [2, 6]`);
    }
  } else if (grid.cols < 5 || grid.cols > 7) {
    throw new SlotEditError('scatterPayCols', `cols ${grid.cols} must be in [5, 7]`);
  }

  const ant = grid.anticipation;
  if (ant.triggerSymbols.length === 0) {
    throw new SlotEditError('anticipationTriggers', 'triggerSymbols must be non-empty');
  }
  if (ant.thresholdCount < 1) {
    throw new SlotEditError('anticipationThreshold', `thresholdCount ${ant.thresholdCount} < 1`);
  }
  if (ant.maxAnticipatingCols < 1 || ant.maxAnticipatingCols > grid.cols) {
    throw new SlotEditError(
      'anticipationCols',
      `maxAnticipatingCols ${ant.maxAnticipatingCols} must be in [1, ${grid.cols}]`,
    );
  }
}

// The default trigger-symbol vocabulary the presets reference (a single placeholder 'scatter' id). A real
// scene replaces the whole anticipation block; the presets just need a valid non-empty vocabulary.
const PRESET_TRIGGER = symbolId('scatter');

// Preset: a 5x3 reelStrip grid (the classic five-reel three-row layout). Unit cells, no gap or stagger,
// column-down gravity, one anticipating column over a one-symbol trigger vocabulary.
export function preset5x3ReelStrip(): GridConfig {
  return {
    topology: 'reelStrip',
    cols: 5,
    rows: 3,
    cellWidth: 1,
    cellHeight: 1,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [PRESET_TRIGGER], thresholdCount: 1, maxAnticipatingCols: 1 },
  };
}

// Preset: a 6x5 scatterPay grid (the Megaways-style six-reel five-row pay-anywhere layout). cols 6 is in
// the scatterPay [5, 7] band; column-down gravity; anticipation may span up to all six columns.
export function preset6x5ScatterPay(): GridConfig {
  return {
    topology: 'scatterPay',
    cols: 6,
    rows: 5,
    cellWidth: 1,
    cellHeight: 1,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [PRESET_TRIGGER], thresholdCount: 1, maxAnticipatingCols: 6 },
  };
}

// Preset: a 7x7 cluster grid (the square cluster-pays layout). cols === rows (square), cluster-down
// gravity, one anticipating column over the placeholder trigger vocabulary.
export function preset7x7Cluster(): GridConfig {
  return {
    topology: 'cluster',
    cols: 7,
    rows: 7,
    cellWidth: 1,
    cellHeight: 1,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'cluster-down',
    anticipation: { triggerSymbols: [PRESET_TRIGGER], thresholdCount: 1, maxAnticipatingCols: 1 },
  };
}
