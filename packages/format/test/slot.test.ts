import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateSlotScene, parseSlotSceneDocument } from '../src/slot/validate';
import { computeSlotSceneHash, verifySlotSceneContentHash } from '../src/slot/hash/hash';
import { SLOT_SCENE_ERROR_CODES } from '../src/slot/validate/errors';
import {
  validateSlotProjectManifest,
  type ResolvedMemberHashes,
} from '../src/slot/validate/manifest';
import { slotSceneDocumentSchema } from '../src/slot/scene-document';
import { winSequenceConfigSchema } from '../src/slot/win-sequence-config';
import { symbolId } from '../src/slot/symbol-id';
import type { SceneResolver } from '../src/slot/validate/resolver';
import type { SlotSceneDocument } from '../src/slot/scene-document';

// WP-4.4 / WP-4.5 / WP-4.6: the slot scene contract (format-contract section 15). Positive cases (the
// three topologies), the negative corpus (one fixture per reachable SlotSceneError, each invalid by
// exactly one fault), the hash round-trip, the manifest validator, and the LAW 1 no-placement-field
// enumeration. The validator is a pure function: the test supplies the resolver the FS-bearing caller
// supplies in production.

// The hashes and animation names the committed fixtures declare for their referenced artifacts. The
// resolver returns these exact values so the valid fixtures pass and the negative fixtures fail by one
// fault. These mirror the generator (scripts/gen-slot-fixtures.mts).
const SYMBOL_SKELETON_HASH = 'a'.repeat(64);
const VFX_PRESET_HASH = 'c'.repeat(64);
const SKELETON_ANIMATIONS = ['idle', 'land', 'win', 'anticipate'];

function corpusResolver(): SceneResolver {
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

const invalidDir = fileURLToPath(new URL('../fixtures/slot-scene/invalid/', import.meta.url));

function loadValid(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/slot-scene/valid/${fileName}`, import.meta.url), 'utf8'),
  );
}

function loadInvalid(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/slot-scene/invalid/${fileName}`, import.meta.url), 'utf8'),
  );
}

