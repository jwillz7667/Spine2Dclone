import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_ERROR_CODES } from '../src/validate/errors';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes, familyOf } from './helpers';

// Codes a Phase-0 validator CANNOT yet emit because their checks (mesh decode, constraints, the full
// animation/deform/draw-order/event validators, and migration) are deferred to later phases (LAW 5).
// The reachable set is derived as FORMAT_ERROR_CODES minus this list, so the corpus coverage guard is
// not a hand-maintained parallel list: promoting a code to reachable (by removing it here, or adding
// a new code to FORMAT_ERROR_CODES) immediately demands a matching invalid fixture.
const DEFERRED_CODES: ReadonlySet<string> = new Set([
  'MIGRATION_REQUIRED',
  'MESH_UV_LENGTH',
  'MESH_TRIANGLE_LENGTH',
  'MESH_TRIANGLE_INDEX_RANGE',
  'MESH_HULL_RANGE',
  'MESH_EDGE_INVALID',
  'MESH_VERTEX_LENGTH',
  'MESH_WEIGHT_DECODE',
  'MESH_WEIGHT_BONE_RANGE',
  'MESH_WEIGHT_BONES_MANIFEST',
  'MESH_WEIGHT_SUM',
  'MESH_WEIGHT_INFLUENCE_CAP',
  'CLIPPING_END_MISSING',
  'CLIPPING_END_ORDER',
  'POLY_VERTEX_LENGTH',
  'IK_BONES_ARITY',
  'IK_BONE_MISSING',
  'IK_TARGET_MISSING',
  'IK_CHAIN_DISCONTINUOUS',
  'IK_MIX_RANGE',
  'TC_BONE_MISSING',
  'TC_TARGET_MISSING',
  'TC_MIX_RANGE',
  'CONSTRAINT_NAME_DUPLICATE',
  'ANIM_IK_UNKNOWN',
  'ANIM_TRANSFORM_UNKNOWN',
  'DEFORM_SKIN_UNKNOWN',
  'DEFORM_SLOT_UNKNOWN',
  'DEFORM_ATTACHMENT_UNKNOWN',
  'DEFORM_NOT_MESH',
  'DEFORM_OFFSET_LENGTH',
]);

const PHASE0_REACHABLE_CODES = FORMAT_ERROR_CODES.filter((code) => !DEFERRED_CODES.has(code));

const invalidDir = fileURLToPath(new URL('./fixtures/invalid/', import.meta.url));
const fixtureFiles = readdirSync(invalidDir).filter((name) => name.endsWith('.json'));

function loadFixture(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/invalid/${fileName}`, import.meta.url), 'utf8'),
  );
}

// WP-0.3: the table-driven invalid corpus. Each fixture is invalid by exactly one fault, so its
// targeted code must be present and NO code from a different check family may appear (format-contract
// section 8.4.1; a single fault may raise multiple codes within ONE family).
describe('invalid corpus', () => {
  it('has exactly one fixture per Phase-0-reachable code (derived from FORMAT_ERROR_CODES)', () => {
    const present = new Set(fixtureFiles.map((name) => name.replace(/\.json$/, '')));
    expect([...present].sort()).toEqual([...PHASE0_REACHABLE_CODES].sort());
  });

  for (const fileName of fixtureFiles) {
    const expectedCode = fileName.replace(/\.json$/, '');
    it(`${fileName} reports ${expectedCode} and no cross-family code`, () => {
      const report = validateDocument(loadFixture(fileName));
      const codes = errorCodes(report);

      expect(report.ok).toBe(false);
      expect(codes).toContain(expectedCode);
      const expectedFamily = familyOf(expectedCode);
      for (const code of codes) {
        expect(familyOf(code)).toBe(expectedFamily);
      }
    });
  }

  it('collects all independent shape faults in one pass, not just the first', () => {
    const doc = cloneMinimal();
    const root = doc.bones[0];
    if (root === undefined) throw new Error('fixture invariant: root bone');
    root.rotation = NaN; // fault 1: not finite

    const report = validateDocument({ ...doc, name: 42, unexpectedKey: true }); // faults 2 and 3
    const codes = errorCodes(report);

    expect(codes.length).toBeGreaterThanOrEqual(3);
    expect(codes.every((code) => code === 'SCHEMA_SHAPE')).toBe(true);
  });

  it('collects semantic faults from different families in one pass', () => {
    const doc = cloneMinimal();
    doc.slots[0]!.bone = 'ghost'; // SLOT family
    doc.atlas.pages[0]!.regions.push({ ...doc.atlas.pages[0]!.regions[0]! }); // ATLAS family

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('SLOT_BONE_MISSING');
    expect(codes).toContain('ATLAS_REGION_DUPLICATE');
  });
});
