import { describe, expect, it } from 'vitest';
import { defaultSlotSceneState, exportSlotSceneDocument } from '@marionette/document-core';
import type { SlotScene } from '@marionette/format/slot-types';
import {
  DEFAULT_SLOT_PREVIEW_SCENARIO,
  SLOT_PREVIEW_SCENARIOS,
  nextScenario,
  prevScenario,
  resolveSlotPlayhead,
  scenarioGridConfig,
  scenarioGridSize,
  scenarioScene,
  scenarioTimeline,
  slotScenarioLabel,
  toScenarioId,
} from './slot-preview-model';

function defaultScene(): SlotScene {
  return exportSlotSceneDocument(defaultSlotSceneState(), 'preview-test').scene;
}

describe('slot preview model', () => {
  it('exposes every committed scenario with a label and a first default', () => {
    expect(SLOT_PREVIEW_SCENARIOS.length).toBeGreaterThan(0);
    expect(DEFAULT_SLOT_PREVIEW_SCENARIO).toBe(SLOT_PREVIEW_SCENARIOS[0]);
    for (const id of SLOT_PREVIEW_SCENARIOS) {
      expect(slotScenarioLabel(id).length).toBeGreaterThan(0);
    }
  });

  it('next and previous wrap and are inverses', () => {
    for (const id of SLOT_PREVIEW_SCENARIOS) {
      expect(prevScenario(nextScenario(id))).toBe(id);
    }
    const last = SLOT_PREVIEW_SCENARIOS[SLOT_PREVIEW_SCENARIOS.length - 1]!;
    expect(nextScenario(last)).toBe(SLOT_PREVIEW_SCENARIOS[0]);
  });

  it('toScenarioId falls back to the default for an unknown value', () => {
    expect(toScenarioId(SLOT_PREVIEW_SCENARIOS[1]!)).toBe(SLOT_PREVIEW_SCENARIOS[1]);
    expect(toScenarioId('nonsense')).toBe(DEFAULT_SLOT_PREVIEW_SCENARIO);
  });

  it('resizes the authored grid to the scenario board, preserving cell geometry', () => {
    const scene = defaultScene();
    const id = 'freespin-trigger';
    const size = scenarioGridSize(id);

    const resized = scenarioGridConfig(scene.grid, id);

    expect(resized.rows).toBe(size.rows);
    expect(resized.cols).toBe(size.cols);
    expect(resized.cellWidth).toBe(scene.grid.cellWidth);
    expect(resized.cellHeight).toBe(scene.grid.cellHeight);
    expect(resized.topology).toBe(scene.grid.topology);
  });

  it('sequences a committed scenario into a timeline whose cells stay in range', () => {
    const scene = defaultScene();

    for (const id of SLOT_PREVIEW_SCENARIOS) {
      const size = scenarioGridSize(id);
      const timeline = scenarioTimeline(scene, id);

      expect(timeline.durationMs).toBeGreaterThanOrEqual(0);
      // Every board directive references a cell inside the scenario board (the grid resize keeps the
      // sequencer and the eventual SlotSceneView in agreement, so no directive addresses a phantom cell).
      for (const directive of timeline.directives) {
        const cells = boardCells(directive);
        for (const cell of cells) {
          expect(cell.row).toBeGreaterThanOrEqual(0);
          expect(cell.row).toBeLessThan(size.rows);
          expect(cell.col).toBeGreaterThanOrEqual(0);
          expect(cell.col).toBeLessThan(size.cols);
        }
      }
    }
  });

  it('scenarioScene carries the resized grid through to the sequenced scene', () => {
    const scene = defaultScene();
    const resized = scenarioScene(scene, 'mega-escalation');

    expect(resized.grid.rows).toBe(scenarioGridSize('mega-escalation').rows);
    expect(resized.symbols).toBe(scene.symbols);
  });

  it('resolves the looping playhead: play through, hold the tail, then restart', () => {
    // Mid-playback: render the elapsed time.
    expect(resolveSlotPlayhead(500, 2000, 800)).toEqual({ timeMs: 500, shouldRestart: false });
    // Past the end but within the tail hold: pinned to the final frame, not yet restarting.
    expect(resolveSlotPlayhead(2400, 2000, 800)).toEqual({ timeMs: 2000, shouldRestart: false });
    // Past the tail hold: signal a restart.
    expect(resolveSlotPlayhead(2900, 2000, 800)).toEqual({ timeMs: 2000, shouldRestart: true });
    // A zero-length timeline holds at 0 and never asks to restart.
    expect(resolveSlotPlayhead(1000, 0, 800)).toEqual({ timeMs: 0, shouldRestart: false });
  });
});

// The board-cell coordinates a directive addresses (for the in-range assertion). Non-board directives
// (counter rollup, vfx, escalation, flow) carry no cell and contribute none.
function boardCells(
  directive: ReturnType<typeof scenarioTimeline>['directives'][number],
): readonly { row: number; col: number }[] {
  switch (directive.kind) {
    case 'symbolLand':
    case 'symbolAnimate':
      return [{ row: directive.row, col: directive.col }];
    case 'cascadeExplode':
      return directive.cells;
    case 'cascadeDrop':
      return directive.moves.flatMap((move) => [move.from, move.to]);
    default:
      return [];
  }
}
