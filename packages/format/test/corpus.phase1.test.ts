import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FORMAT_ERROR_CODES } from '../src/validate/errors';
import type { FormatErrorCode } from '../src/validate/errors';
import { parseDocument, validateDocument } from '../src/validate';
import { CURRENT_FORMAT_VERSION, SUPPORTED_FORMAT_MAJOR } from '../src/version/constants';
import { errorCodes } from './helpers';
import phase1Complete from './fixtures/phase1-complete.json';

// WP-1.11 (phase-1-bone-puppet.md section 5): the Phase-1 validator corpus. This WP adds ZERO new
// checks, ZERO new error codes, and ZERO schema or type changes; it proves the ALREADY-COMPLETE
// Phase-0 validator catches every Phase-1 malformation and accepts a fully-authored Phase-1 rig.
//
// The negative fixtures are the same committed corpus the Phase-0 suite uses (test/fixtures/invalid,
// provenance in scripts/gen-fixtures.mts), each invalid by exactly ONE fault. corpus.invalid.test.ts
// already guards them at the FAMILY level (the targeted code is present, no cross-family code fires);
// this suite adds the stronger Phase-1 contract: per code, the EXACT FormatErrorCode is the only one
// emitted AND its JSON Pointer path is pinned, so a path regression in the validator fails here, not
// just a code regression.

// The Phase-1-relevant FormatErrorCodes (phase-1-bone-puppet.md section 5) mapped to the single
// error each fixture must produce and the exact JSON Pointer of that error. Pinning the path is what
// makes this a contract test rather than a smoke test: it asserts WHERE the validator points, which
// the editor import-handler surfacing (TASK-1.11.1) and any external tooling depend on.
const PHASE1_NEGATIVE_CORPUS: ReadonlyArray<{
  readonly code: FormatErrorCode;
  readonly path: string;
}> = [
  { code: 'BONE_ORDER_VIOLATION', path: '/bones/0/parent' },
  { code: 'BONE_PARENT_MISSING', path: '/bones/1/parent' },
  { code: 'BONE_NAME_DUPLICATE', path: '/bones/1/name' },
  { code: 'SLOT_NAME_DUPLICATE', path: '/slots/1/name' },
  { code: 'SLOT_BONE_MISSING', path: '/slots/0/bone' },
  { code: 'SLOT_ATTACHMENT_MISSING', path: '/slots/0/attachment' },
  { code: 'SKIN_DEFAULT_MISSING', path: '/skins' },
  { code: 'SKIN_SLOT_UNKNOWN', path: '/skins/0/attachments/ghostSlot' },
  { code: 'ATLAS_REGION_DUPLICATE', path: '/atlas/pages/0/regions/1/name' },
  { code: 'ATTACHMENT_REGION_MISSING', path: '/skins/0/attachments/body/body/path' },
  { code: 'ANIM_BONE_UNKNOWN', path: '/animations/idle/bones/ghost' },
  { code: 'ANIM_SLOT_UNKNOWN', path: '/animations/idle/slots/ghostSlot' },
  { code: 'ANIM_TIME_ORDER', path: '/animations/idle/bones/root/rotate/1/time' },
  { code: 'ANIM_TIME_RANGE', path: '/animations/idle/bones/root/rotate/0/time' },
  { code: 'ANIM_DURATION', path: '/animations/idle/duration' },
  { code: 'COLOR_RANGE', path: '/slots/0/color/r' },
  { code: 'CURVE_BEZIER_X_RANGE', path: '/animations/idle/bones/root/rotate/1/curve/cx1' },
];

// The exact section-5 Phase-1 code list, sorted, to pin the corpus contents. Dropping a row from the
// table (a silent coverage gap) flips this assertion.
const PHASE1_CODES_SORTED: readonly string[] = [
  'ANIM_BONE_UNKNOWN',
  'ANIM_DURATION',
  'ANIM_SLOT_UNKNOWN',
  'ANIM_TIME_ORDER',
  'ANIM_TIME_RANGE',
  'ATLAS_REGION_DUPLICATE',
  'ATTACHMENT_REGION_MISSING',
  'BONE_NAME_DUPLICATE',
  'BONE_ORDER_VIOLATION',
  'BONE_PARENT_MISSING',
  'COLOR_RANGE',
  'CURVE_BEZIER_X_RANGE',
  'SKIN_DEFAULT_MISSING',
  'SKIN_SLOT_UNKNOWN',
  'SLOT_ATTACHMENT_MISSING',
  'SLOT_BONE_MISSING',
  'SLOT_NAME_DUPLICATE',
];

