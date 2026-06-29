import { symbolId } from '@marionette/format/slot';
import type {
  FeatureFlowGraph,
  GridConfig,
  SceneRefEntry,
  SceneRefs,
  SymbolAnimSet,
  SymbolId,
  TumbleChoreography,
  WinSequenceConfig,
} from '@marionette/format/slot-types';

// The in-model slot-scene aggregate (phase-4 WP-4.5 / WP-4.6). It mirrors the format `SlotScene` members
// (grid, symbols, winSequencer, featureFlows, tumble) PLUS `SceneRefs`, all held BY VALUE. Unlike the
// skeletal model, the slot scene is value/name-keyed, not id-branded: the grid is a single value, `symbols`
// is keyed by SymbolId (the authored symbol vocabulary), and `refs.skeletons` / `refs.vfxPresets` are keyed
// by ref name (the format key). This matches how the rest of the model handles slot: the format references
// artifacts by name + hash, never by a minted internal id, so introducing an id brand here would be
// gratuitous and would not survive a save/load round-trip. The aggregate is ALWAYS present (a default 5x3
// reelStrip scene): a project that has not authored a scene still carries the default, so a SetGridConfig
// or MapSymbolAnimSet command never has to create the container first (WP-4.5 decision: always-present
// default). LAW 1 holds structurally: there is no symbol-placement and no symbol-source field anywhere in
// this shape (the board is RNG-driven by the engine at runtime, never authored here).
export interface SlotSceneState {
  readonly grid: GridConfig;
  readonly symbols: Readonly<Record<SymbolId, SymbolAnimSet>>;
  readonly winSequencer: WinSequenceConfig;
  readonly featureFlows: FeatureFlowGraph;
  readonly tumble: TumbleChoreography;
  readonly refs: SceneRefs;
}

// The placeholder trigger symbol the default grid's anticipation vocabulary references. AnticipationConfig
// requires a non-empty triggerSymbols list (format-contract section 15.4), so the smallest-valid default
// names one placeholder id; a real scene replaces the whole grid (incl. anticipation) via SetGridConfig.
export const DEFAULT_TRIGGER_SYMBOL: SymbolId = symbolId('scatter');

// The smallest-valid default GridConfig (format-contract section 15.3/15.4): a 5x3 reelStrip with unit
// cells, no gap, no stagger, column-down gravity, and a one-symbol anticipation vocabulary at threshold 1
// over a single anticipating column. reelStrip rows must be in [2, 6] (3 is valid); cols are unconstrained
// for reelStrip beyond the structural [1, 12]. This is the scene a fresh document starts with.
export function defaultGridConfig(): GridConfig {
  return {
    topology: 'reelStrip',
    cols: 5,
    rows: 3,
    cellWidth: 1,
    cellHeight: 1,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: {
      triggerSymbols: [DEFAULT_TRIGGER_SYMBOL],
      thresholdCount: 1,
      maxAnticipatingCols: 1,
    },
  };
}

// The minimal-but-valid default WinSequenceConfig (format win-sequence-config schema): no named sequences
// and all-zero tier thresholds. WP-4.8 grows the sequencer; WP-4.5/4.6 only need a valid container.
export function defaultWinSequenceConfig(): WinSequenceConfig {
  return {
    sequences: {},
    thresholds: { big: 0, mega: 0, epic: 0 },
  };
}

// The minimal-but-valid default FeatureFlowGraph (format feature-flow-graph schema): a single `base` node
// with no transitions, entered at 'base'. WP-4.9 grows the state machine.
export function defaultFeatureFlowGraph(): FeatureFlowGraph {
  return {
    states: { base: {} },
    transitions: [],
    entry: 'base',
  };
}

// The minimal-but-valid default TumbleChoreography (format tumble-choreography schema): all timings zero
// and linear easing/rollup. WP-4.10 grows the cascade sequencer; for a non-cascade game these defaults are
// never exercised.
export function defaultTumbleChoreography(): TumbleChoreography {
  return {
    explodeMs: 0,
    dropMs: 0,
    dropEasing: 'linear',
    refillStaggerMs: 0,
    settleMs: 0,
    stepGapMs: 0,
    rollupCurve: 'linear',
  };
}

// Empty SceneRefs (no referenced skeletons or VFX presets). MapSymbolAnimSet adds a skeletons entry when a
// mapping introduces a new skeletonRef and prunes it when the last symbol referencing it is removed.
export function emptySceneRefs(): SceneRefs {
  return { skeletons: [], vfxPresets: [] };
}

// A fresh, always-present default slot scene: a default 5x3 reelStrip grid, no symbols, minimal-valid
// sequencer / feature flows / tumble, and empty refs. newDocState seeds every document with this so the
// slot commands always have a container to mutate (WP-4.5 always-present-default decision).
export function defaultSlotSceneState(): SlotSceneState {
  return {
    grid: defaultGridConfig(),
    symbols: {},
    winSequencer: defaultWinSequenceConfig(),
    featureFlows: defaultFeatureFlowGraph(),
    tumble: defaultTumbleChoreography(),
    refs: emptySceneRefs(),
  };
}

// Deep-copy a GridConfig (incl. its nested anticipation and the triggerSymbols array) so a memento or a
// handed-out value never aliases the live scene. GridConfig is otherwise scalar.
export function cloneGridConfig(grid: GridConfig): GridConfig {
  return {
    topology: grid.topology,
    cols: grid.cols,
    rows: grid.rows,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    cellGap: grid.cellGap,
    reelStopStaggerMs: grid.reelStopStaggerMs,
    gravity: grid.gravity,
    anticipation: {
      triggerSymbols: grid.anticipation.triggerSymbols.slice(),
      thresholdCount: grid.anticipation.thresholdCount,
      maxAnticipatingCols: grid.anticipation.maxAnticipatingCols,
    },
  };
}

// Deep-copy a SymbolAnimSet, omitting `anticipation` when absent (exactOptionalPropertyTypes), so a memento
// never aliases the live entry and an absent optional stays absent (a round-trip deep-equal stays exact).
export function cloneSymbolAnimSet(set: SymbolAnimSet): SymbolAnimSet {
  return {
    skeletonRef: set.skeletonRef,
    idle: set.idle,
    land: set.land,
    win: set.win,
    ...(set.anticipation !== undefined ? { anticipation: set.anticipation } : {}),
  };
}

// Deep-copy a SceneRefEntry (name + hash, both scalar).
function cloneSceneRefEntry(entry: SceneRefEntry): SceneRefEntry {
  return { name: entry.name, hash: entry.hash };
}

// Deep-copy SceneRefs (fresh arrays of fresh entries) so a memento never aliases the live refs.
export function cloneSceneRefs(refs: SceneRefs): SceneRefs {
  return {
    skeletons: refs.skeletons.map(cloneSceneRefEntry),
    vfxPresets: refs.vfxPresets.map(cloneSceneRefEntry),
  };
}

// Deep-copy the whole slot-scene aggregate. Used by the model's load->mutable copy and the discrete
// copy-on-write clone so an in-place edit to one copy never touches another.
export function cloneSlotSceneState(scene: SlotSceneState): SlotSceneState {
  const symbols: Record<SymbolId, SymbolAnimSet> = {};
  for (const [id, set] of Object.entries(scene.symbols)) {
    symbols[symbolId(id)] = cloneSymbolAnimSet(set);
  }
  return {
    grid: cloneGridConfig(scene.grid),
    symbols,
    winSequencer: scene.winSequencer,
    featureFlows: scene.featureFlows,
    tumble: scene.tumble,
    refs: cloneSceneRefs(scene.refs),
  };
}
