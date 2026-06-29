// Generates the slot-scene golden corpus (format-contract section 15, phase-4 WP-4.4 / WP-4.5 / WP-4.6):
// one canonical valid smallest-scene `slot-scene/valid/smallest.slot.json` (a 5x3 reelStrip), plus a
// 6x5 scatterPay and a 7x7 cluster valid scene, plus one `slot-scene/invalid/<code>.json` per
// semantic-reachable SlotSceneError code (each invalid by exactly ONE fault). The corpus is committed;
// this script is its provenance, so a reviewer can see precisely which single field each fixture
// breaks. Run: pnpm --filter @marionette/format gen:slot-fixtures.
//
// The valid fixtures carry a correct content hash (they validate with zero warnings under the test's
// resolver). The invalid fixtures carry an empty hash, which yields only a slotHashAbsent warning
// (never a hash error), so each invalid document trips exactly its targeted fault. The single exception
// is the hashMismatch fixture, which carries a non-empty wrong hash on purpose.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSlotSceneHash } from '../src/slot/hash/hash';
import { validateSlotScene } from '../src/slot/validate';
import type { SceneResolver } from '../src/slot/validate/resolver';
import type { SlotSceneDocument } from '../src/slot/scene-document';
import { symbolId } from '../src/slot/symbol-id';
import { SLOT_SCENE_FORMAT_VERSION } from '../src/version/constants';

const slotDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'slot-scene');
const validDir = join(slotDir, 'valid');
const invalidDir = join(slotDir, 'invalid');
const manifestDir = join(slotDir, 'manifest');

// The on-disk hashes the corpus declares for its referenced artifacts. The test's resolver returns
// these exact hashes (and the listed animation names) so the valid fixtures pass and the targeted
// negative fixtures fail by exactly one fault.
export const SYMBOL_SKELETON_HASH = 'a'.repeat(64);
export const VFX_PRESET_HASH = 'c'.repeat(64);
export const SKELETON_ANIMATIONS = ['idle', 'land', 'win', 'anticipate'] as const;

// The resolver the generator (and the test) supply: one known skeleton "wildSkeleton" with a fixed
// animation set and hash, and one known VFX preset "coinShower" with a fixed hash.
export function corpusResolver(): SceneResolver {
  return {
    skeleton(name) {
      if (name === 'wildSkeleton') {
        return { animations: [...SKELETON_ANIMATIONS], hash: SYMBOL_SKELETON_HASH };
      }
      return null;
    },
    vfxPreset(name) {
      if (name === 'coinShower') {
        return { hash: VFX_PRESET_HASH };
      }
      return null;
    },
  };
}

// A minimal AnticipationConfig valid for a given column count.
function anticipation(maxAnticipatingCols: number) {
  return {
    triggerSymbols: [symbolId('SCAT')],
    thresholdCount: 1,
    maxAnticipatingCols,
  };
}

// A SymbolAnimSet that references the corpus skeleton and its known animations.
function wildAnimSet() {
  return {
    skeletonRef: 'wildSkeleton',
    idle: 'idle',
    land: 'land',
    win: 'win',
  };
}

// A win sequencer with one named sequence carrying a single step that fires the corpus VFX preset (so
// the "every referenced VFX preset resolves" rule is exercised by the valid fixtures). The step targets
// all winning cells and fires the preset at the grid center (WP-4.8 step shape: { atMs, target, action }).
function winSequencer() {
  return {
    sequences: {
      base: {
        steps: [
          {
            atMs: 0,
            target: { kind: 'allWinningCells' },
            action: { kind: 'vfx', preset: 'coinShower', anchorRule: 'gridCenter' },
          },
        ],
      },
    },
    thresholds: { big: 10, mega: 50, epic: 200 },
    defaultSequence: 'base',
  };
}

// A feature flow with the single required `base` node, whose cinematic references the corpus preset.
function featureFlows() {
  return {
    states: { base: { cinematic: { vfxPreset: 'coinShower' } } },
    transitions: [],
    entry: 'base',
  };
}

