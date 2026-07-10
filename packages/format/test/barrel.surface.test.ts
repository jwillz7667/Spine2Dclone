import { describe, expect, it } from 'vitest';
import * as barrel from '../src/index';
import * as typesModule from '../src/types';

// WP-0.3: the public value surface of the barrel is exactly the Phase-0 allowed set (format-contract
// WP-F.9, Phase-0 subset). Type-only exports erase at runtime and so are not keys here; this guards
// against an internal helper leaking into the public surface or a public value going missing.
const ALLOWED_VALUE_EXPORTS = [
  'BINARY_DECODE_ERROR_CODES',
  'BinaryDecodeError',
  'CURRENT_FORMAT_VERSION',
  'FormatValidationError',
  'MAX_BONE_INFLUENCES',
  'MIGRATIONS',
  'SUPPORTED_FORMAT_MAJOR',
  'WEIGHT_SUM_EPSILON',
  'computeContentHash',
  'crc32',
  'decodeBinary',
  'decodeWeightedVertices',
  'encodeBinary',
  'encodeWeightedVertices',
  'isWeightedMesh',
  'migrateToCurrent',
  'parseDocument',
  'runMigrations',
  'validateDocument',
  'verifyContentHash',
].sort();

describe('public barrel surface', () => {
  it('exports exactly the allowed runtime value keys', () => {
    expect(Object.keys(barrel).sort()).toEqual(ALLOWED_VALUE_EXPORTS);
  });

  it('exposes the version constants with their current values', () => {
    expect(barrel.CURRENT_FORMAT_VERSION).toBe('0.6.0');
    expect(barrel.SUPPORTED_FORMAT_MAJOR).toBe(0);
  });

  it('exposes the callable validators, hashers, and the error class', () => {
    expect(typeof barrel.validateDocument).toBe('function');
    expect(typeof barrel.parseDocument).toBe('function');
    expect(typeof barrel.computeContentHash).toBe('function');
    expect(typeof barrel.verifyContentHash).toBe('function');
    expect(typeof barrel.FormatValidationError).toBe('function');
  });

  it('@marionette/format/types is side-effect-free (zero runtime exports)', () => {
    expect(Object.keys(typesModule)).toEqual([]);
  });
});
