import { describe, expect, it } from 'vitest';
import { FormatValidationError } from '../src/validate/errors';
import { parseDocument, validateDocument } from '../src/validate';
import { cloneMinimal } from './helpers';

// WP-0.3: validateDocument is pure. It never mutates its input and is deterministic, so two calls on
// the same input return deep-equal reports. parseDocument is the throwing wrapper.
describe('validate purity', () => {
  it('leaves the input object referentially and structurally unchanged', () => {
    const input = cloneMinimal();
    const before = structuredClone(input);

    validateDocument(input);

    expect(input).toEqual(before);
  });

  it('returns deep-equal reports across two calls', () => {
    const input = cloneMinimal();

    const first = validateDocument(input);
    const second = validateDocument(input);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });

  it('does not mutate the input even when validation fails', () => {
    const input = cloneMinimal();
    input.slots[0]!.bone = 'ghost';
    const before = structuredClone(input);

    const report = validateDocument(input, { verifyHash: false });

    expect(report.ok).toBe(false);
    expect(input).toEqual(before);
  });

  it('parseDocument returns the document on success and throws FormatValidationError on failure', () => {
    const valid = cloneMinimal();
    expect(parseDocument(valid).name).toBe('minimal');

    const invalid = cloneMinimal();
    invalid.bones = [];
    expect(() => parseDocument(invalid)).toThrow(FormatValidationError);
    try {
      parseDocument(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(FormatValidationError);
      if (error instanceof FormatValidationError) {
        expect(error.report.ok).toBe(false);
        expect(error.report.errors.length).toBeGreaterThan(0);
      }
    }
  });
});