function tumble() {
  return {
    explodeMs: 120,
    dropMs: 200,
    dropEasing: 'easeOutQuad',
    refillStaggerMs: 40,
    settleMs: 80,
    stepGapMs: 150,
    rollupCurve: 'easeInOutCubic',
  };
}

function refs() {
  return {
    skeletons: [{ name: 'wildSkeleton', hash: SYMBOL_SKELETON_HASH }],
    vfxPresets: [{ name: 'coinShower', hash: VFX_PRESET_HASH }],
  };
}

// The smallest valid scene: a 5x3 reelStrip (format-contract section 15.4 dims, phase-4 WP-4.4
// smallest-valid GridConfig). Authored with an empty hash; the real hash is computed and embedded by
// withHash.
function smallestDraft(): SlotSceneDocument {
  return {
    slotSceneFormatVersion: SLOT_SCENE_FORMAT_VERSION,
    name: 'smallest-reelstrip',
    hash: '',
    scene: {
      grid: {
        topology: 'reelStrip',
        cols: 5,
        rows: 3,
        cellWidth: 100,
        cellHeight: 100,
        cellGap: 8,
        reelStopStaggerMs: 0,
        gravity: 'column-down',
        anticipation: anticipation(1),
      },
      symbols: { WILD: wildAnimSet() },
      winSequencer: winSequencer(),
      featureFlows: featureFlows(),
      tumble: tumble(),
    },
    refs: refs(),
  };
}

// A 6x5 scatterPay scene (cols in [5, 7]).
function scatterPayDraft(): SlotSceneDocument {
  const draft = smallestDraft();
  draft.name = 'scatterpay-6x5';
  draft.scene.grid = {
    topology: 'scatterPay',
    cols: 6,
    rows: 5,
    cellWidth: 90,
    cellHeight: 90,
    cellGap: 6,
    reelStopStaggerMs: 50,
    gravity: 'column-down',
    anticipation: anticipation(3),
  };
  return draft;
}

// A 7x7 cluster scene (square, cluster-down gravity).
function clusterDraft(): SlotSceneDocument {
  const draft = smallestDraft();
  draft.name = 'cluster-7x7';
  draft.scene.grid = {
    topology: 'cluster',
    cols: 7,
    rows: 7,
    cellWidth: 80,
    cellHeight: 80,
    cellGap: 4,
    reelStopStaggerMs: 0,
    gravity: 'cluster-down',
    anticipation: anticipation(7),
  };
  return draft;
}

