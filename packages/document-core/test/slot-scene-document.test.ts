import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type {
  FeatureFlowGraph,
  GridConfig,
  SceneRefs,
  SymbolAnimSet,
  SymbolId,
  TumbleChoreography,
  WinSequenceConfig,
} from '@marionette/format/slot-types';
import {
  exportSlotSceneDocument,
  loadSlotSceneState,
  SlotSceneDocumentError,
} from '../src/save-load/slot-scene-document';
import { defaultSlotSceneState } from '../src/model/slot-scene';
import type { SlotSceneState } from '../src/model/slot-scene';

// WP-4.12 slice: the SlotSceneDocument save/load round-trip (phase-4 section 5.2/6, format-contract 15).
// The slot scene serializes as its own sibling format with the shared content hash; export then load must
// deep-equal the source state (LAW 3 validate-on-import, fail-loud on a tampered hash or a malformed
// envelope). The referenced-artifact integrity check is the host's concern (format validateSlotScene with
// a resolver); this seam owns the envelope + hash, so the round-trip is pure and resolver-free.

const S = (s: string): SymbolId => symbolId(s);

// A richly authored scene (a 6x5 scatterPay grid, a mapped symbol, a win sequence with a step, a flow with
// a transition, a non-default tumble, and refs), so the round-trip exercises every SlotScene member.
function authoredScene(): SlotSceneState {
  const grid: GridConfig = {
    topology: 'scatterPay',
    cols: 6,
    rows: 5,
    cellWidth: 100,
    cellHeight: 100,
    cellGap: 4,
    reelStopStaggerMs: 120,
    gravity: 'column-down',
    anticipation: { triggerSymbols: [S('scatter')], thresholdCount: 2, maxAnticipatingCols: 2 },
  };
  const heroAnim: SymbolAnimSet = {
    skeletonRef: 'hero',
    idle: 'hero-idle',
    land: 'hero-land',
    win: 'hero-win',
    anticipation: 'hero-antic',
  };
  const winSequencer: WinSequenceConfig = {
    sequences: {
      base: {
        steps: [
          { atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
          {
            atMs: 200,
            target: { kind: 'allWinningCells' },
            action: { kind: 'rollupStart', curve: 'easeOutQuad' },
          },
        ],
      },
    },
    thresholds: { big: 10, mega: 25, epic: 50 },
    defaultSequence: 'base',
  };
  const featureFlows: FeatureFlowGraph = {
    states: { base: {}, freeSpins: { cinematic: { vfxPreset: 'rayBurst' } } },
    transitions: [{ from: 'base', on: { type: 'freeSpinsAwarded' }, to: 'freeSpins' }],
    entry: 'base',
  };
  const tumble: TumbleChoreography = {
    explodeMs: 150,
    dropMs: 200,
    dropEasing: 'easeInOutCubic',
    refillStaggerMs: 30,
    settleMs: 80,
    stepGapMs: 50,
    rollupCurve: 'linear',
  };
  const refs: SceneRefs = {
    skeletons: [{ name: 'hero', hash: 'a'.repeat(64) }],
    vfxPresets: [{ name: 'rayBurst', hash: 'b'.repeat(64) }],
  };
  return { grid, symbols: { [S('hero')]: heroAnim }, winSequencer, featureFlows, tumble, refs };
}

describe('SlotSceneDocument save/load round-trip (WP-4.12 slice)', () => {
  it('round-trips the default scene to a deep-equal state', () => {
    const scene = defaultSlotSceneState();
    const doc = exportSlotSceneDocument(scene, 'my-game');
    expect(doc.slotSceneFormatVersion).toBe('0.1.0');
    expect(doc.name).toBe('my-game');
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(loadSlotSceneState(doc)).toEqual(scene);
  });

  it('round-trips a richly authored scene to a deep-equal state', () => {
    const scene = authoredScene();
    const doc = exportSlotSceneDocument(scene, 'gates-like');
    const reloaded = loadSlotSceneState(doc);
    expect(reloaded).toEqual(scene);
    // The loaded state does not alias the export input (a deep clone).
    expect(reloaded.grid).not.toBe(scene.grid);
    expect(reloaded.refs).not.toBe(scene.refs);
  });

  it('computes a content hash that changes when any scene byte changes', () => {
    const a = exportSlotSceneDocument(authoredScene(), 'g');
    const mutated = authoredScene();
    const b = exportSlotSceneDocument(
      { ...mutated, grid: { ...mutated.grid, reelStopStaggerMs: 121 } },
      'g',
    );
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects a tampered hash with a typed hashMismatch error (fail loud, LAW 3)', () => {
    const doc = exportSlotSceneDocument(authoredScene(), 'g');
    const tampered = { ...doc, hash: 'f'.repeat(64) };
    expect(() => loadSlotSceneState(tampered)).toThrowError(SlotSceneDocumentError);
    try {
      loadSlotSceneState(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(SlotSceneDocumentError);
      if (err instanceof SlotSceneDocumentError) expect(err.code).toBe('hashMismatch');
    }
  });

  it('rejects a malformed envelope with a typed schema error', () => {
    const doc = exportSlotSceneDocument(authoredScene(), 'g');
    const broken: Record<string, unknown> = { ...doc };
    delete broken.scene;
    try {
      loadSlotSceneState(broken);
      throw new Error('expected loadSlotSceneState to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SlotSceneDocumentError);
      if (err instanceof SlotSceneDocumentError) expect(err.code).toBe('schema');
    }
  });
});
