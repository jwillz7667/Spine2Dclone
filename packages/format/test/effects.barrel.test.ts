import { describe, expect, it } from 'vitest';
import * as effectsBarrel from '../src/effects/index';
import * as effectsTypes from '../src/effects/types';
import {
  CURRENT_FORMAT_VERSION,
  EFFECTS_FORMAT_VERSION,
  FORMAT_COMMON_VERSION,
} from '../src/version/constants';

// WP-3.0: the public value surface of the effects barrel is exactly the allowed set. Type-only
// exports erase at runtime and so are not keys here; this guards against an internal helper leaking
// into the public surface or a public value going missing.
const ALLOWED_VALUE_EXPORTS = [
  'EFFECTS_ERROR_CODES',
  'EFFECTS_FORMAT_VERSION',
  'EFFECTS_WARNING_CODES',
  'EffectsValidationError',
  'FORMAT_COMMON_VERSION',
  'computeEffectsContentHash',
  'parseEffectsDocument',
  'parseProjectManifest',
  'validateEffectsDocument',
  'validateProjectManifest',
  'verifyEffectsContentHash',
].sort();

describe('effects barrel surface', () => {
  it('exports exactly the allowed runtime value keys', () => {
    expect(Object.keys(effectsBarrel).sort()).toEqual(ALLOWED_VALUE_EXPORTS);
  });

  it('@marionette/format/effects-types is side-effect-free (zero runtime exports)', () => {
    expect(Object.keys(effectsTypes)).toEqual([]);
  });

  it('exposes the callable validators, hashers, and the error class', () => {
    expect(typeof effectsBarrel.validateEffectsDocument).toBe('function');
    expect(typeof effectsBarrel.parseEffectsDocument).toBe('function');
    expect(typeof effectsBarrel.validateProjectManifest).toBe('function');
    expect(typeof effectsBarrel.computeEffectsContentHash).toBe('function');
    expect(typeof effectsBarrel.EffectsValidationError).toBe('function');
  });

  it('introduces the effects and common versions at 1.0.0 without touching the skeletal version', () => {
    expect(EFFECTS_FORMAT_VERSION).toBe('1.0.0');
    expect(FORMAT_COMMON_VERSION).toBe('1.0.0');
    // The effects and slot version lines move INDEPENDENTLY of the skeletal formatVersion, which is at
    // 0.4.0 after the stage F2 bump (ADR-0009); the effects line is unaffected.
    expect(CURRENT_FORMAT_VERSION).toBe('0.4.0');
  });
});