function withHash(doc: SlotSceneDocument): SlotSceneDocument {
  return { ...doc, hash: computeSlotSceneHash({ ...doc, hash: '' }) };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

// Build the invalid corpus: each entry mutates the smallest valid draft by exactly one fault, leaving
// the hash empty so only the targeted code fires (except hashMismatch, which carries a wrong hash).
function invalidCorpus(): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // slotSchemaShape: an unknown top-level key (closed object).
  out['slotSchemaShape'] = { ...clone(smallestDraft()), unexpectedKey: true };

  // versionMismatch: a slotSceneFormatVersion other than the supported one.
  {
    const d = clone(smallestDraft());
    d.slotSceneFormatVersion = '1.0.0';
    out['versionMismatch'] = d;
  }

  // gridDimsInconsistent: a reelStrip with rows outside [2, 6].
  {
    const d = clone(smallestDraft());
    d.scene.grid.rows = 8;
    out['gridDimsInconsistent'] = d;
  }

  // gridGravityInconsistent: a cluster grid with column-down gravity (cluster requires cluster-down).
  {
    const d = clone(clusterDraft());
    d.scene.grid.gravity = 'column-down';
    out['gridGravityInconsistent'] = d;
  }

  // anticipationEmptyTriggers: an empty triggerSymbols list.
  {
    const d = clone(smallestDraft());
    d.scene.grid.anticipation.triggerSymbols = [];
    out['anticipationEmptyTriggers'] = d;
  }

  // anticipationThreshold: a thresholdCount below 1.
  {
    const d = clone(smallestDraft());
    d.scene.grid.anticipation.thresholdCount = 0;
    out['anticipationThreshold'] = d;
  }

  // anticipationColsOutOfRange: maxAnticipatingCols greater than cols.
  {
    const d = clone(smallestDraft());
    d.scene.grid.anticipation.maxAnticipatingCols = 9; // cols is 5
    out['anticipationColsOutOfRange'] = d;
  }

  // skeletonRefMissing: a SymbolAnimSet referencing a skeleton not in refs.skeletons.
  {
    const d = clone(smallestDraft());
    d.scene.symbols['WILD']!.skeletonRef = 'ghostSkeleton';
    out['skeletonRefMissing'] = d;
  }

  // animationRefMissing: a win animation name the referenced skeleton does not define.
  {
    const d = clone(smallestDraft());
    d.scene.symbols['WILD']!.win = 'noSuchAnim';
    out['animationRefMissing'] = d;
  }

  // vfxPresetMissing: a win-sequence step whose vfx action references a preset not in refs.vfxPresets.
  {
    const d = clone(smallestDraft());
    const action = d.scene.winSequencer.sequences['base']!.steps[0]!.action;
    if (action.kind === 'vfx') action.preset = 'ghostPreset';
    out['vfxPresetMissing'] = d;
  }

  // refHashMismatch: a referenced skeleton whose declared hash differs from the on-disk (resolver) hash.
  {
    const d = clone(smallestDraft());
    d.refs.skeletons[0]!.hash = 'f'.repeat(64); // resolver returns SYMBOL_SKELETON_HASH ("aaaa...")
    out['refHashMismatch'] = d;
  }

  // hashMismatch: a syntactically valid hash that does not match the content.
  {
    const d = clone(smallestDraft());
    d.hash = 'b'.repeat(64);
    out['hashMismatch'] = d;
  }

  return out;
}

function main(): void {
  rmSync(slotDir, { recursive: true, force: true });
  mkdirSync(validDir, { recursive: true });
  mkdirSync(invalidDir, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });

  const resolver = corpusResolver();

  const validDrafts: Array<{ file: string; draft: SlotSceneDocument }> = [
    { file: 'smallest.slot.json', draft: smallestDraft() },
    { file: 'scatterpay.slot.json', draft: scatterPayDraft() },
    { file: 'cluster.slot.json', draft: clusterDraft() },
  ];
  for (const { file, draft } of validDrafts) {
    const valid = withHash(draft);
    const report = validateSlotScene(valid, resolver);
    if (!report.ok) {
      throw new Error(
        `valid slot fixture ${file} is not valid: ${JSON.stringify(report.errors, null, 2)}`,
      );
    }
    writeFileSync(join(validDir, file), `${JSON.stringify(valid, null, 2)}\n`);
  }

  const corpus = invalidCorpus();
  for (const [code, doc] of Object.entries(corpus)) {
    writeFileSync(join(invalidDir, `${code}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  }

  // Slot project manifest fixtures: a valid manifest (one skeleton, one effects bundle, one slot scene)
  // and the malformed-shape case. The dangling-member and hash-mismatch faults are exercised via the
  // resolver in the test, so the manifest itself is the same shape there.
  const smallestHash = withHash(smallestDraft()).hash;
  const manifest = {
    projectFormatVersion: '1.0.0',
    name: 'demo-slot-project',
    members: [
      { path: 'wild.skel.json', kind: 'skeleton', hash: SYMBOL_SKELETON_HASH },
      { path: 'coins.fx.json', kind: 'effects', hash: VFX_PRESET_HASH },
      { path: 'game.slot.json', kind: 'slotScene', hash: smallestHash },
    ],
  };
  writeFileSync(join(manifestDir, 'valid.project.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // projectSchemaShape: a member with a bad-length hash.
  const badShape = clone(manifest);
  badShape.members[0]!.hash = 'short';
  writeFileSync(
    join(manifestDir, 'projectSchemaShape.json'),
    `${JSON.stringify(badShape, null, 2)}\n`,
  );

  console.log('slot fixtures written.');
}

main();
