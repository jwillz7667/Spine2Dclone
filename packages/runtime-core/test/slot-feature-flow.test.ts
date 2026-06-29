import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type {
  SymbolId,
  SlotScene,
  GridConfig,
  FeatureFlowGraph,
} from '@marionette/format/slot-types';
import { MOCK_SCENARIOS } from '@marionette/math-bridge';
import type { SpinResult, FeatureEvent } from '@marionette/math-bridge/types';
import { sequence, compareDirectives } from '../src/slot/sequence';
import type { PresentationDirective } from '../src/slot/timeline';

// WP-4.9 feature + free-spin flow stage (phase-4 section 5.4.1 construction-order STAGE 4, TASK-4.9.3). The
// sequencer walks SpinResult.features in array order and emits flowExit/flowEnter + entered-node cinematic
// directives for each matching transition, multiplierOrb directives for multiplier features, and a freeSpins
// re-entry for retriggers. LAW 1: the walk reads feature TYPE + data FIELD NAMES only, never deciding an
// outcome; the awarded count is engine data carried through, never incremented here.

const S = symbolId;

function board(rows: readonly (readonly string[])[]): SymbolId[][] {
  return rows.map((r) => r.map(S));
}

// A minimal reelStrip grid (the flow stage does not read the grid; landing is asserted elsewhere). The
// dims default to 5x3 but are overridable so a scene can match a mock scenario's board.
function grid(cols = 5, rows = 3): GridConfig {
  return {
    topology: 'reelStrip',
    cols,
    rows,
    cellWidth: 100,
    cellHeight: 100,
    cellGap: 0,
    reelStopStaggerMs: 0,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [S('scatter')], thresholdCount: 99, maxAnticipatingCols: 1 },
  };
}

// A scene carrying a specific feature-flow graph and an inert win sequencer (no win directives) so the flow
// directives are isolated. Grid dims default to 5x3 but can match a mock scenario's board.
function sceneWithFlow(flow: FeatureFlowGraph, cols = 5, rows = 3): SlotScene {
  return {
    grid: grid(cols, rows),
    symbols: {},
    winSequencer: {
      sequences: { base: { steps: [] } },
      thresholds: { big: 1000, mega: 5000, epic: 10000 },
      defaultSequence: 'base',
    },
    featureFlows: flow,
    tumble: {
      explodeMs: 0,
      dropMs: 0,
      dropEasing: 'linear',
      refillStaggerMs: 0,
      settleMs: 0,
      stepGapMs: 0,
      rollupCurve: 'linear',
    },
  };
}

// A non-cascade SpinResult with the supplied features. The board fills the 5x3 grid (the landing loop reads
// initialGrid[row][col] for every grid cell), but its content is irrelevant to the flow-stage assertions.
function spinWithFeatures(spinId: string, features: readonly FeatureEvent[]): SpinResult {
  const b = board([
    ['A', 'A', 'A', 'A', 'A'],
    ['A', 'A', 'A', 'A', 'A'],
    ['A', 'A', 'A', 'A', 'A'],
  ]);
  return {
    spinId,
    bet: 100,
    initialGrid: b.map((r) => r.slice()),
    grid: b.map((r) => r.slice()),
    wins: [],
    totalWin: 0,
    features: [...features],
  };
}

// The free-spin flow graph used across these tests: base -> freeSpinIntro -> freeSpins, with an intro
// cinematic VFX preset and a freeSpins cinematic. The transition matches are keyed off feature TYPE.
function freeSpinGraph(): FeatureFlowGraph {
  return {
    states: {
      base: {},
      freeSpinIntro: { cinematic: { vfxPreset: 'introBurst' } },
      freeSpins: { cinematic: { vfxPreset: 'spinLoop' } },
    },
    transitions: [
      { from: 'base', on: { type: 'freeSpinsAwarded' }, to: 'freeSpinIntro' },
      { from: 'freeSpinIntro', on: { type: 'freeSpinsStarted' }, to: 'freeSpins' },
    ],
    entry: 'base',
  };
}

// Pull only the flow / orb directives (in timeline order) for assertions.
function flowKinds(tl: { directives: readonly PresentationDirective[] }): PresentationDirective[] {
  return tl.directives.filter(
    (d) => d.kind === 'flowEnter' || d.kind === 'flowExit' || d.kind === 'multiplierOrb',
  );
}

