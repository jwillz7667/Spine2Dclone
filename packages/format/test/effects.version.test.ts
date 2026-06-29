import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEffectsDocument } from '../src/effects/validate';
import { EFFECTS_FORMAT_VERSION } from '../src/version/constants';

// WP-3.0: the effects version gate. There is exactly one supported effects version in Phase 3
// (1.0.0); any other (newer, older, or unparseable) is EFFECT_UNSUPPORTED_FORMAT_VERSION and stops
// the pipeline. The effects version line is independent of the skeletal one (section 5).
function minimal(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL('./fixtures/effects/minimal.fx.json', import.meta.url), 'utf8'),
  );
}

describe('effects version gate', () => {
  it('accepts exactly the current effectsFormatVersion', () => {
    expect(validateEffectsDocument(minimal()).ok).toBe(true);
    expect(EFFECTS_FORMAT_VERSION).toBe('1.0.0');
  });

  it('rejects a different version as EFFECT_UNSUPPORTED_FORMAT_VERSION at /effectsFormatVersion', () => {
    const report = validateEffectsDocument({
      ...minimal(),
      hash: '',
      effectsFormatVersion: '2.0.0',
    });
    expect(report.errors.map((e) => e.code)).toContain('EFFECT_UNSUPPORTED_FORMAT_VERSION');
    expect(report.errors[0]?.path).toBe('/effectsFormatVersion');
  });

  it('rejects an unparseable version', () => {
    const report = validateEffectsDocument({ ...minimal(), hash: '', effectsFormatVersion: 'x.y' });
    expect(report.errors.map((e) => e.code)).toContain('EFFECT_UNSUPPORTED_FORMAT_VERSION');
  });

  it('serializes no internal entity IDs (effects are id-free on disk, section 8.1.1)', () => {
    // The on-disk EffectsDocument is name-keyed and id-free: no EffectId / EffectLayerId / LifeStopId /
    // BundleItemId is ever serialized (those are minted internally by document-core at import).
    const raw = readFileSync(
      new URL('./fixtures/effects/minimal.fx.json', import.meta.url),
      'utf8',
    );
    expect(raw).not.toMatch(/effectId|effectLayerId|lifeStopId|bundleItemId/i);
  });
});
