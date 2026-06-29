import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EFFECTS_ERROR_CODES } from '../src/effects/validate/errors';
import { validateEffectsDocument } from '../src/effects/validate';

// WP-3.0: the table-driven invalid corpus for the EffectsDocument. Each fixture is invalid by exactly
// one fault, leaving the hash empty (so only an EFFECT_HASH_ABSENT warning fires, never a hash error),
// so its targeted code must be present in the report. The exception is EFFECT_HASH_MISMATCH, which
// carries a non-empty wrong hash on purpose.
//
// PROJECT_* codes are manifest faults (covered by effects.manifest.test.ts), so they are excluded
// from the document corpus coverage guard below; everything else in EFFECTS_ERROR_CODES must have a
// matching invalid fixture, so adding a new document code immediately demands a fixture.
const MANIFEST_ONLY_CODES: ReadonlySet<string> = new Set([
  'PROJECT_SCHEMA_SHAPE',
  'PROJECT_MEMBER_MISSING',
  'PROJECT_MEMBER_HASH_MISMATCH',
]);

const DOCUMENT_REACHABLE_CODES = EFFECTS_ERROR_CODES.filter(
  (code) => !MANIFEST_ONLY_CODES.has(code),
);

const invalidDir = fileURLToPath(new URL('./fixtures/effects/invalid/', import.meta.url));
const fixtureFiles = readdirSync(invalidDir).filter((name) => name.endsWith('.json'));

function loadFixture(fileName: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/effects/invalid/${fileName}`, import.meta.url), 'utf8'),
  );
}

function errorCodes(report: ReturnType<typeof validateEffectsDocument>): string[] {
  return report.errors.map((error) => error.code);
}

describe('effects invalid corpus', () => {
  it('has exactly one fixture per document-reachable effects code', () => {
    const present = new Set(fixtureFiles.map((name) => name.replace(/\.json$/, '')));
    expect([...present].sort()).toEqual([...DOCUMENT_REACHABLE_CODES].sort());
  });

  for (const fileName of fixtureFiles) {
    const expectedCode = fileName.replace(/\.json$/, '');
    it(`${fileName} reports ${expectedCode}`, () => {
      const report = validateEffectsDocument(loadFixture(fileName));
      expect(report.ok).toBe(false);
      expect(errorCodes(report)).toContain(expectedCode);
    });
  }

  it('every reported error carries a JSON Pointer path', () => {
    for (const fileName of fixtureFiles) {
      const report = validateEffectsDocument(loadFixture(fileName));
      for (const error of report.errors) {
        expect(error.path.startsWith('/') || error.path === '').toBe(true);
      }
    }
  });

  it('locates the EFFECT_SIMULATION_DT fault at the offending JSON path', () => {
    const report = validateEffectsDocument(loadFixture('EFFECT_SIMULATION_DT.json'));
    const error = report.errors.find((e) => e.code === 'EFFECT_SIMULATION_DT');
    expect(error?.path).toBe('/effects/sparkle/simulationDt');
  });

  it('locates a missing region at the texture region path', () => {
    const report = validateEffectsDocument(loadFixture('EFFECT_REGION_MISSING.json'));
    const error = report.errors.find((e) => e.code === 'EFFECT_REGION_MISSING');
    expect(error?.path).toBe('/effects/sparkle/layers/0/texture/region');
  });

  it('collects multiple independent faults in one pass', () => {
    const doc = JSON.parse(
      readFileSync(new URL('./fixtures/effects/minimal.fx.json', import.meta.url), 'utf8'),
    );
    // Two independent semantic faults: a bad simulationDt and a dangling bundle effect reference.
    doc.hash = '';
    doc.effects.sparkle.simulationDt = -1;
    doc.bundles.simple.items[0].effect = 'ghost';
    const codes = errorCodes(validateEffectsDocument(doc));
    expect(codes).toContain('EFFECT_SIMULATION_DT');
    expect(codes).toContain('BUNDLE_EFFECT_MISSING');
  });
});
