import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  exportProfileSchema,
  isExportProfileError,
  loadExportProfile,
  saveExportProfile,
  type ExportProfile,
} from './index';

// A known-good profile mirroring the frozen ship values (TASK-5.0.4). Used by the load/round-trip
// tests; the on-disk ship asset is validated separately below.
const VALID_PROFILE: ExportProfile = {
  exportProfileVersion: '1.0.0',
  atlasExport: {
    maxPageSize: 2048,
    padding: 2,
    allowRotation: true,
    blendBinning: true,
    textureTransport: 'uastc-ktx2',
    compressionTargets: ['astc6x6', 'bc7', 'etc2'],
  },
  particleProfiles: {
    mobile: { maxLiveParticles: 600, ambientQualityTier: 'medium' },
    desktop: { maxLiveParticles: 2000, ambientQualityTier: 'high' },
  },
  coldStartBudgets: {
    unityIosNativeMs: 1500,
    webWarmFirstFrameMs: 1500,
    webColdInteractiveMs: 4000,
  },
};

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'export-profile-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function writeProfileFile(contents: string): void {
  writeFileSync(join(projectRoot, 'export-profile.json'), contents, 'utf8');
}

describe('loadExportProfile', () => {
  it('loads a valid file to a typed ExportProfile (deep-equal a known object)', () => {
    writeProfileFile(JSON.stringify(VALID_PROFILE));

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(false);
    expect(result).toEqual(VALID_PROFILE);
  });

  it('rejects a malformed file (bad enum) with kind invalid and non-empty issues', () => {
    const badEnum = { ...VALID_PROFILE, atlasExport: { ...VALID_PROFILE.atlasExport } };
    // ambientQualityTier 'ultra' is not in the enum.
    const corrupted = {
      ...badEnum,
      particleProfiles: {
        mobile: { maxLiveParticles: 600, ambientQualityTier: 'ultra' },
        desktop: VALID_PROFILE.particleProfiles.desktop,
      },
    };
    writeProfileFile(JSON.stringify(corrupted));

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected kind invalid');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range value with kind invalid', () => {
    const corrupted = {
      ...VALID_PROFILE,
      atlasExport: { ...VALID_PROFILE.atlasExport, padding: 99 },
    };
    writeProfileFile(JSON.stringify(corrupted));

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('invalid');
  });

  it('rejects an unknown key with kind invalid (.strict)', () => {
    const corrupted = { ...VALID_PROFILE, unexpectedKnob: true };
    writeProfileFile(JSON.stringify(corrupted));

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('invalid');
  });

  it('reports an absent file as kind missing', () => {
    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('missing');
    if (result.kind !== 'missing') throw new Error('expected kind missing');
    expect(result.path).toContain('export-profile.json');
  });

  it('reports malformed JSON as kind unreadable', () => {
    writeProfileFile('{ this is not valid json');

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') throw new Error('expected kind unreadable');
    expect(result.cause).toBeDefined();
  });

  it('reports a non-ENOENT read failure (path is a directory) as kind unreadable', () => {
    // Make export-profile.json a directory so readFileSync fails with EISDIR, not ENOENT.
    mkdirSync(join(projectRoot, 'export-profile.json'));

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(true);
    if (!isExportProfileError(result)) throw new Error('expected an ExportProfileError');
    expect(result.kind).toBe('unreadable');
  });
});

describe('saveExportProfile', () => {
  it('round-trips: load(save(p)) deep-equals p', () => {
    saveExportProfile(projectRoot, VALID_PROFILE);

    const result = loadExportProfile(projectRoot);

    expect(isExportProfileError(result)).toBe(false);
    expect(result).toEqual(VALID_PROFILE);
  });

  it('writes pretty-printed JSON with a trailing newline', () => {
    saveExportProfile(projectRoot, VALID_PROFILE);

    const written = readFileSync(join(projectRoot, 'export-profile.json'), 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toContain('\n  "exportProfileVersion"');
  });

  it('throws on an in-memory profile that fails the schema (programmer error)', () => {
    const broken = {
      ...VALID_PROFILE,
      atlasExport: { ...VALID_PROFILE.atlasExport, padding: -1 },
    };
    // padding -1 is below the .min(0) bound. The cast is local to this negative test only; the
    // schema is the runtime guard that must reject it.
    expect(() => saveExportProfile(projectRoot, broken as unknown as ExportProfile)).toThrow();
  });
});

describe('disjoint-fields guard (TASK-5.0.5 / TASK-5.0.8)', () => {
  // Derive the ExportProfile top-level field set at runtime from the schema shape (no hardcoding).
  const exportProfileFields = Object.keys(exportProfileSchema.shape);

  // Derive the SkeletonDocument top-level field set from a committed rig fixture that carries ALL ten
  // top-level fields (read as a DATA file via fs, NOT a code import, so no cross-package code boundary
  // is crossed). rig-two-bone-ik has the full set including ikConstraints/transformConstraints.
  const SKELETON_FIXTURE = resolve(
    __dirname,
    '../../../../../packages/conformance/src/rigs/rig-two-bone-ik.json',
  );
  const skeletonDocument: unknown = JSON.parse(readFileSync(SKELETON_FIXTURE, 'utf8'));
  const skeletonFields =
    typeof skeletonDocument === 'object' && skeletonDocument !== null
      ? Object.keys(skeletonDocument)
      : [];

  it('the chosen skeleton fixture exposes the full top-level field set (guards against drift)', () => {
    // Fail loudly if the fixture used to derive the field set is incomplete, so the disjointness
    // assertion below is never silently weakened.
    const expected = [
      'formatVersion',
      'name',
      'hash',
      'bones',
      'slots',
      'skins',
      'ikConstraints',
      'transformConstraints',
      'events',
      'animations',
      'atlas',
    ].sort();
    expect([...skeletonFields].sort()).toEqual(expected);
  });

  it('keyof ExportProfile is DISJOINT from the SkeletonDocument top-level field set', () => {
    const skeletonSet = new Set(skeletonFields);
    const intersection = exportProfileFields.filter((field) => skeletonSet.has(field));
    expect(intersection).toEqual([]);
  });
});

describe('frozen ship Export Profile (TASK-5.0.4)', () => {
  it('packages/conformance/assets/ship/export-profile.json validates against the schema', () => {
    const shipProfilePath = resolve(
      __dirname,
      '../../../../../packages/conformance/assets/ship/export-profile.json',
    );
    const raw = JSON.parse(readFileSync(shipProfilePath, 'utf8'));
    const result = exportProfileSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });
});