describe('feature flow: base -> freeSpinIntro -> freeSpins (TASK-4.9.3)', () => {
  it('drives base -> freeSpinIntro -> freeSpins and emits the intro cinematic', () => {
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: { count: 10 } },
      { type: 'freeSpinsStarted', data: {} },
    ];
    const tl = sequence(spinWithFeatures('fs', features), sceneWithFlow(freeSpinGraph()));

    const enters = tl.directives.filter((d) => d.kind === 'flowEnter');
    const exits = tl.directives.filter((d) => d.kind === 'flowExit');
    expect(enters.map((d) => (d.kind === 'flowEnter' ? d.state : ''))).toEqual([
      'freeSpinIntro',
      'freeSpins',
    ]);
    expect(exits.map((d) => (d.kind === 'flowExit' ? d.state : ''))).toEqual([
      'base',
      'freeSpinIntro',
    ]);

    // The entered intro node's cinematic emits a vfxBurst for its preset at the screen origin.
    const intro = tl.directives.find((d) => d.kind === 'vfxBurst' && d.preset === 'introBurst');
    expect(intro).toBeDefined();
    if (intro?.kind === 'vfxBurst') expect(intro.anchor).toEqual({ kind: 'screen', x: 0, y: 0 });
  });

  it('the awarded count is carried by engine data; the flow never reads or increments it', () => {
    // The directive set does not encode the count (LAW 1: presentation marks the entry, the count stays in
    // the engine data). We assert the count is present in the engine input and untouched by sequencing.
    const features: FeatureEvent[] = [{ type: 'freeSpinsAwarded', data: { count: 10 } }];
    const result = spinWithFeatures('fs', features);
    const tl = sequence(result, sceneWithFlow(freeSpinGraph()));
    expect(result.features[0]!.data['count']).toBe(10);
    expect(tl.directives.some((d) => d.kind === 'flowEnter' && d.state === 'freeSpinIntro')).toBe(
      true,
    );
  });

  it('flow directives use the per-feature-index atMs scheme (integer, deterministic)', () => {
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: {} },
      { type: 'freeSpinsStarted', data: {} },
    ];
    const tl = sequence(spinWithFeatures('fs', features), sceneWithFlow(freeSpinGraph()));
    const intro = tl.directives.find((d) => d.kind === 'flowEnter' && d.state === 'freeSpinIntro');
    const spins = tl.directives.find((d) => d.kind === 'flowEnter' && d.state === 'freeSpins');
    expect(intro?.atMs).toBe(0); // feature index 0
    expect(spins?.atMs).toBe(1000); // feature index 1 * 1000
    for (const d of tl.directives) expect(Number.isInteger(d.atMs)).toBe(true);
  });

  it('no transition matches when the feature type differs (current state unchanged)', () => {
    const features: FeatureEvent[] = [{ type: 'somethingElse', data: {} }];
    const tl = sequence(spinWithFeatures('fs', features), sceneWithFlow(freeSpinGraph()));
    expect(flowKinds(tl)).toHaveLength(0);
  });
});

describe('feature flow: dataEquals predicate (LAW 1 field-name matching)', () => {
  it('matches only when data[field] strictly equals the authored constant', () => {
    const flow: FeatureFlowGraph = {
      states: { base: {}, bonus: { cinematic: { vfxPreset: 'bonusBurst' } } },
      transitions: [
        {
          from: 'base',
          on: { type: 'featureLanded', dataEquals: { field: 'tier', equals: 'super' } },
          to: 'bonus',
        },
      ],
      entry: 'base',
    };
    const matching = sequence(
      spinWithFeatures('m', [{ type: 'featureLanded', data: { tier: 'super' } }]),
      sceneWithFlow(flow),
    );
    expect(matching.directives.some((d) => d.kind === 'flowEnter' && d.state === 'bonus')).toBe(
      true,
    );

    const nonMatching = sequence(
      spinWithFeatures('n', [{ type: 'featureLanded', data: { tier: 'mini' } }]),
      sceneWithFlow(flow),
    );
    expect(nonMatching.directives.some((d) => d.kind === 'flowEnter')).toBe(false);
  });
});

describe('feature flow: multiplier orbs (TASK-4.9.3)', () => {
  it('emits a multiplierOrb with valueX from data.valueX for a multiplierApplied feature', () => {
    const features: FeatureEvent[] = [{ type: 'multiplierApplied', data: { valueX: 25 } }];
    const tl = sequence(spinWithFeatures('mx', features), sceneWithFlow(freeSpinGraph()));
    const orb = tl.directives.find((d) => d.kind === 'multiplierOrb');
    expect(orb).toBeDefined();
    if (orb?.kind === 'multiplierOrb') {
      expect(orb.valueX).toBe(25);
      expect(orb.anchor).toEqual({ kind: 'screen', x: 0, y: 0 });
    }
  });

  it('falls back to data.value when valueX is absent', () => {
    const tl = sequence(
      spinWithFeatures('mx', [{ type: 'multiplierApplied', data: { value: 7 } }]),
      sceneWithFlow(freeSpinGraph()),
    );
    const orb = tl.directives.find((d) => d.kind === 'multiplierOrb');
    expect(orb?.kind === 'multiplierOrb' ? orb.valueX : null).toBe(7);
  });

  it('emits no orb when neither valueX nor value is a number (skip, no throw)', () => {
    const tl = sequence(
      spinWithFeatures('mx', [{ type: 'multiplierApplied', data: { label: 'big' } }]),
      sceneWithFlow(freeSpinGraph()),
    );
    expect(tl.directives.some((d) => d.kind === 'multiplierOrb')).toBe(false);
  });

  it('emits one orb per multiplier feature in feature-array order', () => {
    const features: FeatureEvent[] = [
      { type: 'multiplierApplied', data: { valueX: 2 } },
      { type: 'multiplierApplied', data: { valueX: 5 } },
      { type: 'multiplierApplied', data: { valueX: 10 } },
    ];
    const tl = sequence(spinWithFeatures('mx', features), sceneWithFlow(freeSpinGraph()));
    const orbs = tl.directives.filter((d) => d.kind === 'multiplierOrb');
    expect(orbs.map((d) => (d.kind === 'multiplierOrb' ? d.valueX : -1))).toEqual([2, 5, 10]);
    // Each later orb sorts strictly after the prior (per-feature-index atMs scheme).
    expect(orbs.map((d) => d.atMs)).toEqual([0, 1000, 2000]);
  });
});