function loadManifest(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/slot-scene/manifest/${fileName}`, import.meta.url), 'utf8'),
  );
}

function errorCodes(report: ReturnType<typeof validateSlotScene>): string[] {
  return report.errors.map((error) => error.code);
}

describe('slot scene valid corpus', () => {
  it('validates the smallest 5x3 reelStrip scene with zero errors and zero warnings', () => {
    const report = validateSlotScene(loadValid('smallest.slot.json'), corpusResolver());
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.document).not.toBeNull();
  });

  it('validates a 6x5 scatterPay scene', () => {
    const report = validateSlotScene(loadValid('scatterpay.slot.json'), corpusResolver());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('validates a 7x7 cluster scene', () => {
    const report = validateSlotScene(loadValid('cluster.slot.json'), corpusResolver());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('parseSlotSceneDocument returns the typed document on a valid scene', () => {
    const doc = parseSlotSceneDocument(loadValid('smallest.slot.json'), corpusResolver());
    expect(doc.scene.grid.topology).toBe('reelStrip');
  });
});

// WP-4.8: the full WinSequenceConfig schema (every target rule + every action member). The positive case
// validates; the closed unions / strict objects / finite-int bounds reject malformed shapes.
describe('WinSequenceConfig schema (WP-4.8)', () => {
  it('accepts a full config exercising every target rule and every action', () => {
    const config = {
      sequences: {
        base: {
          steps: [
            { atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
            {
              atMs: 200,
              target: { kind: 'byLine', index: 4 },
              action: { kind: 'vfx', preset: 'coinShower', anchorRule: 'eachCell' },
            },
            {
              atMs: 400,
              target: { kind: 'bySymbol', symbol: symbolId('H1') },
              action: { kind: 'rollupStart', curve: 'easeOutQuad' },
            },
          ],
        },
        mega: {
          steps: [
            {
              atMs: 0,
              target: { kind: 'allWinningCells' },
              action: { kind: 'escalationBanner', tier: 'mega' },
            },
          ],
        },
      },
      thresholds: { big: 10, mega: 25, epic: 100 },
      defaultSequence: 'base',
    };
    const parsed = winSequenceConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
  });

  it('accepts the minimal-valid form (one empty sequence)', () => {
    const minimal = {
      sequences: { base: { steps: [] } },
      thresholds: { big: 10, mega: 25, epic: 100 },
      defaultSequence: 'base',
    };
    expect(winSequenceConfigSchema.safeParse(minimal).success).toBe(true);
  });

  it.each([
    ['missing defaultSequence', { sequences: {}, thresholds: { big: 1, mega: 2, epic: 3 } }],
    [
      'unknown action kind',
      {
        sequences: {
          base: {
            steps: [{ atMs: 0, target: { kind: 'allWinningCells' }, action: { kind: 'nope' } }],
          },
        },
        thresholds: { big: 1, mega: 2, epic: 3 },
        defaultSequence: 'base',
      },
    ],
    [
      'negative atMs',
      {
        sequences: {
          base: {
            steps: [
              { atMs: -1, target: { kind: 'allWinningCells' }, action: { kind: 'animateWin' } },
            ],
          },
        },
        thresholds: { big: 1, mega: 2, epic: 3 },
        defaultSequence: 'base',
      },
    ],
    [
      'unknown curve',
      {
        sequences: {
          base: {
            steps: [
              {
                atMs: 0,
                target: { kind: 'allWinningCells' },
                action: { kind: 'rollupStart', curve: 'bouncy' },
              },
            ],
          },
        },
        thresholds: { big: 1, mega: 2, epic: 3 },
        defaultSequence: 'base',
      },
    ],
  ] as const)('rejects %s', (_label, bad) => {
    expect(winSequenceConfigSchema.safeParse(bad).success).toBe(false);
  });
});

const invalidFiles = readdirSync(invalidDir).filter((name) => name.endsWith('.json'));

// Manifest-only codes are exercised by the manifest validator below, not the document corpus.
const MANIFEST_ONLY_CODES: ReadonlySet<string> = new Set([
  'projectSchemaShape',
  'projectMemberMissing',
  'projectMemberHashMismatch',
]);

const DOCUMENT_REACHABLE_CODES = SLOT_SCENE_ERROR_CODES.filter(
  (code) => !MANIFEST_ONLY_CODES.has(code),
);

describe('slot scene invalid corpus', () => {
  it('has exactly one fixture per document-reachable slot error code', () => {
    const present = new Set(invalidFiles.map((name) => name.replace(/\.json$/, '')));
    expect([...present].sort()).toEqual([...DOCUMENT_REACHABLE_CODES].sort());
  });

  for (const fileName of invalidFiles) {
    const expectedCode = fileName.replace(/\.json$/, '');
    it(`${fileName} reports ${expectedCode}`, () => {
      const report = validateSlotScene(loadInvalid(fileName), corpusResolver());
      expect(report.ok).toBe(false);
      expect(errorCodes(report)).toContain(expectedCode);
    });
  }

  it('every reported error carries a JSON Pointer path', () => {
    for (const fileName of invalidFiles) {
      const report = validateSlotScene(loadInvalid(fileName), corpusResolver());
      for (const error of report.errors) {
        expect(error.path.startsWith('/') || error.path === '').toBe(true);
      }
    }
  });

  it('locates the gridDimsInconsistent fault at the offending JSON path', () => {
    const report = validateSlotScene(loadInvalid('gridDimsInconsistent.json'), corpusResolver());
    const error = report.errors.find((e) => e.code === 'gridDimsInconsistent');
    expect(error?.path).toBe('/scene/grid/rows');
  });

  it('locates a missing animation at the offending field path', () => {
    const report = validateSlotScene(loadInvalid('animationRefMissing.json'), corpusResolver());
    const error = report.errors.find((e) => e.code === 'animationRefMissing');
    expect(error?.path).toBe('/scene/symbols/WILD/win');
  });

  it('locates a missing VFX preset at the win-sequence step path', () => {
    const report = validateSlotScene(loadInvalid('vfxPresetMissing.json'), corpusResolver());
    const error = report.errors.find((e) => e.code === 'vfxPresetMissing');
    expect(error?.path).toBe('/scene/winSequencer/sequences/base/steps/0/action/preset');
  });

  it('locates a cluster gravity fault at the gravity path', () => {
    const report = validateSlotScene(loadInvalid('gridGravityInconsistent.json'), corpusResolver());
    const error = report.errors.find((e) => e.code === 'gridGravityInconsistent');
    expect(error?.path).toBe('/scene/grid/gravity');
  });

  it('routes a major version mismatch to versionMismatch at /slotSceneFormatVersion', () => {
    const report = validateSlotScene(loadInvalid('versionMismatch.json'), corpusResolver());
    expect(errorCodes(report)).toContain('versionMismatch');
    expect(report.errors[0]?.path).toBe('/slotSceneFormatVersion');
  });

  it('collects multiple independent faults in one pass', () => {
    const doc = loadValid('smallest.slot.json') as Record<string, unknown>;
    const scene = doc['scene'] as Record<string, unknown>;
    const grid = scene['grid'] as Record<string, unknown>;
    grid['rows'] = 9; // gridDimsInconsistent
    (grid['anticipation'] as Record<string, unknown>)['thresholdCount'] = 0; // anticipationThreshold
    doc['hash'] = ''; // empty so only the warning fires, not hashMismatch
    const codes = errorCodes(validateSlotScene(doc, corpusResolver()));
    expect(codes).toContain('gridDimsInconsistent');
    expect(codes).toContain('anticipationThreshold');
  });
});

describe('slot scene reference resolution (resolver-driven)', () => {
  it('rejects a skeleton whose on-disk hash differs from refs with refHashMismatch', () => {
    const report = validateSlotScene(loadInvalid('refHashMismatch.json'), corpusResolver());
    expect(report.ok).toBe(false);
    expect(errorCodes(report)).toContain('refHashMismatch');
  });

  it('rejects an unresolvable skeleton with skeletonRefMissing', () => {
    const report = validateSlotScene(loadInvalid('skeletonRefMissing.json'), corpusResolver());
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'skeletonRefMissing');
    expect(error?.path).toBe('/scene/symbols/WILD/skeletonRef');
  });

  it('accepts an absent anticipation animation (win is reused, no fault)', () => {
    // A SymbolAnimSet with no `anticipation` is valid: win is reused for anticipation.
    const doc = loadValid('smallest.slot.json') as Record<string, unknown>;
    const symbols = (doc['scene'] as Record<string, unknown>)['symbols'] as Record<string, unknown>;
    expect((symbols['WILD'] as Record<string, unknown>)['anticipation']).toBeUndefined();
    const report = validateSlotScene(doc, corpusResolver());
    expect(report.ok).toBe(true);
  });
});

describe('slot scene content hash', () => {
  it('the committed smallest fixture hash matches the recomputed content hash', () => {
    const doc = parseSlotSceneDocument(loadValid('smallest.slot.json'), corpusResolver());
    expect(verifySlotSceneContentHash(doc)).toBe(true);
  });

  it('is stable across repeated computations (deterministic)', () => {
    const doc = parseSlotSceneDocument(loadValid('smallest.slot.json'), corpusResolver());
    expect(computeSlotSceneHash(doc)).toBe(computeSlotSceneHash(doc));
  });

  it('ignores the stored hash field (self-exclusion)', () => {
    const doc = parseSlotSceneDocument(loadValid('smallest.slot.json'), corpusResolver());
    const withEmptyHash: SlotSceneDocument = { ...doc, hash: '' };
    const withWrongHash: SlotSceneDocument = { ...doc, hash: 'd'.repeat(64) };
    expect(computeSlotSceneHash(withEmptyHash)).toBe(computeSlotSceneHash(withWrongHash));
  });

  it('round-trips: save then load yields a matching hash', () => {
    // Recompute on a fresh draft, embed, and revalidate (the save then load path).
    const draft = parseSlotSceneDocument(loadValid('smallest.slot.json'), corpusResolver());
    const recomputed = computeSlotSceneHash({ ...draft, hash: '' });
    const saved: SlotSceneDocument = { ...draft, hash: recomputed };
    const report = validateSlotScene(saved, corpusResolver());
    expect(report.ok).toBe(true);
    expect(report.document?.hash).toBe(draft.hash);
  });

  it('flipping one byte of scene without recomputing hash is rejected as hashMismatch', () => {
    const doc = loadValid('smallest.slot.json') as Record<string, unknown>;
    const scene = doc['scene'] as Record<string, unknown>;
    const grid = scene['grid'] as Record<string, unknown>;
    grid['cellGap'] = 9; // one-byte content change; the stored hash is now stale
    const report = validateSlotScene(doc, corpusResolver());
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'hashMismatch');
    expect(error?.path).toBe('/hash');
  });

  it('the committed hashMismatch fixture trips hashMismatch', () => {
    const report = validateSlotScene(loadInvalid('hashMismatch.json'), corpusResolver());
    expect(errorCodes(report)).toContain('hashMismatch');
  });
});

describe('slot project manifest', () => {
  const valid = loadManifest('valid.project.json');
  const SMALLEST_HASH = (loadValid('smallest.slot.json') as { hash: string }).hash;

  it('accepts a manifest whose members all resolve with matching hashes', () => {
    const resolved: ResolvedMemberHashes = {
      'wild.skel.json': SYMBOL_SKELETON_HASH,
      'coins.fx.json': VFX_PRESET_HASH,
      'game.slot.json': SMALLEST_HASH,
    };
    const report = validateSlotProjectManifest(valid, resolved);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('validates shape only when no resolver is supplied', () => {
    expect(validateSlotProjectManifest(valid).ok).toBe(true);
  });

  it('rejects a dangling member with projectMemberMissing and a path', () => {
    const resolved: ResolvedMemberHashes = {
      'wild.skel.json': SYMBOL_SKELETON_HASH,
      'coins.fx.json': null,
      'game.slot.json': SMALLEST_HASH,
    };
    const report = validateSlotProjectManifest(valid, resolved);
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'projectMemberMissing');
    expect(error?.path).toBe('/members/1/path');
  });

  it('rejects a content-hash mismatch with projectMemberHashMismatch and a path', () => {
    const resolved: ResolvedMemberHashes = {
      'wild.skel.json': SYMBOL_SKELETON_HASH,
      'coins.fx.json': 'e'.repeat(64),
      'game.slot.json': SMALLEST_HASH,
    };
    const report = validateSlotProjectManifest(valid, resolved);
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.code === 'projectMemberHashMismatch');
    expect(error?.path).toBe('/members/1/hash');
  });

  it('rejects a malformed manifest shape with projectSchemaShape', () => {
    const report = validateSlotProjectManifest(loadManifest('projectSchemaShape.json'));
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('projectSchemaShape');
  });
});

// LAW 1: a field-enumeration test asserting there is NO symbol-placement / symbol-source field anywhere
// in the SlotSceneDocument schema. The board is RNG-driven by the engine at runtime (SpinResult), never
// authored. This walks the Zod schema's shape and asserts no field name matches a placement vocabulary.
describe('LAW 1: no symbol-placement field anywhere in the slot scene', () => {
  // The forbidden authoring vocabulary: any field that would let an author pin a symbol to a cell or
  // declare a board source. A match anywhere in the schema is a LAW 1 violation.
  const FORBIDDEN = [
    'placement',
    'placements',
    'board',
    'boardSource',
    'symbolSource',
    'cellSymbol',
    'cellContents',
    'initialGrid',
    'finalGrid',
    'reelStrip',
    'reelStrips',
    'stripData',
    'symbolAtCell',
    'symbolPlacement',
    'layout',
    'fixedSymbols',
    'forcedSymbols',
  ];

  // Recursively collect every object key name reachable in a Zod schema's shape.
  function collectKeys(schema: unknown, seen: Set<unknown>, out: Set<string>): void {
    if (schema === null || typeof schema !== 'object') return;
    if (seen.has(schema)) return;
    seen.add(schema);
    const record = schema as Record<string, unknown>;
    const def = record['_def'];
    if (def !== undefined && def !== null && typeof def === 'object') {
      const defRecord = def as Record<string, unknown>;
      const shapeFn = defRecord['shape'];
      let shape: unknown;
      if (typeof shapeFn === 'function') {
        shape = (shapeFn as () => unknown)();
      } else {
        shape = defRecord['shape'];
      }
      if (shape !== undefined && shape !== null && typeof shape === 'object') {
        for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
          out.add(key);
          collectKeys(child, seen, out);
        }
      }
      // Walk through wrappers (optional, array element, record value, union options, transform inner).
      for (const wrapperKey of ['innerType', 'type', 'valueType', 'schema']) {
        collectKeys(defRecord[wrapperKey], seen, out);
      }
      const options = defRecord['options'];
      if (Array.isArray(options)) {
        for (const option of options) collectKeys(option, seen, out);
      }
    }
  }

  it('the schema field names contain no placement/source vocabulary', () => {
    const keys = new Set<string>();
    collectKeys(slotSceneDocumentSchema, new Set(), keys);
    // Sanity: the walk actually reached the grid/anticipation/symbol fields.
    expect(keys.has('topology')).toBe(true);
    expect(keys.has('triggerSymbols')).toBe(true);
    expect(keys.has('skeletonRef')).toBe(true);
    for (const forbidden of FORBIDDEN) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