function loadInvalid(code: string): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/invalid/${code}.json`, import.meta.url)),
      'utf8',
    ),
  );
}

describe('Phase 1 negative corpus (WP-1.11 TASK-1.11.2)', () => {
  it('covers exactly the section-5 Phase-1 code list with no duplicate rows', () => {
    const codes = PHASE1_NEGATIVE_CORPUS.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual([...PHASE1_CODES_SORTED]);
  });

  for (const { code, path } of PHASE1_NEGATIVE_CORPUS) {
    it(`${code}: rejected with exactly that code at ${path}`, () => {
      // Default options (verifyHash: true): the semantic fixtures carry an empty hash, which is a
      // HASH_ABSENT WARNING (not an error), and the structural fixtures stop before the hash layer,
      // so the error list stays a single targeted entry in every case.
      const report = validateDocument(loadInvalid(code));

      expect(report.ok).toBe(false);
      // Exactly one error code, the intended one: proves the fixture isolates a single fault and no
      // OTHER Phase-1 code (indeed no other code at all) fires.
      expect(errorCodes(report)).toEqual([code]);
      expect(report.errors[0]?.path).toBe(path);
    });
  }
});

describe('Phase 1 positive completeness fixture (WP-1.11 TASK-1.11.3)', () => {
  it('a fully-authored Phase-1 rig validates with zero errors and zero warnings', () => {
    const report = validateDocument(phase1Complete);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.document).not.toBeNull();
  });

  it('authors every Phase-1 channel in the strict { duration, bones, slots } Animation shape', () => {
    // Guard the fixture's INTENT through the typed parser (zero casts): the completeness claim is
    // only meaningful if the animation actually keys rotate/translate/scale/shear on bones and color
    // on a slot, in an Animation carrying exactly the three strict keys. parseDocument returns the
    // schema output, so the structure below is type-checked, not asserted by hand-rolled shapes.
    const doc = parseDocument(phase1Complete);
    const idle = doc.animations['idle'];
    if (idle === undefined) throw new Error('fixture invariant: idle animation');

    expect(Object.keys(idle).sort()).toEqual(['bones', 'duration', 'slots']);
    expect(idle.bones['root']?.rotate).toBeDefined();
    expect(idle.bones['root']?.translate).toBeDefined();
    expect(idle.bones['child']?.scale).toBeDefined();
    expect(idle.bones['child']?.shear).toBeDefined();
    expect(idle.slots['body']?.color).toBeDefined();
  });
});

describe('Phase 1 contract guardrails (WP-1.11)', () => {
  // This WP adds fixtures and tests ONLY. The FormatErrorCode union, the format version, and the
  // supported major are frozen here as a committed snapshot. A diff means a schema or semantic change
  // slipped in, which must instead follow the formatVersion discipline (LAW 3, format-contract
  // section 10), not ride along on a corpus PR.
  const COMMITTED_FORMAT_ERROR_CODES: readonly string[] = [
    'SCHEMA_SHAPE',
    'UNSUPPORTED_FORMAT_VERSION',
    'MIGRATION_REQUIRED',
    'BONE_NAME_DUPLICATE',
    'BONE_PARENT_MISSING',
    'BONE_ORDER_VIOLATION',
    'SLOT_NAME_DUPLICATE',
    'SLOT_BONE_MISSING',
    'SLOT_ATTACHMENT_MISSING',
    'SKIN_DEFAULT_MISSING',
    'SKIN_SLOT_UNKNOWN',
    'ATLAS_REGION_DUPLICATE',
    'ATTACHMENT_REGION_MISSING',
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
    'ANIM_BONE_UNKNOWN',
    'ANIM_SLOT_UNKNOWN',
    'ANIM_IK_UNKNOWN',
    'ANIM_TRANSFORM_UNKNOWN',
    'ANIM_TIME_RANGE',
    'ANIM_TIME_ORDER',
    'ANIM_DURATION',
    'CURVE_BEZIER_X_RANGE',
    'COLOR_RANGE',
    'DRAWORDER_INCOMPLETE',
    'DEFORM_SKIN_UNKNOWN',
    'DEFORM_SLOT_UNKNOWN',
    'DEFORM_ATTACHMENT_UNKNOWN',
    'DEFORM_NOT_MESH',
    'DEFORM_OFFSET_LENGTH',
    'EVENT_NAME_DUPLICATE',
    'ANIM_EVENT_UNKNOWN',
    'HASH_MISMATCH',
  ];

  it('adds no new FormatErrorCode members and reorders none (union frozen)', () => {
    expect([...FORMAT_ERROR_CODES]).toEqual([...COMMITTED_FORMAT_ERROR_CODES]);
  });

  it('leaves the format version and supported major unchanged at 0.1.0 / 0', () => {
    expect(CURRENT_FORMAT_VERSION).toBe('0.1.0');
    expect(SUPPORTED_FORMAT_MAJOR).toBe(0);
  });

  it('keeps every Phase-1 corpus code inside the frozen union', () => {
    const union = new Set(COMMITTED_FORMAT_ERROR_CODES);
    for (const code of PHASE1_CODES_SORTED) expect(union.has(code)).toBe(true);
  });
});