describe('feature flow: retrigger re-enters freeSpins (TASK-4.9.3)', () => {
  it('re-enters the freeSpins state on a retrigger feature when the graph has one', () => {
    // base -> freeSpinIntro -> freeSpins via the trigger, then a retrigger re-enters freeSpins.
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: { count: 8 } },
      { type: 'freeSpinsStarted', data: {} },
      { type: 'retrigger', data: { count: 5 } },
    ];
    const tl = sequence(spinWithFeatures('rt', features), sceneWithFlow(freeSpinGraph()));
    const enters = tl.directives
      .filter((d) => d.kind === 'flowEnter')
      .map((d) => (d.kind === 'flowEnter' ? d.state : ''));
    expect(enters).toEqual(['freeSpinIntro', 'freeSpins', 'freeSpins']);
    // The awarded count is engine data only; no presentation-side increment.
    expect(result_count(features)).toBe(5);
  });

  it('emits nothing for a retrigger when the graph has no freeSpins state', () => {
    const noFreeSpins: FeatureFlowGraph = {
      states: { base: {} },
      transitions: [],
      entry: 'base',
    };
    const tl = sequence(
      spinWithFeatures('rt', [{ type: 'retrigger', data: { count: 5 } }]),
      sceneWithFlow(noFreeSpins),
    );
    expect(flowKinds(tl)).toHaveLength(0);
  });
});

// The retrigger's awarded count is read from the engine event data only (display intent).
function result_count(features: readonly FeatureEvent[]): number | undefined {
  const rt = features.find((f) => f.type === 'retrigger');
  const c = rt?.data['count'];
  return typeof c === 'number' ? c : undefined;
}

describe('feature flow: referential transparency + comparator totality', () => {
  it('drives the freespin-trigger mock scenario and emits the intro cinematic', () => {
    const result = MOCK_SCENARIOS['freespin-trigger'].result;
    // The freespin-trigger mock is a 6x5 scatterPay board; the scene grid matches its dims (6 cols, 5 rows).
    const scene = sceneWithFlow(freeSpinGraph(), 6, 5);
    const tl = sequence(result, scene);
    // The mock carries one freeSpinsAwarded feature; it drives base -> freeSpinIntro and the intro VFX.
    expect(tl.directives.some((d) => d.kind === 'flowEnter' && d.state === 'freeSpinIntro')).toBe(
      true,
    );
    expect(tl.directives.some((d) => d.kind === 'vfxBurst' && d.preset === 'introBurst')).toBe(
      true,
    );
  });

  it('produces deep-equal timelines across 1000 repeated calls (LAW 1)', () => {
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: { count: 10 } },
      { type: 'freeSpinsStarted', data: {} },
      { type: 'multiplierApplied', data: { valueX: 25 } },
      { type: 'retrigger', data: { count: 5 } },
    ];
    const result = spinWithFeatures('all', features);
    const scene = sceneWithFlow(freeSpinGraph());
    const first = sequence(result, scene);
    for (let i = 0; i < 1000; i += 1) expect(sequence(result, scene)).toEqual(first);
  });

  it('the comparator stays total: unique seq and strict order over the flow directives', () => {
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: {} },
      { type: 'freeSpinsStarted', data: {} },
      { type: 'multiplierApplied', data: { valueX: 3 } },
      { type: 'retrigger', data: {} },
    ];
    const tl = sequence(spinWithFeatures('all', features), sceneWithFlow(freeSpinGraph()));
    const seqs = tl.directives.map((d) => d.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < tl.directives.length; i += 1) {
      expect(compareDirectives(tl.directives[i - 1]!, tl.directives[i]!)).toBeLessThan(0);
    }
  });

  it('a shuffled pre-sort array sorts back to the identical output (non-stable sort safe)', () => {
    const features: FeatureEvent[] = [
      { type: 'freeSpinsAwarded', data: {} },
      { type: 'freeSpinsStarted', data: {} },
      { type: 'multiplierApplied', data: { valueX: 3 } },
    ];
    const tl = sequence(spinWithFeatures('all', features), sceneWithFlow(freeSpinGraph()));
    const sorted = [...tl.directives];
    const shuffled = [...sorted];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = (i * 7 + 3) % (i + 1);
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    shuffled.sort(compareDirectives);
    expect(shuffled).toEqual(sorted);
  });
});
