import { MOCK_SCENARIOS, MOCK_SCENARIO_IDS, type MockScenarioId } from '@marionette/math-bridge';
import { sequence, type PresentationTimeline } from '@marionette/runtime-core';
import type { GridConfig, SlotScene } from '@marionette/format/slot-types';

// The pure, PixiJS-free model behind the slot panel scene preview (PP-D8 deliverable 2). It selects a
// committed MockMathEngine scenario, resolves it to a PresentationTimeline through the SAME runtime-core
// `sequence` the packaged player uses, and computes the looping playhead. LAW 1 is intact: the outcome is
// ALWAYS the committed SpinResult of a mock scenario (MOCK_SCENARIOS), never a symbol or payout invented
// here; this module only chooses which committed scenario to play and folds it through the pure sequencer.
// Being pixi-free, it is unit-tested in the node env against real sequences (the scenario selection, the
// grid resolution, and the loop math), so the GL view stays a thin adapter.

export type SlotPreviewScenarioId = MockScenarioId;
export const SLOT_PREVIEW_SCENARIOS: readonly SlotPreviewScenarioId[] = MOCK_SCENARIO_IDS;
export const DEFAULT_SLOT_PREVIEW_SCENARIO: SlotPreviewScenarioId = MOCK_SCENARIO_IDS[0]!;

const SCENARIO_LABELS: Readonly<Record<SlotPreviewScenarioId, string>> = {
  'base-win': 'Base Win',
  'freespin-trigger': 'Free Spin Trigger',
  'tumble-cascade': 'Tumble Cascade',
  'mega-escalation': 'Mega Escalation',
  retrigger: 'Retrigger',
};

export function slotScenarioLabel(id: SlotPreviewScenarioId): string {
  return SCENARIO_LABELS[id];
}

// The scenario after `id` in the declared order (wraps). Drives the selector's next button.
export function nextScenario(id: SlotPreviewScenarioId): SlotPreviewScenarioId {
  const index = SLOT_PREVIEW_SCENARIOS.indexOf(id);
  return SLOT_PREVIEW_SCENARIOS[(index + 1) % SLOT_PREVIEW_SCENARIOS.length]!;
}

// The scenario before `id` in the declared order (wraps). Drives the selector's previous button.
export function prevScenario(id: SlotPreviewScenarioId): SlotPreviewScenarioId {
  const index = SLOT_PREVIEW_SCENARIOS.indexOf(id);
  const length = SLOT_PREVIEW_SCENARIOS.length;
  return SLOT_PREVIEW_SCENARIOS[(index - 1 + length) % length]!;
}

// Resolve `value` to a scenario id, falling back to the default for an unknown value (a `<select>` guard).
export function toScenarioId(value: string): SlotPreviewScenarioId {
  return SLOT_PREVIEW_SCENARIOS.find((id) => id === value) ?? DEFAULT_SLOT_PREVIEW_SCENARIO;
}

// The scenario's board dimensions (the committed result's grid size). The board IS the scenario's board, so
// the preview resizes the authored grid to it (below) rather than the other way around.
export function scenarioGridSize(id: SlotPreviewScenarioId): {
  readonly rows: number;
  readonly cols: number;
} {
  return MOCK_SCENARIOS[id].gridSize;
}

// The authored grid resized to the scenario's board so the sequencer and the SlotSceneView agree on
// dimensions (a directive can then only reference in-range cells). Only rows/cols change; the authored cell
// size, gap, stagger, and topology are preserved (the choreography is still the authored scene's).
export function scenarioGridConfig(grid: GridConfig, id: SlotPreviewScenarioId): GridConfig {
  const size = scenarioGridSize(id);
  return { ...grid, rows: size.rows, cols: size.cols };
}

// The authored scene with its grid resized to the scenario. Used to construct the SlotSceneView (grid) and
// to sequence the timeline, so both are built from the exact same resized scene.
export function scenarioScene(scene: SlotScene, id: SlotPreviewScenarioId): SlotScene {
  return { ...scene, grid: scenarioGridConfig(scene.grid, id) };
}

// The presentation timeline for a scenario: the committed SpinResult run through the pure sequencer against
// the resized scene. Deterministic (same scenario + scene => deep-equal timeline), no clock, no RNG.
export function scenarioTimeline(
  scene: SlotScene,
  id: SlotPreviewScenarioId,
): PresentationTimeline {
  return sequence(MOCK_SCENARIOS[id].result, scenarioScene(scene, id));
}

// The playhead resolution for the looping preview clock. Given the elapsed time since the last restart and
// the timeline length, it returns the time to render and whether the loop should restart. The playback runs
// 0..duration, then HOLDS the final frame for `tailHoldMs` (so a big win reads before it loops), then signals
// a restart. A zero-length timeline holds at 0 and never asks to restart (nothing to replay).
export interface SlotPlayhead {
  readonly timeMs: number;
  readonly shouldRestart: boolean;
}

export function resolveSlotPlayhead(
  elapsedMs: number,
  durationMs: number,
  tailHoldMs: number,
): SlotPlayhead {
  if (durationMs <= 0) return { timeMs: 0, shouldRestart: false };
  if (elapsedMs >= durationMs + tailHoldMs) return { timeMs: durationMs, shouldRestart: true };
  const timeMs = elapsedMs < durationMs ? elapsedMs : durationMs;
  return { timeMs, shouldRestart: false };
}
